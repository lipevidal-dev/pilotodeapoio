#!/usr/bin/env bash
# Hotfix: sobe só o backend (não rebuilda admin).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env.deploy"
[[ -f "$ENV_FILE" ]] || { echo "ERRO: falta .env.deploy"; exit 1; }
set -a; source <(sed 's/\r$//' "$ENV_FILE" | grep -E '^[A-Za-z_][A-Za-z0-9_]*='); set +a
: "${VPS_HOST:?}"; : "${VPS_USER:?}"; : "${DEPLOY_PATH:?}"
SSH_PORT="${SSH_PORT:-22}"
REMOTE="${VPS_USER}@${VPS_HOST}"
ARCHIVE="/tmp/pilotodeapoiov2-deploy.tgz"
REMOTE_ARCHIVE="/tmp/pilotodeapoiov2-deploy.tgz"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)

echo "==> Empacotando..."
rm -f "$ARCHIVE"
tar -czf "$ARCHIVE" \
  --exclude='./node_modules' --exclude='./frontend-admin/node_modules' --exclude='./backend/node_modules' \
  --exclude='./dist' --exclude='./frontend-admin/dist' --exclude='./backend/dist' \
  --exclude='./.angular' --exclude='./.git' --exclude='./coverage' --exclude='./docker-data' \
  --exclude='./_archive' --exclude='./.env' --exclude='./.env.deploy' --exclude='./.env.prod' \
  --exclude='./backend/.env' -C "$ROOT" .

echo "==> Enviando para ${REMOTE}..."
scp "${SCP_OPTS[@]}" "$ARCHIVE" "${REMOTE}:${REMOTE_ARCHIVE}"

echo "==> Atualizando só o BACKEND no servidor..."
ssh "${SSH_OPTS[@]}" "$REMOTE" bash -s << REMOTE
set -e
DEPLOY_PATH='${DEPLOY_PATH}'
mkdir -p "\$DEPLOY_PATH"
tar -xzf '${REMOTE_ARCHIVE}' -C "\$DEPLOY_PATH"
cd "\$DEPLOY_PATH"
# Snapshot ANTES do rebuild — permite voltar se der merda
if [ -f scripts/snapshot-before-deploy.sh ]; then
  sed -i 's/\r\$//' scripts/snapshot-before-deploy.sh scripts/rollback-docker.sh 2>/dev/null || true
  chmod +x scripts/snapshot-before-deploy.sh scripts/rollback-docker.sh
  sh scripts/snapshot-before-deploy.sh || true
fi
docker compose --env-file .env.prod -f docker-compose.prod.yml build backend
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d backend
echo "Backend atualizado."
echo "Se precisar voltar: cd \$DEPLOY_PATH && sh scripts/rollback-docker.sh"
REMOTE

echo
echo "Pronto! Teste: https://pcoordenador.com.br/"
echo "Rollback no VPS (se precisar): cd /opt/pilotodeapoiov2 && sh scripts/rollback-docker.sh"
