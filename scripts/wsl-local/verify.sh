#!/usr/bin/env bash
# Confere migration, tabelas, seed e HTTP depois de um deploy.sh. Não
# precisa de sudo (lê .env com credenciais do banco, que é legível por
# qualquer um em /opt/nodyx/nodyx-core/.env — 644).
# Ver README.md nesta pasta pro contexto completo.
set -uo pipefail

ENV_FILE=/opt/nodyx/nodyx-core/.env
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
export PGPASSWORD="$DB_PASSWORD"

echo "=== 1. Migrations do trik aplicadas? ==="
psql -h localhost -U nodyx_user -d nodyx -c "SELECT version, run_at FROM schema_migrations WHERE version LIKE 'trik%' ORDER BY run_at;"

echo
echo "=== 2. Tabelas trik_* existem? ==="
psql -h localhost -U nodyx_user -d nodyx -c "\dt trik_*"

echo
echo "=== 3. Curva de XP (todos os types) ==="
psql -h localhost -U nodyx_user -d nodyx -c "SELECT type, level, goal_xp, req_mastery, req_education FROM trik_progression ORDER BY type, level;"

echo
echo "=== 4. PM2 (precisa root) ==="
if [[ $EUID -eq 0 ]]; then
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list
else
  echo "(pulei — rode com sudo pra ver o status do PM2)"
fi

echo
echo "=== 5. Backend responde? ==="
curl -s -o /dev/null -w "nodyx-core (porta 3000): HTTP %{http_code}\n" --max-time 10 http://localhost:3000/ || echo "nodyx-core: SEM RESPOSTA"

echo
echo "=== 6. Frontend responde? ==="
curl -s -o /dev/null -w "nodyx-frontend (porta 4173): HTTP %{http_code}\n" --max-time 10 http://localhost:4173/ || echo "nodyx-frontend: SEM RESPOSTA"

echo
echo "=== 7. Rotas novas (sem token, espera 401 = existe e está protegida) ==="
curl -s -o /dev/null -w "GET /api/v1/admin/trik/xp-levels: HTTP %{http_code}\n" --max-time 10 http://localhost:3000/api/v1/admin/trik/xp-levels
curl -s -o /dev/null -w "GET /api/v1/admin/trik/registros: HTTP %{http_code}\n" --max-time 10 http://localhost:3000/api/v1/admin/trik/registros
