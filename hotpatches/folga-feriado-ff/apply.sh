#!/usr/bin/env bash
set -euo pipefail

# NÃO reconstrói a imagem admin. Só injeta FF no nginx e no backend já rodando.

ROOT=/opt/pilotodeapoiov2
BRANCH=cursor/apao-alocar-voo-3b73
RAW="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/${BRANCH}"
PATCH_DIR="$ROOT/hotpatches/folga-feriado-ff"
ADMIN_CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
BACKEND_CID="${BACKEND_CONTAINER:-piloto_apoio_backend}"
VERSION=2
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

mkdir -p "$PATCH_DIR" "$ROOT/hotpatch-backup/folga-feriado-ff"

cd "$ROOT"
if ! docker ps --format '{{.Names}}' | grep -qx "$ADMIN_CID"; then
  echo "Container admin parado; subindo a imagem já existente (sem rebuild)."
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-build admin
fi

for f in folga-feriado.js patch-index.py patch-admin-chunks.py; do
  curl -fsSL "$RAW/hotpatches/folga-feriado-ff/$f" -o "$PATCH_DIR/$f"
done

docker cp "$ADMIN_CID:/usr/share/nginx/html/index.html" "$WORKDIR/index.html"
cp -a "$WORKDIR/index.html" "$ROOT/hotpatch-backup/folga-feriado-ff/index.html"

python3 "$PATCH_DIR/patch-index.py" "$WORKDIR/index.html" "$VERSION"

docker cp "$PATCH_DIR/folga-feriado.js" "$ADMIN_CID:/usr/share/nginx/html/folga-feriado.js"
docker cp "$WORKDIR/index.html" "$ADMIN_CID:/usr/share/nginx/html/index.html"

docker cp "$PATCH_DIR/patch-admin-chunks.py" "$ADMIN_CID:/tmp/patch-admin-chunks.py"
docker exec "$ADMIN_CID" python3 /tmp/patch-admin-chunks.py /usr/share/nginx/html

docker exec "$ADMIN_CID" grep -q "folga-feriado.js?v=${VERSION}" /usr/share/nginx/html/index.html
curl -fsS "http://127.0.0.1:8080/folga-feriado.js?v=${VERSION}" >/dev/null

echo "Deploy Folga Feriado concluído (sem rebuild do admin)."
