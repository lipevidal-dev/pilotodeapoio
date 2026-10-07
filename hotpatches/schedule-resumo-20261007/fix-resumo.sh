#!/bin/sh
# Tira a regra que joga o resumo para fora da tela e coloca o resumo
# preso na direita da grade. Confere o arquivo que o nginx está servindo.
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
/* Resumo preso na direita. A grade rola por dentro, sem estourar a tela. */
body .admin-shell:has(.schedule-grid-wrap){
  max-width:100vw !important;
  overflow-x:hidden !important;
}
body .content:has(.schedule-grid-wrap),
body .content-inner:has(.schedule-grid-wrap){
  min-width:0 !important;
  max-width:100% !important;
  width:100% !important;
}
.schedule-grid-wrap,
.schedule-grid-wrap.has-summary,
.schedule-grid-wrap:not(.has-summary){
  max-width:100% !important;
  width:100% !important;
  min-width:0 !important;
  overflow-x:auto !important;
  --col-day-w: 1.85rem;
  --col-employee-w: 6.25rem;
}
.schedule-grid-wrap .schedule-grid-scroller,
.schedule-grid-wrap .schedule-grid,
.schedule-grid-wrap.has-summary .schedule-grid-scroller,
.schedule-grid-wrap.has-summary .schedule-grid{
  width:max-content !important;
  min-width:100% !important;
  max-width:none !important;
}
.schedule-grid-wrap.has-summary .col-day{
  width:1.85rem !important;
  min-width:1.85rem !important;
  max-width:1.85rem !important;
}
.schedule-grid-wrap .sticky-summary-block,
.schedule-grid-wrap.has-summary .sticky-summary-block{
  position:sticky !important;
  right:0 !important;
}
</style>
CSS

python3 - << 'PY'
from pathlib import Path
html = Path("index.html").read_text(encoding="utf-8")
start = html.find('<style id="schedule-expand-hot-style">')
if start < 0:
    raise SystemExit("bloco schedule-expand-hot-style nao encontrado")
end = html.find("</style>", start)
if end < 0:
    raise SystemExit("fim do bloco nao encontrado")
end += len("</style>")
new = Path("new-style.html").read_text(encoding="utf-8")
if not new.endswith("\n"):
    new += "\n"
out = html[:start] + new + html[end:]
if "position:static !important" in out:
    raise SystemExit("a regra position:static ainda ficou no html")
if "position:sticky !important" not in out:
    raise SystemExit("a regra do resumo preso nao entrou")
if 'id="lead-toggle-hot-style"' not in out:
    raise SystemExit("o script do botao do mes anterior sumiu")
Path("index.html.new").write_text(out, encoding="utf-8")
print("html reescrito", len(html), "->", len(out))
PY

docker cp "$WORKDIR/index.html.new" "$CID:/usr/share/nginx/html/index.html"
docker cp "$CID:/usr/share/nginx/html/index.html" index.served.html
grep -q 'position:sticky !important' index.served.html
if grep -q 'position:static !important' index.served.html; then
  echo "o container ainda esta com a regra antiga" >&2
  exit 1
fi
echo "resumo ok: arquivo do nginx atualizado, resumo preso na direita"
