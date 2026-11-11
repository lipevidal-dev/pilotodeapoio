#!/usr/bin/env bash
set -euo pipefail

# NÃO reconstrói a imagem admin. Só injeta F4 no nginx e no backend já rodando.

ROOT=/opt/pilotodeapoiov2
BRANCH=cursor/folga-4-f4-326e
RAW="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/${BRANCH}"
PATCH_DIR="$ROOT/hotpatches/folga-4-f4"
ADMIN_CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
BACKEND_CID="${BACKEND_CONTAINER:-piloto_apoio_backend}"
VERSION=1
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

mkdir -p "$PATCH_DIR" "$ROOT/hotpatch-backup/folga-4-f4"

cd "$ROOT"
if ! docker ps --format '{{.Names}}' | grep -qx "$ADMIN_CID"; then
  echo "Container admin parado; subindo a imagem já existente (sem rebuild)."
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-build admin
fi

for f in folga-4.js patch-index.py patch-admin-chunks.py patch-backend-dist.py; do
  curl -fsSL "$RAW/hotpatches/folga-4-f4/$f" -o "$PATCH_DIR/$f"
done

docker cp "$ADMIN_CID:/usr/share/nginx/html/index.html" "$WORKDIR/index.html"
cp -a "$WORKDIR/index.html" "$ROOT/hotpatch-backup/folga-4-f4/index.html"

python3 "$PATCH_DIR/patch-index.py" "$WORKDIR/index.html" "$VERSION"

docker cp "$PATCH_DIR/folga-4.js" "$ADMIN_CID:/usr/share/nginx/html/folga-4.js"
docker cp "$WORKDIR/index.html" "$ADMIN_CID:/usr/share/nginx/html/index.html"

docker cp "$PATCH_DIR/patch-admin-chunks.py" "$ADMIN_CID:/tmp/patch-admin-chunks.py"
docker exec "$ADMIN_CID" python3 /tmp/patch-admin-chunks.py /usr/share/nginx/html

docker exec "$ADMIN_CID" grep -q "folga-4.js?v=${VERSION}" /usr/share/nginx/html/index.html
curl -fsS "http://127.0.0.1:8080/folga-4.js?v=${VERSION}" >/dev/null

if docker ps --format '{{.Names}}' | grep -qx "$BACKEND_CID"; then
  docker cp "$PATCH_DIR/patch-backend-dist.py" "$BACKEND_CID:/tmp/patch-backend-dist.py"
  docker exec "$BACKEND_CID" node -e "require('fs').accessSync('/app/dist')" 2>/dev/null \
    && docker exec "$BACKEND_CID" python3 /tmp/patch-backend-dist.py /app/dist \
    || docker exec "$BACKEND_CID" python3 /tmp/patch-backend-dist.py /usr/src/app/dist \
    || true
  docker restart "$BACKEND_CID"
fi

echo "Deploy Folga 4 concluído (sem rebuild do admin)."
