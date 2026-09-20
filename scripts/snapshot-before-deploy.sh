#!/bin/sh
# Snapshot das imagens Docker atuais no VPS — rode ANTES do deploy.
# Uso (no VPS, em /opt/pilotodeapoiov2):
#   sh scripts/snapshot-before-deploy.sh
set -e
DEPLOY_PATH="${DEPLOY_PATH:-/opt/pilotodeapoiov2}"
cd "$DEPLOY_PATH"
STAMP=$(date -u +%Y%m%d-%H%M%S)
DIR="$DEPLOY_PATH/.rollback"
mkdir -p "$DIR"

echo "==> Salvando estado das imagens em $DIR/images-$STAMP.txt"
{
  echo "timestamp=$STAMP"
  echo "backend=$(docker inspect --format='{{.Image}}' piloto_apoio_backend 2>/dev/null || echo none)"
  echo "admin=$(docker inspect --format='{{.Image}}' piloto_apoio_admin 2>/dev/null || echo none)"
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}' | grep -E 'piloto|backend|admin' || true
} | tee "$DIR/images-$STAMP.txt"

# Tags nomeadas para rollback fácil
BACKEND_ID=$(docker inspect --format='{{.Image}}' piloto_apoio_backend 2>/dev/null || true)
ADMIN_ID=$(docker inspect --format='{{.Image}}' piloto_apoio_admin 2>/dev/null || true)

if [ -n "$BACKEND_ID" ] && [ "$BACKEND_ID" != "none" ]; then
  docker tag "$BACKEND_ID" piloto_apoio_backend:pre-deploy-rollback
  echo "==> Tag criada: piloto_apoio_backend:pre-deploy-rollback"
fi
if [ -n "$ADMIN_ID" ] && [ "$ADMIN_ID" != "none" ]; then
  docker tag "$ADMIN_ID" piloto_apoio_admin:pre-deploy-rollback
  echo "==> Tag criada: piloto_apoio_admin:pre-deploy-rollback"
fi

echo "==> Snapshot OK. Banco (volume piloto_pg_data) NÃO é alterado."
echo "    Para voltar: sh scripts/rollback-docker.sh"
