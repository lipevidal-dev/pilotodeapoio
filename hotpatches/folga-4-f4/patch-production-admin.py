#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/nginx/html")
VERSION = sys.argv[2] if len(sys.argv) > 2 else "1"

REPLACEMENTS = [
    (
        '{key:"FOLGA",label:"Folga"}',
        '{key:"FOLGA",label:"Folga"},{key:"F4",label:"Folga 4"}',
    ),
    (
        'r.includes("FOLGA")?{display:"F",kind:"folga",title:t}',
        'r==="F4"||r==="FOLGA 4"||r==="FOLGA4"?{display:"F4",kind:"folga",title:"Folga 4"}:r.includes("FOLGA")?{display:"F",kind:"folga",title:t}',
    ),
    (
        '{id:"folga",label:"Folga",cssClass:"cell-folga"}',
        '{id:"folga",label:"Folga",cssClass:"cell-folga"},{id:"f4",label:"F4",cssClass:"cell-folga"}',
    ),
    (
        'FOLGA:"Folga",FS:"Folga Social"',
        'FOLGA:"Folga",F4:"Folga 4",FS:"Folga Social"',
    ),
]

changed = []
for path in sorted(ROOT.glob("*.js")):
    text = path.read_text(encoding="utf-8", errors="ignore")
    orig = text
    for needle, repl in REPLACEMENTS:
        if needle in text and repl not in text:
            text = text.replace(needle, repl)
    if text != orig:
        path.write_text(text, encoding="utf-8")
        changed.append(path.name)

index = ROOT / "index.html"
if index.exists():
    html = index.read_text(encoding="utf-8")
    tag = f'<script src="folga-4.js?v={VERSION}"></script>'
    if "folga-4.js" in html:
        html = re.sub(r"folga-4\.js\?v=\d+", f"folga-4.js?v={VERSION}", html)
    elif "</body>" in html:
        html = html.replace("</body>", tag + "\n</body>", 1)
    if (ROOT / "voos-planejamento.js").exists() and "voos-planejamento.js" not in html and "</body>" in html:
        html = html.replace("</body>", '<script src="voos-planejamento.js?v=6"></script>\n</body>', 1)
    index.write_text(html, encoding="utf-8")
    changed.append("index.html")

print("admin patched:", ",".join(changed) if changed else "none")
