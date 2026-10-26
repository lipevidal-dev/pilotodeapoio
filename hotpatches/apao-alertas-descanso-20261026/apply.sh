#!/usr/bin/env bash
set -euo pipefail

# NÃO reconstrói a imagem admin. O fonte do VPS não fecha ng build.
# Só injeta o JS no nginx que já está rodando, como o patch de férias.

ROOT=/opt/pilotodeapoiov2
BRANCH=cursor/alertas-descanso-apao-326e
RAW="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/${BRANCH}"
PATCH_DIR="$ROOT/hotpatches/apao-alertas-descanso-20261026"
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
VERSION=4
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

mkdir -p "$PATCH_DIR" "$ROOT/hotpatch-backup/apao-alertas-descanso-20261026"

cd "$ROOT"
if ! docker ps --format '{{.Names}}' | grep -qx "$CID"; then
  echo "Container admin parado; subindo a imagem já existente (sem rebuild)."
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-build admin
fi

curl -fsSL "$RAW/hotpatches/apao-alertas-descanso-20261026/apao-alertas.js" \
  -o "$PATCH_DIR/apao-alertas.js"
curl -fsSL "$RAW/hotpatches/apao-alertas-descanso-20261026/patch-index.py" \
  -o "$PATCH_DIR/patch-index.py"

docker cp "$CID:/usr/share/nginx/html/index.html" "$WORKDIR/index.html"
cp -a "$WORKDIR/index.html" "$ROOT/hotpatch-backup/apao-alertas-descanso-20261026/index.html"

python3 "$PATCH_DIR/patch-index.py" "$WORKDIR/index.html" "$VERSION"

docker cp "$PATCH_DIR/apao-alertas.js" "$CID:/usr/share/nginx/html/apao-alertas.js"
docker cp "$WORKDIR/index.html" "$CID:/usr/share/nginx/html/index.html"

docker exec "$CID" grep -q "apao-alertas.js?v=${VERSION}" /usr/share/nginx/html/index.html
curl -fsS "http://127.0.0.1:8080/apao-alertas.js?v=${VERSION}" >/dev/null

for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8080/ >/dev/null; then
    echo "Deploy APAO concluído; frontend saudável (sem rebuild)."
    exit 0
  fi
  sleep 2
done

echo "Frontend não respondeu em http://127.0.0.1:8080" >&2
exit 1
