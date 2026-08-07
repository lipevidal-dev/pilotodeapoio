#!/bin/sh
set -e

DEPLOY_PATH="${DEPLOY_PATH:-/opt/pilotodeapoiov2}"
ARCHIVE="${1:-/tmp/pilotodeapoiov2-deploy.tgz}"

if [ ! -f "$ARCHIVE" ]; then
  echo "ERRO: pacote não encontrado: $ARCHIVE"
  exit 1
fi

mkdir -p "$DEPLOY_PATH"

# IMPORTANTE: NÃO apagar arquivos existentes no VPS.
# O extract só sobrescreve o que veio no pacote. Remover fontes "extras"
# no servidor já derrubou produção quando o pacote vinha de uma branch incompleta.
tar -xzf "$ARCHIVE" -C "$DEPLOY_PATH"
find "$DEPLOY_PATH/scripts" -name '*.sh' -exec sed -i 's/\r$//' {} + 2>/dev/null || true
sed -i 's/\r$//' "$0" 2>/dev/null || true

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

# NÃO rodar docker image prune aqui — remove imagens anteriores necessárias para rollback.

echo "==> Deploy concluído."
