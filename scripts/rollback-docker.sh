#!/bin/sh
# Volta backend/admin às imagens marcadas ANTES do último deploy.
# Uso (no VPS, em /opt/pilotodeapoiov2):
#   sh scripts/rollback-docker.sh
#
# NÃO apaga o banco. Só troca os containers para as imagens :pre-deploy-rollback.
set -e
DEPLOY_PATH="${DEPLOY_PATH:-/opt/pilotodeapoiov2}"
cd "$DEPLOY_PATH"

echo "==> Rollback Docker (imagens pre-deploy-rollback)..."

if ! docker image inspect piloto_apoio_backend:pre-deploy-rollback >/dev/null 2>&1; then
  echo "ERRO: não achei piloto_apoio_backend:pre-deploy-rollback"
  echo "Rode snapshot-before-deploy.sh ANTES do próximo deploy."
  echo "Fallback: docker images | head  e suba o ID antigo manualmente."
  exit 1
fi

# Recria só os serviços de app com as tags de rollback via compose override temporário
# Abordagem simples: retag como latest do compose e up -d
BACKEND_REPO=$(docker compose --env-file .env.prod -f docker-compose.prod.yml config --images 2>/dev/null | head -1 || true)

# Força os containers a usarem as imagens tagueadas
docker tag piloto_apoio_backend:pre-deploy-rollback workspace-backend:latest 2>/dev/null || true
docker tag piloto_apoio_backend:pre-deploy-rollback pilotodeapoiov2-backend:latest 2>/dev/null || true

# Descobre o nome da imagem que o compose usa
IMG_BACKEND=$(docker inspect --format='{{.Config.Image}}' piloto_apoio_backend 2>/dev/null || echo "")
IMG_ADMIN=$(docker inspect --format='{{.Config.Image}}' piloto_apoio_admin 2>/dev/null || echo "")

if [ -n "$IMG_BACKEND" ]; then
  docker tag piloto_apoio_backend:pre-deploy-rollback "$IMG_BACKEND"
  echo "==> Restaurado backend -> $IMG_BACKEND"
fi

if docker image inspect piloto_apoio_admin:pre-deploy-rollback >/dev/null 2>&1 && [ -n "$IMG_ADMIN" ]; then
  docker tag piloto_apoio_admin:pre-deploy-rollback "$IMG_ADMIN"
  echo "==> Restaurado admin -> $IMG_ADMIN"
fi

docker compose --env-file .env.prod -f docker-compose.prod.yml up -d backend
if docker image inspect piloto_apoio_admin:pre-deploy-rollback >/dev/null 2>&1; then
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d admin
fi

echo "==> Rollback concluído. Teste: https://pcoordenador.com.br/api/health"
echo "    Dados do Postgres permanecem intactos."
