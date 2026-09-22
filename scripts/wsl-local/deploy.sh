#!/usr/bin/env bash
# Instala os arquivos do módulo RPG (trik) staged por stage.sh em
# /opt/nodyx, builda e reinicia. Precisa de root de verdade (senha
# interativa) — por isso é um script separado do staging.
# Rode: sudo bash scripts/wsl-local/deploy.sh
# Ver README.md nesta pasta pro contexto completo.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Rode com sudo: sudo bash $0"

STAGE=/tmp/trik-fase2-deploy
NODYX_DIR=/opt/nodyx

[[ -d "$STAGE" ]] || die "Staging não encontrado em $STAGE — rode stage.sh primeiro (sem sudo)."

info "Copiando arquivos do trik pra $NODYX_DIR (dono nodyx:nodyx)..."
( cd "$STAGE/nodyx-core" && find . -type f ) | while read -r f; do
  install -o nodyx -g nodyx -m 644 -D "$STAGE/nodyx-core/$f" "$NODYX_DIR/nodyx-core/$f"
done
( cd "$STAGE/nodyx-frontend" && find . -type f ) | while read -r f; do
  install -o nodyx -g nodyx -m 644 -D "$STAGE/nodyx-frontend/$f" "$NODYX_DIR/nodyx-frontend/$f"
done
# `install -D` cria os diretórios que faltam como root; o git do usuário nodyx
# (nodyx-update, full-reset.sh) não consegue mexer neles depois. Corrige o dono.
find "$NODYX_DIR/nodyx-core/src" "$NODYX_DIR/nodyx-frontend/src" ! -user nodyx -exec chown nodyx:nodyx {} +
ok "Arquivos copiados"

# `npm ci` apaga e reinstala o node_modules inteiro — o passo mais lento do deploy —
# e só é preciso quando as dependências mudaram. Guarda o hash do package-lock.json
# da última instalação dentro do próprio node_modules (some junto se ele for apagado).
npm_install_if_needed() {
  local marker="node_modules/.deploy-lock-hash" want
  want="$(sha256sum package-lock.json | cut -d' ' -f1)"
  if [[ -d node_modules && -f "$marker" && "$(cat "$marker")" == "$want" ]]; then
    ok "package-lock.json inalterado — pulando npm ci"
  else
    npm ci --no-fund --no-audit --silent
    echo "$want" > "$marker"
  fi
}

info "Rebuild backend..."
cd "$NODYX_DIR/nodyx-core"
npm_install_if_needed
npm run build || die "Build backend falhou."
ok "Backend compilado"

info "Rebuild frontend..."
cd "$NODYX_DIR/nodyx-frontend"
npm_install_if_needed
npm run build || die "Build frontend falhou."
ok "Frontend compilado"

info "Reiniciando serviços..."
cd "$NODYX_DIR"
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart ecosystem.config.js --update-env
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

echo ""
ok "trik instalado e serviços reiniciados."
info "Confira o log de boot do nodyx-core pra ver as migrations aplicarem:"
echo "   sudo runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 40 --nostream | grep -i migrate"
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list
