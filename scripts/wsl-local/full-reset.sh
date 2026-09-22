#!/usr/bin/env bash
# Reset completo do servidor de teste (WSL) em um comando:
#
#   1. confere que o upstream é o mesmo commit-base do fork (aborta antes de
#      destruir qualquer coisa se não for) e prepara o staging dos arquivos;
#   2. backup do banco inteiro (pg_dump);
#   3. em /opt/nodyx: guarda TODAS as modificações num stash (nada é perdido) e
#      atualiza do upstream original (Pokled/nodyx) — árvore limpa (o git vem
#      antes do banco: se falhar, o banco ainda não foi tocado);
#   4. para o PM2, apaga as tabelas trik_* e o registro de migrations trik%;
#   5. reinstala tudo que fizemos (stage.sh + deploy.sh: copia, builda, reinicia);
#   6. espera o core subir e recriar as tabelas (migrations trik_001/002);
#   7. aplica os seeds de scripts/wsl-local/seed/*.sql (canais + jogador e
#      personagem de teste) e roda o verify.sh.
#
# Não toca em users/threads/posts/channels — só nas tabelas trik_*.
# Precisa de root de verdade (senha interativa), como o deploy.sh:
#   sudo bash scripts/wsl-local/full-reset.sh          # pede pra digitar RESETAR
#   sudo bash scripts/wsl-local/full-reset.sh --yes    # sem pergunta
# Ver README.md nesta pasta pro contexto completo.
set -Eeuo pipefail   # -E: o trap de ERR também dispara dentro das funções

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "\n${CYAN}→${RESET}  ${BOLD}$*${RESET}"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Rode com sudo: sudo bash $0"
[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] \
  || die "Rode via sudo a partir do seu usuário (o SUDO_USER lê o repo do Windows em /mnt/c)."

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
NODYX_DIR=/opt/nodyx
ENV_FILE="$NODYX_DIR/nodyx-core/.env"
BACKUP_DIR=/var/backups/nodyx-trik
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP=""

STEP="início"
trap 'echo -e "\n${RED}✘  Falhou em: ${STEP} (linha ${LINENO})${RESET}" >&2
      [[ -n "$BACKUP" ]] && echo "   Backup do banco: $BACKUP" >&2
      echo "   Nada mais foi feito depois deste ponto." >&2' ERR

env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
DB_NAME="$(env_get DB_NAME)"; DB_USER="$(env_get DB_USER)"
DB_HOST="$(env_get DB_HOST)"; DB_HOST="${DB_HOST:-localhost}"
export PGPASSWORD="$(env_get DB_PASSWORD)"
PSQL=(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -q)

# git de /opt/nodyx roda como o dono do .git (nodyx), pra não deixar objetos root.
ngit() { runuser -u nodyx -- env HOME=/home/nodyx git -C "$NODYX_DIR" "$@"; }
pm2n() { runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 "$@"; }

echo -e "${BOLD}━━━  Reset completo do servidor de teste (WSL)  ━━━${RESET}"

# ── 1. Pré-checagens (nada destrutivo até aqui) ────────────────────────────────
STEP="1. checar upstream e preparar staging"

# /opt/nodyx é o clone do repo original (Pokled/nodyx), de um usuário de sistema
# (nodyx) — não é seu. O git dele só funciona se tudo lá for do nodyx, mas
# `git pull` rodado como root (nodyx-update, syncs anteriores) e o `install -D`
# do deploy deixam .git/refs, arquivos rastreados e diretórios novos como root, e aí
# stash/merge/fetch morrem com "Permission denied". Devolve ao dono certo (só
# metadado; pula node_modules, que o git ignora).
info "Ajustando donos em $NODYX_DIR (arquivos deixados por root)..."
FIXED="$(find "$NODYX_DIR" -name node_modules -prune -o ! -user nodyx -print | wc -l)"
find "$NODYX_DIR" -name node_modules -prune -o ! -user nodyx -exec chown nodyx:nodyx {} +
ok "$FIXED itens devolvidos ao usuário nodyx"

info "Buscando o upstream original em $NODYX_DIR (git fetch)..."
ngit fetch origin
UPSTREAM="$(ngit rev-parse '@{u}')"
LOCAL_HEAD="$(ngit rev-parse HEAD)"
ok "upstream: $(ngit log -1 --format='%h %s' "$UPSTREAM")"

# O stage.sh só copia o que difere do último commit do fork; o resto de
# /opt/nodyx vem do upstream. Só dá certo se os dois forem a mesma base.
if ! git -c safe.directory='*' -C "$REPO" diff --quiet "$UPSTREAM" HEAD -- nodyx-core nodyx-frontend 2>/dev/null; then
  die "O upstream ($UPSTREAM) não é o commit-base do fork (nodyx-core/nodyx-frontend diferem, ou o commit não existe no fork).
   O upstream avançou. Sincronize o fork com o upstream primeiro (merge upstream/main, plans: upstream_sync) e rode de novo.
   NADA foi alterado."
fi
ok "o commit-base do fork é o mesmo do upstream"

info "Preparando o staging (arquivos do fork que diferem do commit, como $SUDO_USER)..."
runuser -u "$SUDO_USER" -- bash "$HERE/stage.sh" | grep '^---'
STAGED="$(find /tmp/trik-fase2-deploy -type f | wc -l)"
[[ "$STAGED" -gt 0 ]] || die "Staging vazio."
ok "$STAGED arquivos em /tmp/trik-fase2-deploy"

