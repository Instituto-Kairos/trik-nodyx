#!/usr/bin/env bash
# Copia TUDO que este repo tem de diferente do último commit (arquivos
# modificados + novos, respeitando o .gitignore) em nodyx-core e
# nodyx-frontend pra /tmp dentro do WSL, prontos pra deploy.sh instalar em
# /opt/nodyx. Não precisa de sudo — só leitura do repo (montado em /mnt/c) e
# escrita em /tmp.
#
# A lista é derivada do git (não é manual): as correções do fork que não são
# do módulo RPG (linkify, socket, layout, locales, testes...) também melhoram
# o nodyx pra quem vai jogar, então nada fica de fora. Arquivo novo ou editado
# entra sozinho — não precisa mexer neste script.
# Ver README.md nesta pasta pro contexto completo.
set -euo pipefail

LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAGE=/tmp/trik-fase2-deploy

rm -rf "$STAGE"
mkdir -p "$STAGE/nodyx-core" "$STAGE/nodyx-frontend"

# safe.directory='*' porque o repo está num mount do Windows (dono diferente).
copy_changed() {
  local proj="$1"
  cd "$LOCAL/$proj"
  # `ls-files -m` só compara stat (que difere entre Windows e WSL e marca o repo
  # todo como modificado); `diff --name-only HEAD` compara o conteúdo de verdade — com autocrlf=true, que o
  # git do WSL não herda da config global do Windows (senão todo arquivo CRLF vira "modificado").
  { git -c safe.directory='*' -c core.filemode=false -c core.autocrlf=true diff --name-only --relative HEAD
    git -c safe.directory='*' -c core.autocrlf=true ls-files -o --exclude-standard
  } | sort -u \
    | while IFS= read -r f; do [[ -f "$f" ]] && printf '%s\n' "$f"; done \
    | xargs -d '\n' -r cp --parents -t "$STAGE/$proj/"
}

copy_changed nodyx-core
copy_changed nodyx-frontend

TOTAL=$(find "$STAGE" -type f | wc -l)
[[ "$TOTAL" -gt 0 ]] || { echo "Nada pra staging — git não listou nenhum arquivo." >&2; exit 1; }

echo "--- staged em $STAGE ($TOTAL arquivos) ---"
find "$STAGE" -type f | sort
