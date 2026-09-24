#!/usr/bin/env bash
# ─── Nodyx — update de uma instância em produção (servidor AWS) ───────────────
#
#   sudo bash /opt/nodyx/scripts/aws/update.sh
#
# Puxa o repositório em /opt/nodyx, rebuilda o que precisa, sincroniza o Caddy,
# reinicia o PM2 e CONFERE que subiu. É o update do dia a dia de uma instância
# instalada pelo install.sh — não mexe no banco além das migrations que o
# próprio nodyx-core aplica no boot.
#
# Não confundir com os vizinhos:
#   · scripts/deploy-all.sh        → servidor multi-app do autor (/var/www/nexus)
#   · scripts/wsl-local/update.sh  → servidor de teste em WSL, copia do repo Windows
#   · este (scripts/aws/update.sh) → UMA instância na AWS, repo em /opt/nodyx, git pull
#
# E o `sudo nodyx-update` que o install.sh deixa em /usr/local/bin faz o mesmo
# papel deste, mais fraco (pull como root, npm ci sempre, sem backup nem
# verificação). `--instalar-comando` faz aquele comando apontar pra cá.
#
# ─── Os três detalhes de config que fazem este script existir ────────────────
# Rodar os comandos "na mão" numa instância nodyx falha por três motivos que
# nada avisa direito. Este script trata os três:
#
#  1. git: "dubious ownership". /opt/nodyx pertence a `nodyx`, o update roda
#     como root. Desde o git 2.35.2 ele RECUSA operar num repo de outro dono.
#     → todo comando git leva `-c safe.directory='*'`, e o pull roda COMO nodyx
#       para os arquivos novos não nascerem de root (senão o próximo update,
#       feito pelo usuário nodyx, não consegue mais escrever neles).
#
#  2. PM2: o daemon é POR USUÁRIO. `pm2 restart` como root fala com o daemon do
#     root, que não conhece nodyx-core nem nodyx-frontend — e o comando
#     "funciona" sem reiniciar nada.
#     → sempre `runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 ...`
#
#  3. Build do frontend: SvelteKit + Vite (4500+ módulos) estoura o heap padrão
#     do Node. Numa AWS t3.micro/small o build morre com OOM sem aviso claro.
#     → NODE_OPTIONS com teto de heap escalado pela RAM, igual ao install.sh.
#
# ─── A regra da casa ─────────────────────────────────────────────────────────
# Não declara sucesso que não constatou. Cada etapa é verificada, e qualquer
# falha imprime a etapa, o comando de log e como voltar atrás.
set -Eeuo pipefail

