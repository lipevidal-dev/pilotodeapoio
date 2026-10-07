#!/bin/sh
# O resumo operacional saía da tela: o CSS injetado em index.html
# tirava o sticky e deixava a grade com width:max-content.
# Este script devolve o scroll para dentro da grade e prende o resumo na direita.
set -eu
CID="${ADMIN_CONTAINER:-piloto_apoio_admin}"
WORKDIR=/tmp/fix-resumo-viewport
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

docker cp "$CID:/usr/share/nginx/html/index.html" index.html
grep -q 'id="schedule-expand-hot-style"' index.html

cat > new-style.html << 'CSS'
<style id="schedule-expand-hot-style">
/* Grade na largura ao lado do menu. O resumo fica preso na direita da grade. */
.content:has(.schedule-grid-wrap){
  min-width:0 !important;
  overflow-x:hidden !important;
}
.content-inner:has(.schedule-grid-wrap){
  max-width:none !important;
  width:100% !important;
  min-width:0 !important;
  margin:0 !important;
}
.schedule-grid-wrap{
  max-width:100% !important;
  width:100% !important;
  min-width:0 !important;
  overflow-x:auto !important;
}
.schedule-grid-wrap .schedule-grid-scroller,
.schedule-grid-wrap .schedule-grid{
  width:max-content !important;
  min-width:100% !important;
  max-width:none !important;
}
.schedule-grid-wrap .sticky-summary-block{
  position:sticky !important;
  right:0 !important;
}
</style>
CSS

awk '
  BEGIN { while ((getline line < "new-style.html") > 0) new = new line "\n" }
  /<style id="schedule-expand-hot-style">/ { skip=1; printf "%s", new; next }
  skip && /<\/style>/ { skip=0; next }
  !skip { print }
' index.html > index.html.new

grep -q 'position:sticky !important' index.html.new
grep -q 'id="lead-toggle-hot-style"' index.html.new
grep -q 'main-APAOREV10.js' index.html.new
if grep -q 'position:static !important' index.html.new; then
  echo "a regra que empurra o resumo para fora ainda está no html" >&2
  exit 1
fi

docker cp "$WORKDIR/index.html.new" "$CID:/usr/share/nginx/html/index.html"
echo "resumo ok: scroll na grade e resumo preso na direita"
