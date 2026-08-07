#!/usr/bin/env bash
# Deploy Linux (equivalente ao scripts/deploy.ps1 do Windows).
# Empacota o projeto, envia por SCP ao VPS e rebuilda Docker Compose de produção.
#
# Uso (na raiz do projeto):
#   ./scripts/deploy.sh
#
# Pré-requisitos:
#   - .env.deploy preenchido (veja .env.deploy.example)
#   - chave SSH com acesso a VPS_USER@VPS_HOST (ssh-agent ou ~/.ssh/id_*)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env.deploy"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: crie .env.deploy a partir de .env.deploy.example"
  exit 1
fi

# shellcheck disable=SC1090
set -a
# strip CR if file came from Windows
source <(sed 's/\r$//' "$ENV_FILE" | grep -E '^[A-Za-z_][A-Za-z0-9_]*=')
set +a

: "${VPS_HOST:?VPS_HOST ausente em .env.deploy}"
: "${VPS_USER:?VPS_USER ausente em .env.deploy}"
: "${DEPLOY_PATH:?DEPLOY_PATH ausente em .env.deploy}"

SSH_PORT="${SSH_PORT:-22}"
REMOTE="${VPS_USER}@${VPS_HOST}"
ARCHIVE="/tmp/pilotodeapoiov2-deploy.tgz"
REMOTE_ARCHIVE="/tmp/pilotodeapoiov2-deploy.tgz"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)

echo "==> Empacotando projeto..."
rm -f "$ARCHIVE"
tar -czf "$ARCHIVE" \
  --exclude='./node_modules' \
  --exclude='./frontend-admin/node_modules' \
  --exclude='./backend/node_modules' \
  --exclude='./dist' \
  --exclude='./frontend-admin/dist' \
  --exclude='./backend/dist' \
  --exclude='./.angular' \
  --exclude='./.git' \
  --exclude='./coverage' \
  --exclude='./docker-data' \
  --exclude='./_archive' \
  --exclude='./.env' \
  --exclude='./.env.deploy' \
  --exclude='./.env.prod' \
  --exclude='./backend/.env' \
  -C "$ROOT" .

echo "==> Enviando para ${REMOTE} ..."
scp "${SCP_OPTS[@]}" "$ARCHIVE" "${REMOTE}:${REMOTE_ARCHIVE}"
scp "${SCP_OPTS[@]}" "$ROOT/scripts/deploy-remote.sh" "${REMOTE}:/tmp/deploy-remote.sh"

FIX_SH="find '${DEPLOY_PATH}/scripts' -name '*.sh' -exec sed -i 's/\\r\$//' {} + 2>/dev/null; sed -i 's/\\r\$//' /tmp/deploy-remote.sh 2>/dev/null; true"

echo "==> Rebuild no servidor..."
ssh "${SSH_OPTS[@]}" "$REMOTE" \
  "${FIX_SH} && chmod +x /tmp/deploy-remote.sh && DEPLOY_PATH='${DEPLOY_PATH}' APP_DOMAIN='${APP_DOMAIN:-}' sh /tmp/deploy-remote.sh '${REMOTE_ARCHIVE}'"

echo
echo "Deploy concluído! https://www.${APP_DOMAIN:-pcoordenador.com.br}/"