# ═════════════════════════════════════════════════════════════════════════════
#  RECADO PARA A PRÓXIMA SESSÃO DO CLAUDE  (escrito em 2026-09-22)
# ═════════════════════════════════════════════════════════════════════════════
#
# Leia isto antes de mexer aqui. O Rafael trabalha neste projeto a partir de
# MAIS DE UM COMPUTADOR, e as sessões do Claude Code são locais por máquina
# (`~/.claude/projects/<slug>/*.jsonl` e `~/.claude/history.jsonl`, nomeados
# pelo caminho de trabalho). Nada disso sincroniza. Se ele disser "na nossa
# sessão de ontem", o contexto pode simplesmente não existir no disco daí.
# O git é o único canal que atravessa — por isso este recado está aqui, e não
# na memória (que também é local).
#
# ── O que foi feito nesta sessão ─────────────────────────────────────────────
#
#  · CSP das fontes. As fontes selecionáveis de apelido não funcionavam em
#    lugar nenhum, nem no preview do editor. Causa: a CSP que o Caddy posto
#    pelo install.sh servia SUBSTITUI a do SvelteKit, e não tinha
#    `fonts.googleapis.com` em `style-src` nem `fonts.gstatic.com` em
#    `font-src`. Corrigido em install.sh + install_tunnel.sh; a etapa 5 deste
#    script sincroniza instâncias já instaladas. Guardado por
#    nodyx-frontend/src/tests/cspGoogleFonts.test.ts.
#
#  · Página de perfil. `routes/users/[username]/+page.svelte` renderizava o
#    apelido com `style="color: ..."` à mão e descartava fonte, halo e
#    animação — só a cor dos cinco efeitos sobrevivia. Passou a usar
#    buildNameStyle/buildAnimClass/ensureFontLoaded, como chat e sidebar.
#
#  · Tela "explorar". Restavam dois links para /discover em routes/feed, e
#    /feed é o primeiro item da barra mobile — era o caminho que mantinha a
#    tela retirada acessível. Removidos.
#
# ── NÃO "conserte" isto sem perguntar ────────────────────────────────────────
#
# O envio de mensagens diretas ESTÁ QUEBRADO, e é de propósito que continua
# assim: o Rafael abriu bug report e prefere esperar a correção do autor
# original (upstream Pokled). Uma correção foi escrita e REVERTIDA a pedido
# dele. Se você "descobrir" esse bug, não o corrija por iniciativa própria.
#
# Diagnóstico, para não ter de refazer: `instance.esy` só é gerado por
# `npm run generate-esy`, que o install.sh nunca chama — então
# /api/v1/instance/esy-public responde 503 ESY_NOT_CONFIGURED. Em
# nodyx-frontend/src/lib/e2e.ts, `loadEsyKey()` lança, `encryptDM()` deixa
# subir, e `sendMessage()` (routes/dm/[id]/+page.svelte) o chama sem `catch`:
# o campo é limpo, nada é enviado, nenhum erro aparece. Receber continua
# funcionando porque `decryptDM()` devolve null em vez de lançar — daí a
# assimetria "não envio, mas recebi". A correção era tornar a camada ESY
# opcional (ela é defesa em profundidade sobre AES-256-GCM, não o cifrado) e
# dar um `catch` ao envio que devolve o texto ao usuário.
#
# ── Pendência aberta ─────────────────────────────────────────────────────────
#
# Houve uma sessão sobre o Nodyx na noite de 2026-09-21, em OUTRA MÁQUINA, com
# "um detalhe de config ao rodar algo no nodyx" que não consegui recuperar.
# Os três detalhes que achei no repo estão tratados (ver os itens 1-3 acima e
# scripts/aws/README.md), mas pode ser outro. Se for relevante, PERGUNTE a ele
# em vez de deduzir. Na máquina de ontem, dá para procurar com:
#   grep -ril "caddy\|CSP\|PM2_HOME\|safe.directory\|NODE_OPTIONS" ~/.claude/projects/*nodyx*/
#
# ── Suposições deste script que talvez não valham na instância dele ──────────
#
# Nunca foi executado contra o servidor real (nenhuma sessão teve acesso à AWS).
# Herda os padrões do install.sh: nodyx-core na 3000, nodyx-frontend na 4173,
# Postgres local com credenciais de nodyx-core/.env. Se a instância usa RDS,
# outras portas ou outro proxy, confira as etapas 5 e 7 antes de rodar sem
# `--dry-run`.
# ═════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "\n${CYAN}→${RESET}  ${BOLD}$*${RESET}"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }

NODYX_DIR="${NODYX_DIR:-/opt/nodyx}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
PM2=(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2)
GIT=(git -c safe.directory='*' -C "$NODYX_DIR")

COMANDO="${COMANDO:-/usr/local/bin/nodyx-update}"

RAMO=""
FAZER_BACKUP=1
DRY_RUN=0
INSTALAR_COMANDO=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ramo)        RAMO="${2:-}"; shift 2 ;;
    --sem-backup)  FAZER_BACKUP=0; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --instalar-comando) INSTALAR_COMANDO=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/,""); print; next } NR>1 { exit }' "$0"
      echo
      echo "Opções:"
      echo "  --ramo <nome>        ramo a atualizar (padrão: o que está em uso)"
      echo "  --sem-backup         pula o backup do banco (NÃO recomendado)"
      echo "  --dry-run            mostra o que mudaria e sai, sem tocar em nada"
      echo "  --instalar-comando   faz 'sudo nodyx-update' passar a chamar ESTE script, e sai"
      exit 0 ;;
    *) die "Opção desconhecida: $1 (use --help)" ;;
  esac
