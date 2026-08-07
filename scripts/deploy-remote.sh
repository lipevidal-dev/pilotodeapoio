#!/bin/sh
set -e

DEPLOY_PATH="${DEPLOY_PATH:-/opt/pilotodeapoiov2}"
ARCHIVE="${1:-/tmp/pilotodeapoiov2-deploy.tgz}"

if [ ! -f "$ARCHIVE" ]; then
  echo "ERRO: pacote não encontrado: $ARCHIVE"
  exit 1
fi

mkdir -p "$DEPLOY_PATH"

# Extrai em pasta temporária e sincroniza com --delete para remover arquivos
# antigos do servidor que não existem mais no pacote (evita build quebrado).
TMP_DIR="$(mktemp -d /tmp/piloto-deploy-XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

tar -xzf "$ARCHIVE" -C "$TMP_DIR"
find "$TMP_DIR/scripts" -name '*.sh' -exec sed -i 's/\r$//' {} + 2>/dev/null || true
sed -i 's/\r$//' "$0" 2>/dev/null || true

# Preserva segredos de produção já existentes no VPS
if [ -f "$DEPLOY_PATH/.env.prod" ]; then
  cp "$DEPLOY_PATH/.env.prod" "$TMP_DIR/.env.prod"
fi

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.env.prod' \
    --exclude 'docker-data' \
    --exclude '.git' \
    "$TMP_DIR"/ "$DEPLOY_PATH"/
else
  # Fallback sem rsync: limpa fontes e reextrai
  rm -rf "$DEPLOY_PATH/backend/src" \
         "$DEPLOY_PATH/frontend-admin/src" \
         "$DEPLOY_PATH/backend/prisma" \
         "$DEPLOY_PATH/scripts"
  tar -xzf "$ARCHIVE" -C "$DEPLOY_PATH"
  if [ -f "$TMP_DIR/.env.prod" ]; then
    cp "$TMP_DIR/.env.prod" "$DEPLOY_PATH/.env.prod"
  fi
fi

cd "$DEPLOY_PATH"

if [ ! -f .env.prod ]; then
  if [ -f .env.prod.example ]; then
    cp .env.prod.example .env.prod
    POSTGRES_PASSWORD=$(openssl rand -hex 16)
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/troque-por-senha-forte-do-banco/${POSTGRES_PASSWORD}/" .env.prod
    sed -i "s/troque-por-frase-longa-e-aleatoria-minimo-32-caracteres/${JWT_SECRET}/" .env.prod
    echo "==> .env.prod criado a partir do exemplo."
  else
    echo "ERRO: .env.prod não existe em $DEPLOY_PATH"
    exit 1
  fi
fi

echo "==> Rebuild e restart (produção)..."
docker compose --env-file .env.prod -f docker-compose.prod.yml build backend admin
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d

# Atualiza gzip no nginx do host (se o site template existir)
if [ -f "$DEPLOY_PATH/infra/nginx/production-site.conf" ] && [ -n "${APP_DOMAIN:-}" ]; then
  NGINX_SITE="/etc/nginx/sites-available/pcoordenador"
  if [ -f "$NGINX_SITE" ]; then
    echo "==> Atualizando gzip no nginx (preserva SSL do Certbot via include parcial)..."
    if ! grep -q "gzip_proxied" "$NGINX_SITE" 2>/dev/null; then
      sed -i '/server_name /a\    gzip on;\n    gzip_proxied any;\n    gzip_comp_level 5;\n    gzip_min_length 256;\n    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;' "$NGINX_SITE" || true
      nginx -t && systemctl reload nginx || true
    fi
  fi
fi

docker image prune -f >/dev/null 2>&1 || true

echo "==> Deploy concluído."