echo
echo "  Vai ser feito:"
echo "   • backup do banco '$DB_NAME'  →  $BACKUP_DIR/"
echo "   • APAGAR as tabelas trik_* (jogadores, personagens, xp, catálogos, canais mapeados)"
echo "   • em $NODYX_DIR: stash de $(ngit -c core.autocrlf=true status --porcelain | wc -l) arquivos modificados/novos + atualizar do upstream"
echo "   • reinstalar tudo (deploy), recriar o banco e aplicar os seeds de $HERE/seed/"
echo
if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Digite RESETAR para confirmar (qualquer outra coisa cancela): " answer
  [[ "$answer" == "RESETAR" ]] || { echo "Cancelado, nada foi alterado."; exit 1; }
fi

# ── 2. Backup ───────────────────────────────────────────────────────────────────
STEP="2. backup do banco"
info "Backup do banco..."
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/nodyx-pre-full-reset-$STAMP.dump"
pg_dump -h "$DB_HOST" -U "$DB_USER" -Fc -f "$BACKUP" "$DB_NAME"
chmod 600 "$BACKUP"
ok "$BACKUP ($(du -h "$BACKUP" | cut -f1))"

# ── 3. /opt/nodyx: tirar as modificações e atualizar do upstream ────────────────
# Antes do banco de propósito: é a parte que mais pode falhar (git/rede), e se
# falhar aqui o banco continua intacto.
STEP="3. limpar /opt/nodyx e atualizar do upstream"
info "Guardando as modificações de $NODYX_DIR num stash e atualizando do upstream..."
ngit -c user.name=full-reset -c user.email=full-reset@localhost \
  stash push --include-untracked -m "pre-full-reset-$STAMP"
ngit merge --ff-only '@{u}'
DIRTY="$(ngit status --porcelain)"
[[ -z "$DIRTY" ]] || die "A árvore de $NODYX_DIR não ficou limpa:
$DIRTY"
ok "árvore limpa em $(ngit log -1 --format='%h %s')"
if [[ "$LOCAL_HEAD" != "$UPSTREAM" ]]; then ok "atualizado: ${LOCAL_HEAD:0:7} → ${UPSTREAM:0:7}"; else ok "já estava no upstream"; fi
info "Stash guardado (recuperável com git stash list / git stash show -p):"
ngit stash list | sed -n '1,3p'

# ── 4. Parar serviços e resetar o banco ─────────────────────────────────────────
STEP="4. parar PM2 e resetar as tabelas trik_*"
info "Parando os serviços (evita o app escrever no banco durante o reset)..."
pm2n stop "$NODYX_DIR/ecosystem.config.js" >/dev/null || warn "pm2 stop falhou (já parado?) — seguindo."

info "Apagando tabelas trik_* e o registro das migrations trik%..."
bash "$HERE/reset-trik-db.sh" --yes

# ── 5. Reinstalar tudo que fizemos ──────────────────────────────────────────────
STEP="5. deploy (copiar, buildar, reiniciar)"
info "Instalando o que fizemos (deploy.sh)..."
bash "$HERE/deploy.sh"

# ── 6. Esperar o core subir e recriar o banco ───────────────────────────────────
STEP="6. esperar o core recriar as tabelas trik_*"
info "Esperando o nodyx-core subir e aplicar as migrations trik_001/trik_002..."
READY=0
for _ in $(seq 1 60); do
  N="$("${PSQL[@]}" -At -c "SELECT count(*) FROM schema_migrations WHERE version IN ('trik_001_registro','trik_002_xp')" 2>/dev/null || echo 0)"
  if [[ "$N" == "2" ]] && curl -fs -o /dev/null --max-time 3 http://localhost:3000/; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == "1" ]] || die "O core não subiu/aplicou as migrations em 2 min. Veja: sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 60 --nostream"
ok "migrations trik_001 e trik_002 aplicadas, core respondendo"

HAS_CATEGORY="$("${PSQL[@]}" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name='trik_weapons' AND column_name='category'")"
[[ "$HAS_CATEGORY" == "1" ]] || die "trik_weapons sem a coluna 'category' — a migration deployada não é a atual."
ok "trik_weapons.category existe"

# ── 7. Seeds e verificação ──────────────────────────────────────────────────────
STEP="7. aplicar seeds"
info "Aplicando seeds de teste..."
shopt -s nullglob
SEEDS=("$HERE"/seed/*.sql)
if [[ ${#SEEDS[@]} -eq 0 ]]; then
  warn "Nenhum seed em $HERE/seed/ — banco fica vazio."
else
  for f in "${SEEDS[@]}"; do
    "${PSQL[@]}" -f "$f"   # set -e aborta se falhar (um `&& ok` na mesma linha esconderia o erro)
    ok "$(basename "$f")"
  done
fi

STEP="7. verificação"
info "Resumo do banco recriado:"
"${PSQL[@]}" -c "
  SELECT (SELECT count(*) FROM trik_players)    AS jogadores,
         (SELECT count(*) FROM trik_characters) AS personagens,
         (SELECT count(*) FROM trik_channels)   AS canais,
         (SELECT count(*) FROM trik_weapons)    AS armas,
         (SELECT count(*) FROM trik_threads)    AS topicos_xp;"
"${PSQL[@]}" -c "SELECT p.name AS jogador, c.name AS personagem, c.template_name FROM trik_characters c JOIN trik_players p ON p.id = c.player_id;"
bash "$HERE/verify.sh"

echo
ok "Reset completo concluído."
echo "   Backup do banco anterior: $BACKUP"
echo "   Próximos passos do teste: habilitar o tópico do Refeitório pra XP, cadastrar uma arma"
echo "   (nome + categoria) em /admin/trik/catalogo e postar com #treino #nomedaarma."
