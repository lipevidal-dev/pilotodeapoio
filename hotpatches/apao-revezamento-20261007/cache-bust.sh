#!/bin/sh
# O patch de 07/10 gravou o layout novo em cima de chunk-KLMVE6CF.js.
# Esse arquivo tem Cache-Control de 7 dias, então o navegador continuou
# gerando a grade antiga. Este script publica nomes novos e aponta o
# index (no-cache) para eles.
set -eu
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
WORKDIR=/tmp/apao-cachebust-08
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

for f in index.html main-CMTERIGHT07.js chunk-LJCMTE07A.js chunk-UWCMTE07B.js chunk-KLMVE6CF.js chunk-APAOREV07.js; do
  docker cp "$CID:/usr/share/nginx/html/$f" "$WORKDIR/$f"
done

grep -q 'e==="apao"' chunk-KLMVE6CF.js
grep -q 'chunk-APAOREV07.js' chunk-KLMVE6CF.js
grep -q 'Escala de Revezamento' chunk-APAOREV07.js
grep -q 'chunk-KLMVE6CF.js' chunk-LJCMTE07A.js
grep -q 'chunk-KLMVE6CF.js' chunk-UWCMTE07B.js
grep -q 'chunk-LJCMTE07A.js' main-CMTERIGHT07.js
grep -q 'chunk-UWCMTE07B.js' main-CMTERIGHT07.js
grep -q 'main-CMTERIGHT07.js' index.html

cp chunk-APAOREV07.js chunk-APAOREV08.js
sed 's/chunk-APAOREV07\.js/chunk-APAOREV08.js/g' chunk-KLMVE6CF.js > chunk-KLMVE6REV.js
sed 's/chunk-KLMVE6CF\.js/chunk-KLMVE6REV.js/g' chunk-LJCMTE07A.js > chunk-LJCMTE08A.js
sed 's/chunk-KLMVE6CF\.js/chunk-KLMVE6REV.js/g' chunk-UWCMTE07B.js > chunk-UWCMTE08B.js
sed \
  -e 's/chunk-LJCMTE07A\.js/chunk-LJCMTE08A.js/g' \
  -e 's/chunk-UWCMTE07B\.js/chunk-UWCMTE08B.js/g' \
  main-CMTERIGHT07.js > main-APAOREV08.js
sed 's/main-CMTERIGHT07\.js/main-APAOREV08.js/g' index.html > index.html.new

grep -q 'chunk-APAOREV08.js' chunk-KLMVE6REV.js
grep -q 'e==="apao"' chunk-KLMVE6REV.js
grep -q 'chunk-KLMVE6REV.js' chunk-LJCMTE08A.js
grep -q 'chunk-KLMVE6REV.js' chunk-UWCMTE08B.js
grep -q 'chunk-LJCMTE08A.js' main-APAOREV08.js
grep -q 'chunk-UWCMTE08B.js' main-APAOREV08.js
grep -q 'main-APAOREV08.js' index.html.new
grep -q 'Escala de Revezamento' chunk-APAOREV08.js

for f in chunk-APAOREV08.js chunk-KLMVE6REV.js chunk-LJCMTE08A.js chunk-UWCMTE08B.js main-APAOREV08.js; do
  docker cp "$WORKDIR/$f" "$CID:/usr/share/nginx/html/$f"
done
docker cp "$WORKDIR/index.html.new" "$CID:/usr/share/nginx/html/index.html"

echo "cache-bust ok: index -> main-APAOREV08.js -> Escala de Revezamento"
