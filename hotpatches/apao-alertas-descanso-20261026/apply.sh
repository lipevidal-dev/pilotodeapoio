#!/usr/bin/env bash
set -euo pipefail

# NÃO reconstrói a imagem admin. O fonte do VPS não fecha ng build.
# Só injeta o JS no nginx que já está rodando, como o patch de férias.

ROOT=/opt/pilotodeapoiov2
BRANCH=cursor/trocas-realocar-visual-326e
RAW="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/${BRANCH}"
PATCH_DIR="$ROOT/hotpatches/apao-alertas-descanso-20261026"
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
VERSION=7
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

# O `up -d` / recreate da imagem apaga o Excel Escala de Revezamento.
# Recoloca em cima do main atual, com nomes novos para furar cache de 7 dias.
curl -fsSL "$RAW/hotpatches/apao-revezamento-20261007/chunk-APAOREV07.js" \
  -o "$WORKDIR/chunk-APAOREV07.js"
curl -fsSL "$RAW/hotpatches/apao-revezamento-20261007/restore-excel.py" \
  -o "$WORKDIR/restore-excel.py"
curl -fsSL "$RAW/hotpatches/apao-revezamento-20261007/logo-gol-wordmark.png" \
  -o "$WORKDIR/logo-gol-wordmark.png" || true
MAIN_JS=$(python3 -c "import re,pathlib; t=pathlib.Path('$WORKDIR/index.html').read_text(); m=re.search(r'main-[A-Za-z0-9]+\.js', t); print(m.group() if m else '')")
test -n "$MAIN_JS"
docker cp "$CID:/usr/share/nginx/html/$MAIN_JS" "$WORKDIR/$MAIN_JS"
for f in chunk-KLMVE6C7.js chunk-UWOXTLJU.js chunk-LJ446U67.js chunk-KLMVE6XLSREV11.js chunk-UWOXTLJU-XLSREV11.js chunk-LJ446U67-XLSREV11.js main-XLSREV11.js; do
  docker cp "$CID:/usr/share/nginx/html/$f" "$WORKDIR/$f" 2>/dev/null || true
done
python3 "$WORKDIR/restore-excel.py" "$WORKDIR"

docker exec "$CID" mkdir -p /usr/share/nginx/html/assets/brand
if [ -f "$WORKDIR/logo-gol-wordmark.png" ]; then
  docker cp "$WORKDIR/logo-gol-wordmark.png" "$CID:/usr/share/nginx/html/assets/brand/logo-gol-wordmark.png"
fi
for f in chunk-APAOREV11.js chunk-KLMVE6XLSREV11.js chunk-UWOXTLJU-XLSREV11.js chunk-LJ446U67-XLSREV11.js main-XLSREV11.js; do
  if [ -f "$WORKDIR/$f" ]; then
    docker cp "$WORKDIR/$f" "$CID:/usr/share/nginx/html/$f"
  fi
done

curl -fsSL "$RAW/hotpatches/employee-observation-20261027/employee-observation.js" \
  -o "$WORKDIR/employee-observation.js"
python3 - "$WORKDIR/index.html" <<'PY'
from pathlib import Path
import re
import sys
index = Path(sys.argv[1])
text = index.read_text(encoding="utf-8")
tag = '<script src="employee-observation.js?v=1"></script>'
if "employee-observation.js" in text:
    text = re.sub(r"employee-observation\.js\?v=\d+", "employee-observation.js?v=1", text)
elif "</body>" in text:
    text = text.replace("</body>", tag + "\n</body>", 1)
else:
    raise SystemExit("index.html sem </body> para observação")
index.write_text(text, encoding="utf-8")
print("index.html cache-bust employee-observation.js?v=1")
PY

docker cp "$PATCH_DIR/apao-alertas.js" "$CID:/usr/share/nginx/html/apao-alertas.js"
docker cp "$WORKDIR/employee-observation.js" "$CID:/usr/share/nginx/html/employee-observation.js"
docker cp "$WORKDIR/index.html" "$CID:/usr/share/nginx/html/index.html"

docker exec "$CID" grep -q "apao-alertas.js?v=${VERSION}" /usr/share/nginx/html/index.html
docker exec "$CID" grep -q "employee-observation.js?v=1" /usr/share/nginx/html/index.html
docker exec "$CID" grep -q "main-XLSREV11.js" /usr/share/nginx/html/index.html
docker exec "$CID" grep -q 'e==="apao"' /usr/share/nginx/html/chunk-KLMVE6XLSREV11.js
curl -fsS "http://127.0.0.1:8080/apao-alertas.js?v=${VERSION}" >/dev/null
curl -fsS "http://127.0.0.1:8080/employee-observation.js?v=1" >/dev/null
curl -fsS "http://127.0.0.1:8080/chunk-APAOREV11.js" >/dev/null

# Coluna + rotas no backend em execução (sem rebuild do admin).
BE="${BACKEND_CONTAINER:-piloto_apoio_backend}"
DB="${DB_CONTAINER:-piloto_apoio_db}"
if docker ps --format '{{.Names}}' | grep -qx "$DB"; then
  docker exec "$DB" psql -U piloto -d piloto_apoio_v2 -c \
    'ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS observation TEXT;'
fi
if docker ps --format '{{.Names}}' | grep -qx "$BE"; then
  curl -fsSL "$RAW/hotpatches/employee-observation-20261027/observation-routes.js" \
    -o "$WORKDIR/employee-observation-routes.js"
  curl -fsSL "$RAW/hotpatches/employee-observation-20261027/patch-backend.py" \
    -o "$WORKDIR/patch-backend.py"
  docker cp "$WORKDIR/employee-observation-routes.js" \
    "$BE:/app/dist/interfaces/http/employee-observation-routes.js"
  docker cp "$BE:/app/dist/interfaces/http/server.js" "$WORKDIR/server.js"
  python3 "$WORKDIR/patch-backend.py" "$WORKDIR/server.js"
  docker cp "$WORKDIR/server.js" "$BE:/app/dist/interfaces/http/server.js"
  docker restart "$BE"
  be_ok=0
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:3333/health >/dev/null; then
      be_ok=1
      break
    fi
    sleep 2
  done
  if [ "$be_ok" != 1 ]; then
    echo "Backend não respondeu em http://127.0.0.1:3333/health após o patch de observação" >&2
    exit 1
  fi
fi

for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8080/ >/dev/null; then
    echo "Deploy APAO concluído; frontend saudável (sem rebuild)."
    exit 0
  fi
  sleep 2
done

echo "Frontend não respondeu em http://127.0.0.1:8080" >&2
exit 1
