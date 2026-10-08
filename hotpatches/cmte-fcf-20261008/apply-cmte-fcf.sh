#!/bin/sh
# Coloca cargo FCF na mesma faixa do CMTE e troca o título para CMTE / FCF.
# Renomeia a cadeia de chunks para furar o cache de 7 dias.
# Não mexe no CSS do resumo que já está no index.html.
set -eu
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
WORKDIR=/tmp/cmte-fcf-11
BASE="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/cmte-fcf-grupo-e58d/hotpatches/cmte-fcf-20261008"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

curl -fsSL "$BASE/chunk-CMTEFCF1.js?v=1" -o chunk-CMTEFCF1.js
grep -q 's.isCmte||s.isFcf' chunk-CMTEFCF1.js
grep -q 'label:"CMTE / FCF"' chunk-CMTEFCF1.js
if grep -q 's.type==="PAO"&&s.isCmte' chunk-CMTEFCF1.js; then
  echo "o mapper baixado ainda separa só o CMTE" >&2
  exit 1
fi

docker cp "$CID:/usr/share/nginx/html/index.html" index.html
docker cp "$CID:/usr/share/nginx/html/main-APAOREV10.js" main-APAOREV10.js
docker cp "$CID:/usr/share/nginx/html/chunk-LJCMTE10A.js" chunk-LJCMTE10A.js
docker cp "$CID:/usr/share/nginx/html/chunk-UWCMTE10B.js" chunk-UWCMTE10B.js
docker cp "$CID:/usr/share/nginx/html/chunk-7EF52OXQ.js" chunk-7EF52OXQ.js
docker cp "$CID:/usr/share/nginx/html/chunk-AO4OJGJK.js" chunk-AO4OJGJK.js
docker cp "$CID:/usr/share/nginx/html/chunk-DJNFNQC3.js" chunk-DJNFNQC3.js
docker cp "$CID:/usr/share/nginx/html/chunk-XOGQM7RB.js" chunk-XOGQM7RB.js
docker cp "$CID:/usr/share/nginx/html/chunk-YJY4BHII.js" chunk-YJY4BHII.js
docker cp "$CID:/usr/share/nginx/html/chunk-KLMVE6ESP.js" chunk-KLMVE6ESP.js
docker cp "$CID:/usr/share/nginx/html/chunk-C7RKSGLJ.js" chunk-C7RKSGLJ.js
docker cp "$CID:/usr/share/nginx/html/chunk-KDIG6MPL.js" chunk-KDIG6MPL.js

grep -q 'main-APAOREV10.js' index.html
grep -q 'chunk-RE3SKUGO.js' chunk-KLMVE6ESP.js
grep -q 'chunk-LJCMTE10A.js' main-APAOREV10.js
grep -q 'chunk-UWCMTE10B.js' main-APAOREV10.js
grep -q 'id="schedule-expand-hot-style"' index.html
grep -q 'id="lead-toggle-hot-style"' index.html

python3 - << 'PY'
from pathlib import Path

repls = [
    ("chunk-RE3SKUGO.js", "chunk-CMTEFCF1.js"),
    ("chunk-KDIG6MPL.js", "chunk-KDIGFCF1.js"),
    ("chunk-C7RKSGLJ.js", "chunk-C7RKFCF1.js"),
    ("chunk-KLMVE6ESP.js", "chunk-KLMVE6FCF.js"),
    ("chunk-7EF52OXQ.js", "chunk-7EF52FCF.js"),
    ("chunk-AO4OJGJK.js", "chunk-AO4OFCF1.js"),
    ("chunk-DJNFNQC3.js", "chunk-DJNFFCF1.js"),
    ("chunk-LJCMTE10A.js", "chunk-LJCMTE11A.js"),
    ("chunk-UWCMTE10B.js", "chunk-UWCMTE11B.js"),
    ("chunk-XOGQM7RB.js", "chunk-XOGQFCF1.js"),
    ("chunk-YJY4BHII.js", "chunk-YJY4FCF1.js"),
    ("main-APAOREV10.js", "main-APAOREV11.js"),
]

outputs = {
    "chunk-KDIG6MPL.js": "chunk-KDIGFCF1.js",
    "chunk-C7RKSGLJ.js": "chunk-C7RKFCF1.js",
    "chunk-KLMVE6ESP.js": "chunk-KLMVE6FCF.js",
    "chunk-7EF52OXQ.js": "chunk-7EF52FCF.js",
    "chunk-AO4OJGJK.js": "chunk-AO4OFCF1.js",
    "chunk-DJNFNQC3.js": "chunk-DJNFFCF1.js",
    "chunk-LJCMTE10A.js": "chunk-LJCMTE11A.js",
    "chunk-UWCMTE10B.js": "chunk-UWCMTE11B.js",
    "chunk-XOGQM7RB.js": "chunk-XOGQFCF1.js",
    "chunk-YJY4BHII.js": "chunk-YJY4FCF1.js",
    "main-APAOREV10.js": "main-APAOREV11.js",
    "index.html": "index.html.new",
}