done

# ── `sudo nodyx-update`: o comando que já existe no servidor ─────────────────
# O install.sh gera /usr/local/bin/nodyx-update, e é ele que o Rafael tem no
# dedo. Só que a versão gerada é mais fraca que este script em três pontos que
# já mordemos: roda o `git pull` COMO ROOT (os arquivos novos nascem de root e
# o update seguinte não consegue mexer neles — foi o "Permission denied" do
# servidor de teste), roda `npm ci` sempre (o passo mais lento, quase nunca
# necessário) e não faz backup nem confere se os serviços voltaram.
# Esta opção troca aquele arquivo por um atalho pra cá, guardando o original.
if [[ $INSTALAR_COMANDO == 1 ]]; then
  [[ $EUID -eq 0 ]] || die "Rode com sudo: sudo bash $0 --instalar-comando"
  ALVO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  [[ "$ALVO" == "$NODYX_DIR"/* ]] || warn "Este script está em $ALVO, fora de $NODYX_DIR:
   o atalho vai apontar pra esse caminho. Rode a partir de $NODYX_DIR/scripts/aws/ pra ele
   se atualizar junto com o repo."
  if [[ -e "$COMANDO" ]] && ! grep -q 'scripts/aws/update.sh' "$COMANDO" 2>/dev/null; then
    BKP="${COMANDO}.install-sh-$(date +%Y%m%dT%H%M%S)"
    cp -p "$COMANDO" "$BKP"
    ok "nodyx-update anterior (o do install.sh) guardado em $BKP"
  fi
  cat > "$COMANDO" <<EOF
#!/usr/bin/env bash
# Atalho gerado por $ALVO --instalar-comando.
# O update de verdade mora no repo (versionado); aqui só fica o apontador, pra
# 'sudo nodyx-update' continuar sendo o comando do dia a dia e já pegar as
# melhorias que chegarem por git.
exec bash "$ALVO" "\$@"
EOF
  chmod +x "$COMANDO"
  ok "'sudo nodyx-update' agora chama $ALVO"
  echo "   Confira:  sudo nodyx-update --dry-run"
  exit 0
fi

ETAPA="início"
OLD_HEAD=""
trap 'rc=$?; echo -e "\n${RED}✘  Falhou em: ${ETAPA}${RESET}" >&2;
      if [[ -n "$OLD_HEAD" ]]; then
        echo -e "${YELLOW}   Para voltar o código ao estado anterior:${RESET}" >&2
        echo    "     sudo runuser -u nodyx -- git -c safe.directory=\"*\" -C $NODYX_DIR reset --hard $OLD_HEAD" >&2
        echo -e "${YELLOW}   Atenção: migrations já aplicadas NÃO voltam com o reset.${RESET}" >&2
      fi
      echo    "   Logs:  sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs --lines 60 --nostream" >&2
      exit $rc' ERR

echo -e "${BOLD}━━━  Update da instância Nodyx em ${NODYX_DIR}  ━━━${RESET}"

# ── 0. Pré-requisitos ────────────────────────────────────────────────────────
ETAPA="0. pré-requisitos"
[[ $EUID -eq 0 ]] || die "Rode com sudo: sudo bash $0"
[[ -d "$NODYX_DIR/.git" ]] || die "$NODYX_DIR não é um repositório git — esta instância não foi instalada pelo install.sh?"
[[ -f "$NODYX_DIR/nodyx-core/.env" ]] || die "Falta $NODYX_DIR/nodyx-core/.env — instância incompleta."
[[ -f "$NODYX_DIR/nodyx-frontend/.env" ]] || die "Falta $NODYX_DIR/nodyx-frontend/.env — o build do frontend precisa dele (PUBLIC_API_URL)."
id nodyx &>/dev/null || die "Usuário 'nodyx' não existe."
command -v pm2 &>/dev/null || die "pm2 não encontrado no PATH."
ok "instância válida, usuário nodyx e pm2 presentes"

# ── 1. O que vem do remoto ───────────────────────────────────────────────────
ETAPA="1. buscar o remoto"
info "Buscando o remoto..."
OLD_HEAD="$("${GIT[@]}" rev-parse HEAD)"
[[ -n "$RAMO" ]] || RAMO="$("${GIT[@]}" rev-parse --abbrev-ref HEAD)"
[[ "$RAMO" != "HEAD" ]] || die "O repo está em HEAD solto. Informe o ramo: --ramo main"

# O fetch também roda como nodyx: se o remoto for privado, são as credenciais
# do nodyx que valem, e é nelas que o próximo update vai reincidir.
runuser -u nodyx -- git -c safe.directory='*' -C "$NODYX_DIR" fetch --prune origin "$RAMO" \
  || die "git fetch falhou. Se o remoto for privado, confira as credenciais do usuário nodyx."

NEW_HEAD="$("${GIT[@]}" rev-parse "origin/$RAMO")"
ok "local ${OLD_HEAD:0:7} · remoto ${NEW_HEAD:0:7} (ramo $RAMO)"

if [[ "$OLD_HEAD" == "$NEW_HEAD" ]]; then
  ok "Já está atualizado — nada a fazer."
  "${PM2[@]}" list
  exit 0
fi

# Fast-forward obrigatório: um merge ou rebase automático em produção é como se
# perde trabalho local sem perceber.
"${GIT[@]}" merge-base --is-ancestor "$OLD_HEAD" "$NEW_HEAD" \
  || die "origin/$RAMO não é descendente do que está instalado (divergiram).
   Resolva à mão em $NODYX_DIR — este script não faz merge nem rebase em produção."

if ! "${GIT[@]}" diff --quiet HEAD -- || ! "${GIT[@]}" diff --cached --quiet; then
  warn "Há modificações locais não commitadas em $NODYX_DIR:"
  "${GIT[@]}" status --short | sed 's/^/     /'
  die "O pull sobrescreveria isso. Commite, guarde (git stash) ou descarte antes."
fi

info "Commits a aplicar:"
"${GIT[@]}" log --oneline --no-decorate "$OLD_HEAD..$NEW_HEAD" | sed 's/^/     /'

# O que mudou decide o que reconstruir — e o que nem tocar.
mudou() { ! "${GIT[@]}" diff --quiet "$OLD_HEAD" "$NEW_HEAD" -- "$@"; }
MUDOU_CORE=0;  mudou nodyx-core                        && MUDOU_CORE=1
MUDOU_FRONT=0; mudou nodyx-frontend                    && MUDOU_FRONT=1
MUDOU_MIGR=0;  mudou nodyx-core/src/migrations         && MUDOU_MIGR=1
MUDOU_CSP=0;   mudou install.sh install_tunnel.sh      && MUDOU_CSP=1

echo
echo "     backend: $([[ $MUDOU_CORE  == 1 ]] && echo 'rebuild' || echo 'sem mudança')"
echo "    frontend: $([[ $MUDOU_FRONT == 1 ]] && echo 'rebuild' || echo 'sem mudança')"
echo "  migrations: $([[ $MUDOU_MIGR  == 1 ]] && echo 'NOVAS — aplicadas no boot do core' || echo 'nenhuma nova')"
echo "       caddy: $([[ $MUDOU_CSP   == 1 ]] && echo 'installer mudou — conferir cabeçalhos' || echo 'sem mudança')"

if [[ $DRY_RUN == 1 ]]; then
  echo
  ok "--dry-run: nada foi alterado."
  exit 0
fi

# ── 2. Backup antes de qualquer migration ────────────────────────────────────
ETAPA="2. backup do banco"
if [[ $FAZER_BACKUP == 0 ]]; then
  warn "Backup pulado por --sem-backup."
elif [[ $MUDOU_MIGR == 0 ]]; then
  ok "Sem migrations novas — backup não é obrigatório aqui (rode nodyx-backup quando quiser)."
else
  info "Migrations novas detectadas — fazendo backup antes (migration não tem volta)..."
  if command -v nodyx-backup &>/dev/null; then
    nodyx-backup || die "nodyx-backup falhou. Não sigo com migrations sem backup (use --sem-backup para assumir o risco)."
    ok "backup via nodyx-backup"
  elif [[ -x "$NODYX_DIR/scripts/ops/nodyx-backup.sh" ]]; then
    bash "$NODYX_DIR/scripts/ops/nodyx-backup.sh" || die "nodyx-backup.sh falhou."
    ok "backup via scripts/ops/nodyx-backup.sh"
  else
    # Fallback mínimo: dump do Postgres com as credenciais do .env.
    env_get() { grep -E "^$1=" "$NODYX_DIR/nodyx-core/.env" | head -1 | cut -d= -f2- | tr -d "\"'"; }
    DEST="/var/backups/nodyx"; mkdir -p "$DEST"
    ARQ="$DEST/pre-update-$(date +%Y-%m-%dT%H-%M-%S).dump"
    PGPASSWORD="$(env_get DB_PASSWORD)" pg_dump -Fc \
      -h "$(env_get DB_HOST || echo localhost)" -U "$(env_get DB_USER)" -d "$(env_get DB_NAME)" -f "$ARQ" \
      || die "pg_dump falhou — não sigo com migrations sem backup."
    # Relido, não só escrito: um dump que não se sabe ler não é backup.
    pg_restore -l "$ARQ" >/dev/null || die "O dump $ARQ não é legível pelo pg_restore."
    ok "backup verificado em $ARQ"
  fi
fi

# ── 3. Puxar o código ────────────────────────────────────────────────────────
ETAPA="3. git pull"
info "Atualizando o código para ${NEW_HEAD:0:7}..."
runuser -u nodyx -- git -c safe.directory='*' -C "$NODYX_DIR" merge --ff-only "$NEW_HEAD" \
  || die "O fast-forward falhou."
# Rede de segurança: se algum arquivo acabou de root, o próximo update (que roda
# o git como nodyx) não conseguiria mexer nele.
chown -R nodyx:nodyx "$NODYX_DIR"
ok "código em $("${GIT[@]}" rev-parse --short HEAD)"

# ── 4. Build ─────────────────────────────────────────────────────────────────
# npm ci apaga e reinstala o node_modules inteiro — o passo mais lento — e só
# faz sentido quando as dependências mudaram. Mesmo truque do wsl-local/deploy.sh:
# o hash do package-lock fica DENTRO do node_modules, e some junto com ele.
npm_ci_se_preciso() {
  local marcador="node_modules/.update-lock-hash" querido
  querido="$(sha256sum package-lock.json | cut -d' ' -f1)"
  if [[ -d node_modules && -f "$marcador" && "$(cat "$marcador")" == "$querido" ]]; then
    ok "package-lock.json inalterado — pulando npm ci"
  else
    info "Dependências mudaram — npm ci..."
    npm ci --no-fund --no-audit --silent || return 1
    echo "$querido" > "$marcador"
  fi
}

# Teto de heap do Node pela RAM total, espelhando install.sh. Sem isto, o build
# do frontend morre por OOM numa instância pequena (t3.micro/small).
RAM_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $2}' || echo 9999)
if   [[ "$RAM_MB" -lt 1500 ]]; then HEAP=768
elif [[ "$RAM_MB" -lt 3000 ]]; then HEAP=1536
elif [[ "$RAM_MB" -lt 8000 ]]; then HEAP=2048
else                                HEAP=4096
fi
export NODE_OPTIONS="--max-old-space-size=${HEAP}"
[[ "$RAM_MB" -ge 1500 ]] || warn "Só ${RAM_MB}MB de RAM: build lento, e precisa de swap ativa."
ok "RAM ${RAM_MB}MB → heap do Node ${HEAP}MB"

if [[ $MUDOU_CORE == 1 ]]; then
  ETAPA="4a. build do backend"
  info "Rebuild do backend..."
  cd "$NODYX_DIR/nodyx-core"
  npm_ci_se_preciso || die "npm ci do backend falhou."
  npm run build || die "Build do backend falhou."
  ok "backend compilado"
else
  ok "backend sem mudança — build pulado"
fi

if [[ $MUDOU_FRONT == 1 ]]; then
  ETAPA="4b. build do frontend"
  info "Rebuild do frontend (o passo longo)..."
  cd "$NODYX_DIR/nodyx-frontend"
  npm_ci_se_preciso || die "npm ci do frontend falhou."
  npm run build || die "Build do frontend falhou (se foi OOM, ative swap e rode de novo)."
  [[ -f build/index.js ]] || die "O build terminou mas build/index.js não existe."
  ok "frontend compilado"
else
  ok "frontend sem mudança — build pulado"
fi
chown -R nodyx:nodyx "$NODYX_DIR"

# ── 5. Caddy — cabeçalhos servidos ao navegador ──────────────────────────────
# O install.sh só escreve o Caddyfile numa (re)instalação: uma correção de
# cabeçalho que chega por git NÃO alcança /etc/caddy/Caddyfile sozinha. A CSP
# posta pelo proxy SUBSTITUI a da aplicação, então uma diferença aqui derruba
# recursos sem deixar rastro no build — foi assim que as fontes dos apelidos
# pararam de carregar (a folha do fonts.googleapis.com era recusada).
ETAPA="5. sincronizar o Caddy"
if [[ ! -f "$CADDYFILE" ]]; then
  warn "$CADDYFILE não existe — pulando (esta instância usa outro proxy?)."
else
  # `[[:space:]]` depois do nome da diretiva separa `style-src` de
  # `style-src-attr`: sem isso, detecção e substituição tratariam a segunda como
  # a primeira, e o host acabaria na diretiva errada.
  #
  # Cada diretiva tem a SUA expressão, acionada só se ela estiver faltando. Um
  # sed que rodasse as duas sempre duplicaria o host já presente quando apenas a
  # outra faltasse — inofensivo para o navegador, mas cresce a cada execução.
  FALTAM=()
  SEDS=()
  if ! grep -qE 'style-src[[:space:]][^;]*fonts\.googleapis\.com' "$CADDYFILE"; then
    FALTAM+=("style-src → https://fonts.googleapis.com")
    SEDS+=(-e 's#(style-src[[:space:]][^;"]*)(;)#\1 https://fonts.googleapis.com\2#')
  fi
  if ! grep -qE 'font-src[[:space:]][^;]*fonts\.gstatic\.com' "$CADDYFILE"; then
    FALTAM+=("font-src → https://fonts.gstatic.com")
    SEDS+=(-e 's#(font-src[[:space:]][^;"]*)(;)#\1 https://fonts.gstatic.com\2#')
  fi

  if [[ ${#FALTAM[@]} -eq 0 ]]; then
    ok "CSP do Caddy já libera as fontes"
  elif ! grep -q 'Content-Security-Policy' "$CADDYFILE"; then
    warn "$CADDYFILE não define Content-Security-Policy — nada a corrigir aqui."
  else
    info "Ajustando a CSP do Caddy (faltando: ${FALTAM[*]})..."
    BKP="${CADDYFILE}.bak-$(date +%Y%m%dT%H%M%S)"
    cp -p "$CADDYFILE" "$BKP"
    sed -i -E "${SEDS[@]}" "$CADDYFILE"

    # Confere o resultado em vez de confiar no sed: um Caddyfile recarregado com
    # a política errada é pior que não ter mexido.
    for _d in 'style-src[[:space:]][^;]*fonts\.googleapis\.com' 'font-src[[:space:]][^;]*fonts\.gstatic\.com'; do
      grep -qE "$_d" "$CADDYFILE" || { cp -p "$BKP" "$CADDYFILE"; die "O ajuste da CSP não pegou ($_d) — restaurei $BKP. Edite à mão."; }
    done
    if command -v caddy &>/dev/null && ! caddy validate --config "$CADDYFILE" --adapter caddyfile &>/dev/null; then
      cp -p "$BKP" "$CADDYFILE"
      die "O Caddyfile ficou inválido após o ajuste — restaurei $BKP. Edite à mão."
    fi
    systemctl reload caddy || { cp -p "$BKP" "$CADDYFILE"; systemctl reload caddy || true; die "systemctl reload caddy falhou — restaurei $BKP."; }
    ok "CSP ajustada e Caddy recarregado (backup em $BKP)"
  fi
fi

# ── 6. Reiniciar os serviços ─────────────────────────────────────────────────
# As migrations pendentes são aplicadas AQUI: runMigrations() roda no boot do
# nodyx-core (src/index.ts), não por um comando separado.
ETAPA="6. reiniciar o PM2"
info "Reiniciando nodyx-core e nodyx-frontend..."
[[ -f "$NODYX_DIR/ecosystem.config.js" ]] || die "Falta $NODYX_DIR/ecosystem.config.js."
"${PM2[@]}" startOrRestart "$NODYX_DIR/ecosystem.config.js" --update-env || die "O restart do PM2 falhou."
"${PM2[@]}" save >/dev/null
ok "PM2 reiniciado"

# ── 7. Conferir que subiu de verdade ─────────────────────────────────────────
ETAPA="7. verificação"
info "Esperando o nodyx-core responder..."
PRONTO=0
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null --max-time 3 http://127.0.0.1:3000/; then PRONTO=1; break; fi
  sleep 2
done
[[ $PRONTO == 1 ]] || die "O core não respondeu em 2 min."
ok "nodyx-core responde na 3000"

PRONTO=0
for _ in $(seq 1 30); do
  if curl -fs -o /dev/null --max-time 3 http://127.0.0.1:4173/; then PRONTO=1; break; fi
  sleep 2
done
[[ $PRONTO == 1 ]] || die "O frontend não respondeu em 1 min."
ok "nodyx-frontend responde na 4173"

for app in nodyx-core nodyx-frontend; do
  ST="$("${PM2[@]}" list 2>/dev/null | grep " $app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo ausente)"
  [[ "$ST" == "online" ]] || die "$app está '$ST' e não 'online'."
done
ok "ambos online no PM2"

if [[ $MUDOU_MIGR == 1 ]]; then
  info "Migrations aplicadas no boot:"
  "${PM2[@]}" logs nodyx-core --lines 80 --nostream 2>/dev/null \
    | grep -iE 'migrat' | tail -15 | sed 's/^/     /' || warn "Nada sobre migration no log — confira à mão."
fi

# A CSP que o navegador realmente recebe. É o único teste que vale: o valor no
# disco não prova o que o proxy serve.
DOMINIO="$(grep -E '^PUBLIC_API_URL=' "$NODYX_DIR/nodyx-frontend/.env" | head -1 | cut -d= -f2- | tr -d "\"'")"
if [[ -n "$DOMINIO" && "$DOMINIO" == https://* ]]; then
  CSP="$(curl -sI --max-time 10 "$DOMINIO" | tr -d '\r' | grep -i '^content-security-policy:' || true)"
  if [[ -z "$CSP" ]]; then
    warn "Não consegui ler a CSP servida por $DOMINIO (DNS/firewall?) — confira no navegador."
  elif grep -q 'fonts\.googleapis\.com' <<<"$CSP" && grep -q 'fonts\.gstatic\.com' <<<"$CSP"; then
    ok "a CSP servida ao navegador libera as fontes"
  else
    warn "A CSP servida por $DOMINIO ainda NÃO libera as fontes do Google:"
    echo "     ${CSP:0:400}"
    warn "As fontes dos apelidos vão continuar sem carregar. Confira $CADDYFILE."
  fi
fi

echo
"${PM2[@]}" list
echo
ok "Update concluído: ${OLD_HEAD:0:7} → $("${GIT[@]}" rev-parse --short HEAD)"
