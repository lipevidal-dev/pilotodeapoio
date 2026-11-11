#!/usr/bin/env python3
"""Injeta Folga 4 no popup compilado e no mapper da grade, sem rebuild do admin."""
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/nginx/html")

REPLACEMENTS = [
    (
        'n.includes("FOLGA")?{display:"F"',
        'n==="F4"||n==="FOLGA 4"||n==="FOLGA4"?{display:"F4",kind:"folga",title:"Folga 4"}:n.includes("FOLGA")?{display:"F"',
    ),
    (
        'n.includes("FOLGA"))return{display:"F"',
        'n==="F4"||n==="FOLGA 4"||n==="FOLGA4")return{display:"F4",kind:"folga",title:"Folga 4"};if(n.includes("FOLGA"))return{display:"F"',
    ),
    (
        '{key:"FOLGA",label:"Folga"}',
        '{key:"FOLGA",label:"Folga"},{key:"F4",label:"Folga 4"}',
    ),
    (
        "{key:'FOLGA',label:'Folga'}",
        "{key:'FOLGA',label:'Folga'},{key:'F4',label:'Folga 4'}",
    ),
    (
        '{id:"folga",label:"F",cssClass:"cell-folga"}',
        '{id:"folga",label:"F",cssClass:"cell-folga"},{id:"f4",label:"F4",cssClass:"cell-folga"}',
    ),
]

changed = []
for path in sorted(list(ROOT.glob("*.js")) + list(ROOT.glob("chunk-*.js"))):
    text = path.read_text(encoding="utf-8", errors="ignore")
    orig = text
    for needle, repl in REPLACEMENTS:
        if needle in text and repl not in text:
            text = text.replace(needle, repl)
    if text != orig:
        path.write_text(text, encoding="utf-8")
        changed.append(path.name)

print("chunks patched:" + (",".join(changed) if changed else " none"))
