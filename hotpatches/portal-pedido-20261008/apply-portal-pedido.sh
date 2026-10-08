#!/bin/sh
# Tira Voo e Reunião de assuntos do pedido do funcionário.
# Férias e Outro passam a avisar os admins por e-mail.
# Renomeia o chunk do portal e o main para furar o cache de 7 dias.
set -eu
echo "portal-pedido: iniciando"

patch_admin() {
  python3 - "$1" << 'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
chunk_path = root / "chunk-LJCMTE11A.js"
text = chunk_path.read_text(encoding="utf-8")
voo = ',{type:"VOO",label:"Voo",icon:"pi pi-send"}'
reuniao = ',{type:"REUNIAO_ASSUNTOS",label:"Reuni\\xE3o de assuntos",icon:"pi pi-users"}'
if text.count(voo) != 1:
    raise SystemExit(f"botao Voo: achei {text.count(voo)}")
if text.count(reuniao) != 2:
    raise SystemExit(f"botao Reuniao: achei {text.count(reuniao)}")
text = text.replace(voo, "", 1)
text = text.replace(reuniao, "")
css = ".option-grid[_ngcontent-%COMP%]{display:grid;grid-template-columns:1fr 1fr;gap:.45rem;margin-bottom:.85rem}"
extra = ".option-btn[_ngcontent-%COMP%]:last-child:nth-child(odd){grid-column:1 / -1}"
if text.count(css) != 1:
    raise SystemExit(f"css da grade: achei {text.count(css)}")
if extra not in text:
    text = text.replace(css, css + extra, 1)
if 'label:"Voo"' in text or "REUNIAO_ASSUNTOS" in text:
    raise SystemExit("o menu ainda tem Voo ou Reuniao")
if 'label:"Folga pedida (FP)"' not in text or 'label:"Outro"' not in text:
    raise SystemExit("faltou Folga pedida ou Outro")
(root / "chunk-LJPORT13A.js").write_text(text, encoding="utf-8")
print("admin patch ok")
PY
}

if [ "${1:-}" = "--patch-admin" ]; then
  patch_admin "$2"
  exit 0
fi

ADMIN="${ADMIN_CONTAINER:-piloto_apoio_admin}"
BACKEND="${BACKEND_CONTAINER:-piloto_apoio_backend}"
BASE="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/portal-pedido-tres-opcoes-e58d/hotpatches/portal-pedido-20261008"
WORKDIR=/tmp/portal-pedido-13
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

curl -fsSL "$BASE/patch_backend.py?v=4" -o patch_backend.py
curl -fsSL "$BASE/portal-request-notify.js?v=4" -o portal-request-notify.js
grep -q "collectAdminEmails" portal-request-notify.js
grep -q "remove_voo_from_pao_set" patch_backend.py

docker cp "$ADMIN:/usr/share/nginx/html/index.html" index.html
MAIN=$(grep -o 'main-APAOREV1[12]\.js' index.html | head -n 1)
if [ -z "$MAIN" ]; then
  echo "index sem main-APAOREV11.js ou main-APAOREV12.js" >&2
  exit 1
fi
docker cp "$ADMIN:/usr/share/nginx/html/$MAIN" "$MAIN"
docker cp "$ADMIN:/usr/share/nginx/html/chunk-LJCMTE11A.js" chunk-LJCMTE11A.js
docker cp "$BACKEND:/app/dist/application/use-cases/portal-request.use-case.js" portal-request.use-case.js

grep -q "chunk-LJCMTE11A.js" "$MAIN"
grep -q 'id="schedule-expand-hot-style"' index.html || true

patch_admin "$WORKDIR"
python3 patch_backend.py portal-request.use-case.js

python3 - << 'PY'
from pathlib import Path
main = next(Path(".").glob("main-APAOREV1*.js"))
text = main.read_text(encoding="utf-8")
if text.count("chunk-LJCMTE11A.js") != 1:
    raise SystemExit("import do chunk do portal nao e unico")
main.write_text(text.replace("chunk-LJCMTE11A.js", "chunk-LJPORT13A.js"), encoding="utf-8")
index = Path("index.html")
html = index.read_text(encoding="utf-8")
old = main.name
if html.count(old) != 1:
    raise SystemExit(f"index: {old} apareceu {html.count(old)} vezes")
index.write_text(html.replace(old, "main-APAOREV13.js"), encoding="utf-8")
Path("main-APAOREV13.js").write_text(main.read_text(encoding="utf-8"), encoding="utf-8")
print("rename ok", old)
PY

if ! grep -q 'id="schedule-expand-hot-style"' index.html && grep -q 'schedule-expand-hot-style' "$MAIN"; then
  echo "o css do resumo sumiu do index" >&2
  exit 1
fi

docker cp chunk-LJPORT13A.js "$BACKEND:/tmp/chunk-LJPORT13A.js"
docker cp portal-request.use-case.js "$BACKEND:/tmp/portal-request.use-case.js"
docker cp portal-request-notify.js "$BACKEND:/tmp/portal-request-notify.js"
docker exec "$BACKEND" node --check /tmp/chunk-LJPORT13A.js
docker exec "$BACKEND" node --check /tmp/portal-request.use-case.js
docker exec "$BACKEND" node --check /tmp/portal-request-notify.js

docker cp chunk-LJPORT13A.js "$ADMIN:/usr/share/nginx/html/chunk-LJPORT13A.js"
docker cp main-APAOREV13.js "$ADMIN:/usr/share/nginx/html/main-APAOREV13.js"
docker cp index.html "$ADMIN:/usr/share/nginx/html/index.html"
docker cp portal-request.use-case.js "$BACKEND:/app/dist/application/use-cases/portal-request.use-case.js"
docker cp portal-request-notify.js "$BACKEND:/app/dist/application/use-cases/portal-request-notify.js"

echo "reiniciando piloto_apoio_backend"
docker restart "$BACKEND" >/dev/null

ok=0
i=0
while [ "$i" -lt 40 ]; do
  i=$((i + 1))
  sleep 3
  if curl -fsS "http://127.0.0.1:3333/health" -o /dev/null 2>/dev/null; then
    ok=1
    break
  fi
done
if [ "$ok" -ne 1 ]; then
  echo "a API nao voltou" >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:8080/index.html" | grep -q "main-APAOREV13.js"
curl -fsS "http://127.0.0.1:8080/main-APAOREV13.js" | grep -q "chunk-LJPORT13A.js"
CHUNK=$(curl -fsS "http://127.0.0.1:8080/chunk-LJPORT13A.js")
printf '%s' "$CHUNK" | grep -q 'label:"Folga pedida (FP)"'
printf '%s' "$CHUNK" | grep -q 'type:"FERIAS"'
printf '%s' "$CHUNK" | grep -q 'label:"Outro"'
if printf '%s' "$CHUNK" | grep -q 'label:"Voo"'; then
  echo "o botao Voo ainda esta no chunk publicado" >&2
  exit 1
fi
if printf '%s' "$CHUNK" | grep -q 'REUNIAO_ASSUNTOS'; then
  echo "o botao Reuniao ainda esta no chunk publicado" >&2
  exit 1
fi
docker exec "$BACKEND" grep -q "notifyAdminsOfPortalRequest" /app/dist/application/use-cases/portal-request.use-case.js
docker exec "$BACKEND" grep -q "collectAdminEmails" /app/dist/application/use-cases/portal-request-notify.js

echo "portal-pedido ok: menu com folga, ferias e outro"
