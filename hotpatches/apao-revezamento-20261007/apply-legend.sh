#!/bin/sh
# Publica a legenda e as cores no export de APAOs que já está no ar
# (main-APAOREV08.js). Troca os nomes dos chunks para furar o cache de 7 dias.
set -eu
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
WORKDIR=/tmp/apao-legend-09
BASE="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/apao-revezamento-legenda-e58d/hotpatches/apao-revezamento-20261007"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

curl -fsSL "$BASE/chunk-APAOREV09.js" -o chunk-APAOREV09.js
grep -q 'LEGENDA AEROVIÁRIO' chunk-APAOREV09.js
grep -q 'FOLGA REGULAMENTAR' chunk-APAOREV09.js

docker cp "$CID:/usr/share/nginx/html/index.html" index.html
docker cp "$CID:/usr/share/nginx/html/main-APAOREV08.js" main-APAOREV08.js
docker cp "$CID:/usr/share/nginx/html/chunk-LJCMTE08A.js" chunk-LJCMTE08A.js
docker cp "$CID:/usr/share/nginx/html/chunk-UWCMTE08B.js" chunk-UWCMTE08B.js
docker cp "$CID:/usr/share/nginx/html/chunk-KLMVE6REV.js" chunk-KLMVE6REV.js

grep -q 'main-APAOREV08.js' index.html
grep -q 'chunk-LJCMTE08A.js' main-APAOREV08.js
grep -q 'chunk-UWCMTE08B.js' main-APAOREV08.js
grep -q 'chunk-KLMVE6REV.js' chunk-LJCMTE08A.js
grep -q 'chunk-KLMVE6REV.js' chunk-UWCMTE08B.js
grep -q 'chunk-APAOREV08.js' chunk-KLMVE6REV.js

sed 's/chunk-APAOREV08\.js/chunk-APAOREV09.js/g' chunk-KLMVE6REV.js > chunk-KLMVE6LEG.js
sed 's/chunk-KLMVE6REV\.js/chunk-KLMVE6LEG.js/g' chunk-LJCMTE08A.js > chunk-LJCMTE09A.js
sed 's/chunk-KLMVE6REV\.js/chunk-KLMVE6LEG.js/g' chunk-UWCMTE08B.js > chunk-UWCMTE09B.js
sed \
  -e 's/chunk-LJCMTE08A\.js/chunk-LJCMTE09A.js/g' \
  -e 's/chunk-UWCMTE08B\.js/chunk-UWCMTE09B.js/g' \
  main-APAOREV08.js > main-APAOREV09.js
sed 's/main-APAOREV08\.js/main-APAOREV09.js/g' index.html > index.html.new

grep -q 'chunk-APAOREV09.js' chunk-KLMVE6LEG.js
grep -q 'chunk-KLMVE6LEG.js' chunk-LJCMTE09A.js
grep -q 'chunk-KLMVE6LEG.js' chunk-UWCMTE09B.js
grep -q 'chunk-LJCMTE09A.js' main-APAOREV09.js
grep -q 'main-APAOREV09.js' index.html.new

for f in chunk-APAOREV09.js chunk-KLMVE6LEG.js chunk-LJCMTE09A.js chunk-UWCMTE09B.js main-APAOREV09.js; do
  docker cp "$WORKDIR/$f" "$CID:/usr/share/nginx/html/$f"
done
docker cp "$WORKDIR/index.html.new" "$CID:/usr/share/nginx/html/index.html"

echo "legenda ok: index -> main-APAOREV09.js -> LEGENDA AEROVIÁRIO"
