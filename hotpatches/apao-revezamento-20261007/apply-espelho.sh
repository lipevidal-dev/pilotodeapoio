#!/bin/sh
# Publica o espelho da planilha APAO (logo GOL, colunas e legenda)
# em cima do que já está no ar (main-APAOREV09.js).
# Troca os nomes dos chunks para furar o cache de 7 dias.
set -eu
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
WORKDIR=/tmp/apao-espelho-10
BASE="https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/apao-revezamento-espelho-e58d/hotpatches/apao-revezamento-20261007"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

curl -fsSL "$BASE/chunk-APAOREV07.js" -o chunk-APAOREV10.js
curl -fsSL "$BASE/logo-gol-wordmark.png" -o logo-gol-wordmark.png
grep -q 'logo-gol-wordmark.png' chunk-APAOREV10.js
grep -q 'LEGENDA AEROVIÁRIO' chunk-APAOREV10.js
grep -q '35.14' chunk-APAOREV10.js

docker cp "$CID:/usr/share/nginx/html/index.html" index.html
docker cp "$CID:/usr/share/nginx/html/main-APAOREV09.js" main-APAOREV09.js
docker cp "$CID:/usr/share/nginx/html/chunk-LJCMTE09A.js" chunk-LJCMTE09A.js
docker cp "$CID:/usr/share/nginx/html/chunk-UWCMTE09B.js" chunk-UWCMTE09B.js
docker cp "$CID:/usr/share/nginx/html/chunk-KLMVE6LEG.js" chunk-KLMVE6LEG.js

grep -q 'main-APAOREV09.js' index.html
grep -q 'chunk-LJCMTE09A.js' main-APAOREV09.js
grep -q 'chunk-UWCMTE09B.js' main-APAOREV09.js
grep -q 'chunk-KLMVE6LEG.js' chunk-LJCMTE09A.js
grep -q 'chunk-KLMVE6LEG.js' chunk-UWCMTE09B.js
grep -q 'chunk-APAOREV09.js' chunk-KLMVE6LEG.js

sed 's/chunk-APAOREV09\.js/chunk-APAOREV10.js/g' chunk-KLMVE6LEG.js > chunk-KLMVE6ESP.js
sed 's/chunk-KLMVE6LEG\.js/chunk-KLMVE6ESP.js/g' chunk-LJCMTE09A.js > chunk-LJCMTE10A.js
sed 's/chunk-KLMVE6LEG\.js/chunk-KLMVE6ESP.js/g' chunk-UWCMTE09B.js > chunk-UWCMTE10B.js
sed \
  -e 's/chunk-LJCMTE09A\.js/chunk-LJCMTE10A.js/g' \
  -e 's/chunk-UWCMTE09B\.js/chunk-UWCMTE10B.js/g' \
  main-APAOREV09.js > main-APAOREV10.js
sed 's/main-APAOREV09\.js/main-APAOREV10.js/g' index.html > index.html.new

grep -q 'chunk-APAOREV10.js' chunk-KLMVE6ESP.js
grep -q 'chunk-KLMVE6ESP.js' chunk-LJCMTE10A.js
grep -q 'chunk-KLMVE6ESP.js' chunk-UWCMTE10B.js
grep -q 'chunk-LJCMTE10A.js' main-APAOREV10.js
grep -q 'main-APAOREV10.js' index.html.new

docker exec "$CID" mkdir -p /usr/share/nginx/html/assets/brand
docker cp "$WORKDIR/logo-gol-wordmark.png" "$CID:/usr/share/nginx/html/assets/brand/logo-gol-wordmark.png"
for f in chunk-APAOREV10.js chunk-KLMVE6ESP.js chunk-LJCMTE10A.js chunk-UWCMTE10B.js main-APAOREV10.js; do
  docker cp "$WORKDIR/$f" "$CID:/usr/share/nginx/html/$f"
done
docker cp "$WORKDIR/index.html.new" "$CID:/usr/share/nginx/html/index.html"

echo "espelho ok: index -> main-APAOREV10.js -> logo GOL + colunas da planilha"
