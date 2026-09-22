#!/usr/bin/env bash
# APAGA todas as tabelas trik_* do banco de teste e o registro de que as
# migrations trik_* já rodaram — o próximo boot do nodyx-core recria tudo do
# zero a partir de trik_001_registro.sql / trik_002_xp.sql.
#
# Quando usar: as migrations trik foram consolidadas na forma final (sem
# CREATE + ALTER/RENAME). O runner não reaplica uma migration já registrada em
# schema_migrations, então um banco que rodou a versão antiga precisa ser
# resetado UMA vez antes do deploy da versão nova. Banco novo não precisa.
#
# DESTRUTIVO: perde jogadores, personagens, awards de xp e catálogos do
# módulo RPG. Não mexe em nenhuma tabela do nodyx (users, threads, posts…).
# Não precisa de sudo (usa as credenciais de /opt/nodyx/nodyx-core/.env).
set -euo pipefail

ENV=/opt/nodyx/nodyx-core/.env
get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" ; }
export PGPASSWORD="$(get DB_PASSWORD)"
DB_HOST="$(get DB_HOST)"; DB_HOST="${DB_HOST:-localhost}"
PSQL=(psql -h "$DB_HOST" -U "$(get DB_USER)" -d "$(get DB_NAME)" -v ON_ERROR_STOP=1 -X -q)

echo "=== Vai apagar no banco '$(get DB_NAME)': ==="
"${PSQL[@]}" -At -c "SELECT '  tabela  ' || tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'trik\_%' ORDER BY 1"
"${PSQL[@]}" -At -c "SELECT '  migration ' || version FROM schema_migrations WHERE version LIKE 'trik%' ORDER BY 1"
echo
echo "=== Dados que serão perdidos: ==="
"${PSQL[@]}" -At -c "SELECT '  jogadores: ' || count(*) FROM trik_players" 2>/dev/null || true
"${PSQL[@]}" -At -c "SELECT '  personagens: ' || count(*) FROM trik_characters" 2>/dev/null || true
"${PSQL[@]}" -At -c "SELECT '  awards de xp: ' || count(*) FROM trik_scene_awards" 2>/dev/null || true
echo
# --yes pula a pergunta (usado por full-reset.sh, que já pediu a própria confirmação).
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Digite APAGAR para confirmar (qualquer outra coisa cancela): " answer
  [ "$answer" = "APAGAR" ] || { echo "Cancelado, nada foi alterado."; exit 1; }
fi

{
  echo "BEGIN;"
  "${PSQL[@]}" -At -c "SELECT 'DROP TABLE IF EXISTS ' || quote_ident(tablename) || ' CASCADE;' FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'trik\_%'"
  echo "DELETE FROM schema_migrations WHERE version LIKE 'trik%';"
  echo "COMMIT;"
} | "${PSQL[@]}"

echo "Pronto. Rode o deploy (stage.sh + deploy.sh); o nodyx-core recria as tabelas no boot."
