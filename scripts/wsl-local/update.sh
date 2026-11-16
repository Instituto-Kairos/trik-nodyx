#!/usr/bin/env bash
# Atualiza o servidor de teste (WSL) com o que mudou no fork — SEM resetar o banco
# e SEM mexer no git de /opt/nodyx. É o comando do dia a dia; use full-reset.sh
# só pra recomeçar do zero.
#
#   1. confere que /opt/nodyx está na mesma base do fork (senão o staging, que só
#      copia o que difere do commit do fork, misturaria versões);
#   2. staging (stage.sh, como o seu usuário — lê o repo do Windows);
#   3. ajustes de schema idempotentes (schema-patches.sql) no banco existente;
#   4. deploy.sh: copia, builda (pula `npm ci` se o package-lock não mudou), reinicia;
#   5. espera o core subir e roda o verify.sh.
#
# Arquivo APAGADO no fork (nodyx-core/ e nodyx-frontend/) também é removido de
# /opt/nodyx, pois o deploy sozinho só copia/sobrescreve.
# Precisa de root de verdade (senha interativa), como o deploy.sh:
#   sudo bash scripts/wsl-local/update.sh
# Ver README.md nesta pasta pro contexto completo.
set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "\n${CYAN}→${RESET}  ${BOLD}$*${RESET}"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Rode com sudo: sudo bash $0"
[[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]] \
  || die "Rode via sudo a partir do seu usuário (o SUDO_USER lê o repo do Windows em /mnt/c)."

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
NODYX_DIR=/opt/nodyx
ENV_FILE="$NODYX_DIR/nodyx-core/.env"

STEP="início"
trap 'echo -e "\n${RED}✘  Falhou em: ${STEP} (linha ${LINENO})${RESET}" >&2' ERR

env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
DB_HOST="$(env_get DB_HOST)"; DB_HOST="${DB_HOST:-localhost}"
export PGPASSWORD="$(env_get DB_PASSWORD)"
PSQL=(psql -h "$DB_HOST" -U "$(env_get DB_USER)" -d "$(env_get DB_NAME)" -v ON_ERROR_STOP=1 -X -q)

echo -e "${BOLD}━━━  Update do servidor de teste (WSL)  ━━━${RESET}"

STEP="1. checar a base do /opt/nodyx"
info "Conferindo que $NODYX_DIR está na mesma base do fork..."
OPT_HEAD="$(git -c safe.directory='*' -C "$NODYX_DIR" rev-parse HEAD)"
# O commit de /opt precisa existir no fork e ser ANCESTRAL do HEAD daqui: aí o
# staging pode copiar tudo que mudou de lá pra cá (commits da branch + o que
# ainda não foi commitado). Se não for ancestral, /opt tem código que o fork não
# tem — copiar só o diff misturaria versões.
if ! git -c safe.directory='*' -C "$REPO" merge-base --is-ancestor "$OPT_HEAD" HEAD 2>/dev/null; then
  die "/opt/nodyx está em ${OPT_HEAD:0:7}, que não é ancestral do HEAD do fork (commit desconhecido
   aqui, ou /opt tem coisa que o fork não tem). Copiar só o que mudou misturaria versões.
   Rode full-reset.sh (ele também traz o upstream) ou sincronize o fork."
fi
export BASE="$OPT_HEAD"
ok "base ${OPT_HEAD:0:7} é ancestral do fork"

# Sem "HEAD" no fim: compara a base instalada com a árvore de trabalho, então
# pega tanto deleções commitadas quanto as ainda não commitadas.
DELETED="$(git -c safe.directory='*' -C "$REPO" diff --diff-filter=D --name-only "$OPT_HEAD" -- nodyx-core nodyx-frontend)"

STEP="2. staging"
info "Preparando o staging (como $SUDO_USER)..."
runuser -u "$SUDO_USER" -- env BASE="$BASE" bash "$HERE/stage.sh" | grep '^---'

# O deploy só copia/sobrescreve, então arquivo apagado no fork sobraria em /opt
# (ex.: um svelte.config.js que o SvelteKit novo recusa). Remove aqui, só o que o
# git diz que foi apagado, só dentro de nodyx-core/ e nodyx-frontend/.
STEP="2b. remover arquivos apagados no fork"
if [[ -n "$DELETED" ]]; then
  info "Removendo de $NODYX_DIR o que foi apagado no fork desde ${OPT_HEAD:0:7}..."
  while IFS= read -r f; do
    case "$f" in
      nodyx-core/*|nodyx-frontend/*) ;;
      *) continue ;;
    esac
    [[ "$f" == *..* ]] && continue
    if [[ -f "$NODYX_DIR/$f" ]]; then
      rm -f -- "$NODYX_DIR/$f"
      echo "   removido: $f"
    fi
  done <<< "$DELETED"
  ok "arquivos apagados propagados"
fi

STEP="3. ajustes de schema"
info "Aplicando ajustes de schema (idempotentes)..."
"${PSQL[@]}" -f "$HERE/schema-patches.sql"
ok "schema-patches.sql"

STEP="4. deploy"
info "Instalando (deploy.sh)..."
bash "$HERE/deploy.sh"

STEP="5. esperar o core"
info "Esperando o nodyx-core responder..."
READY=0
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null --max-time 3 http://localhost:3000/; then READY=1; break; fi
  sleep 2
done
[[ "$READY" == "1" ]] || die "O core não respondeu em 2 min. Veja: sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 60 --nostream"
ok "core respondendo"

STEP="5. verificação"
bash "$HERE/verify.sh"

echo
ok "Update concluído — banco e dados de teste intactos."