portal_old = 'c.type==="CMTE"?z(N({},c),{rows:[]}):c'
portal_new = 'c.type==="CMTE"?z(N({},c),{rows:c.rows.filter(r=>r.employeeId===this.linkedEmployeeId())}):c'

for src, dst in outputs.items():
    text = Path(src).read_text(encoding="utf-8")
    if src == "chunk-UWCMTE10B.js":
        if text.count(portal_old) != 1:
            raise SystemExit("nao achei o recolhimento do CMTE no portal")
        text = text.replace(portal_old, portal_new, 1)
    if src == "chunk-KLMVE6ESP.js":
        if "Mostrar comandantes" not in text or "Recolher comandantes" not in text:
            raise SystemExit("nao achei o titulo do botao da faixa")
        text = text.replace("Recolher comandantes", "Recolher CMTE / FCF")
        text = text.replace("Mostrar comandantes", "Mostrar CMTE / FCF")
    for old, new in repls:
        text = text.replace(old, new)
    Path(dst).write_text(text, encoding="utf-8")
PY

grep -q 'chunk-CMTEFCF1.js' chunk-KDIGFCF1.js
grep -q 'chunk-CMTEFCF1.js' chunk-C7RKFCF1.js
grep -q 'chunk-CMTEFCF1.js' chunk-KLMVE6FCF.js
grep -q 'chunk-KDIGFCF1.js' chunk-KLMVE6FCF.js
grep -q 'Mostrar CMTE / FCF' chunk-KLMVE6FCF.js
grep -q 'chunk-C7RKFCF1.js' chunk-7EF52FCF.js
grep -q 'chunk-C7RKFCF1.js' chunk-YJY4FCF1.js
grep -q 'chunk-KLMVE6FCF.js' chunk-LJCMTE11A.js
grep -q 'chunk-KLMVE6FCF.js' chunk-UWCMTE11B.js
grep -q 'linkedEmployeeId()' chunk-UWCMTE11B.js
grep -q 'chunk-LJCMTE11A.js' main-APAOREV11.js
grep -q 'chunk-UWCMTE11B.js' main-APAOREV11.js
grep -q 'chunk-7EF52FCF.js' main-APAOREV11.js
grep -q 'chunk-XOGQFCF1.js' main-APAOREV11.js
grep -q 'main-APAOREV11.js' index.html.new
grep -q 'id="schedule-expand-hot-style"' index.html.new
grep -q 'id="lead-toggle-hot-style"' index.html.new

if grep -q 'chunk-RE3SKUGO.js' \
  main-APAOREV11.js \
  chunk-LJCMTE11A.js \
  chunk-UWCMTE11B.js \
  chunk-KLMVE6FCF.js \
  chunk-7EF52FCF.js \
  chunk-AO4OFCF1.js \
  chunk-DJNFFCF1.js \
  chunk-XOGQFCF1.js \
  chunk-YJY4FCF1.js \
  chunk-C7RKFCF1.js \
  chunk-KDIGFCF1.js
then
  echo "algum arquivo ainda aponta para o mapper antigo" >&2
  exit 1
fi
if grep -q 'main-APAOREV10.js' index.html.new main-APAOREV11.js; then
  echo "o index ainda abre a grade antiga" >&2
  exit 1
fi
if grep -q '{rows:\[\]}' chunk-UWCMTE11B.js; then
  echo "o portal ainda apaga a faixa inteira" >&2
  exit 1
fi

for f in \
  chunk-CMTEFCF1.js \
  chunk-KDIGFCF1.js \
  chunk-C7RKFCF1.js \
  chunk-KLMVE6FCF.js \
  chunk-7EF52FCF.js \
  chunk-AO4OFCF1.js \
  chunk-DJNFFCF1.js \
  chunk-LJCMTE11A.js \
  chunk-UWCMTE11B.js \
  chunk-XOGQFCF1.js \
  chunk-YJY4FCF1.js \
  main-APAOREV11.js
do
  docker cp "$WORKDIR/$f" "$CID:/usr/share/nginx/html/$f"
done
docker cp "$WORKDIR/index.html.new" "$CID:/usr/share/nginx/html/index.html"

docker cp "$CID:/usr/share/nginx/html/index.html" index.served.html
docker cp "$CID:/usr/share/nginx/html/main-APAOREV11.js" main.served.js
docker cp "$CID:/usr/share/nginx/html/chunk-CMTEFCF1.js" mapper.served.js
grep -q 'main-APAOREV11.js' index.served.html
grep -q 'chunk-LJCMTE11A.js' main.served.js
grep -q 'chunk-UWCMTE11B.js' main.served.js
grep -q 'label:"CMTE / FCF"' mapper.served.js
grep -q 'id="schedule-expand-hot-style"' index.served.html
if grep -q 'main-APAOREV10.js' index.served.html; then
  echo "o nginx ainda serve a grade antiga" >&2
  exit 1
fi

echo "cmte-fcf ok: divisao CMTE / FCF"
