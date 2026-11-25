#!/usr/bin/env python3
"""Injeta Folga Feriado (FF) no popup compilado e no mapper da grade, sem rebuild do admin."""
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/nginx/html")

REPLACEMENTS = [
    (
        'n==="F4"||n==="FOLGA 4"||n==="FOLGA4"?{display:"F4",kind:"folga",title:"Folga 4"}:n.includes("FOLGA")?{display:"F"',
        'n==="F4"||n==="FOLGA 4"||n==="FOLGA4"?{display:"F4",kind:"folga",title:"Folga 4"}:n==="FF"||n==="FOLGA FERIADO"||n==="FOLGAFERIADO"?{display:"FF",kind:"folga",title:"Folga Feriado"}:n.includes("FOLGA")?{display:"F"',
    ),
    (
        'n==="F4"||n==="FOLGA 4"||n==="FOLGA4")return{display:"F4",kind:"folga",title:"Folga 4"};if(n.includes("FOLGA"))return{display:"F"',
        'n==="F4"||n==="FOLGA 4"||n==="FOLGA4")return{display:"F4",kind:"folga",title:"Folga 4"};if(n==="FF"||n==="FOLGA FERIADO"||n==="FOLGAFERIADO")return{display:"FF",kind:"folga",title:"Folga Feriado"};if(n.includes("FOLGA"))return{display:"F"',
    ),
    (
        'n.includes("FOLGA")?{display:"F"',
        'n==="FF"||n==="FOLGA FERIADO"||n==="FOLGAFERIADO"?{display:"FF",kind:"folga",title:"Folga Feriado"}:n.includes("FOLGA")?{display:"F"',
    ),
    (
        'n.includes("FOLGA"))return{display:"F"',
        'n==="FF"||n==="FOLGA FERIADO"||n==="FOLGAFERIADO")return{display:"FF",kind:"folga",title:"Folga Feriado"};if(n.includes("FOLGA"))return{display:"F"',
    ),
    (
        '{key:"FOLGA",label:"Folga"},{key:"F4",label:"Folga 4"}',
        '{key:"FOLGA",label:"Folga"},{key:"F4",label:"Folga 4"},{key:"FF",label:"Folga Feriado"}',
    ),
    (
        "{key:'FOLGA',label:'Folga'},{key:'F4',label:'Folga 4'}",
        "{key:'FOLGA',label:'Folga'},{key:'F4',label:'Folga 4'},{key:'FF',label:'Folga Feriado'}",
    ),
    (
        '{key:"FOLGA",label:"Folga"}',
        '{key:"FOLGA",label:"Folga"},{key:"FF",label:"Folga Feriado"}',
    ),
    (
        "{key:'FOLGA',label:'Folga'}",
        "{key:'FOLGA',label:'Folga'},{key:'FF',label:'Folga Feriado'}",
    ),
    (
        '{id:"f4",label:"F4",cssClass:"cell-folga"}',
        '{id:"f4",label:"F4",cssClass:"cell-folga"},{id:"ff",label:"FF",cssClass:"cell-folga"}',
    ),
    (
        '{id:"folga",label:"F",cssClass:"cell-folga"}',
        '{id:"folga",label:"F",cssClass:"cell-folga"},{id:"ff",label:"FF",cssClass:"cell-folga"}',
    ),
    (
        'FOLGA:"Folga",F4:"Folga 4",FS:"Folga Social"',
        'FOLGA:"Folga",F4:"Folga 4",FF:"Folga Feriado",FS:"Folga Social"',
    ),
    (
        'FOLGA:"Folga",FS:"Folga Social"',
        'FOLGA:"Folga",FF:"Folga Feriado",FS:"Folga Social"',
    ),
]

changed = []
for path in sorted(list(ROOT.glob("*.js")) + list(ROOT.glob("chunk-*.js"))):
    text = path.read_text(encoding="utf-8", errors="ignore")
    orig = text
    has_ff_option = '{key:"FF",label:"Folga Feriado"}' in text or "{key:'FF',label:'Folga Feriado'}" in text
    has_ff_map = 'title:"Folga Feriado"' in text
    for needle, repl in REPLACEMENTS:
        if needle in ('{key:"FOLGA",label:"Folga"}', "{key:'FOLGA',label:'Folga'}") and has_ff_option:
            continue
        if needle in ('n.includes("FOLGA")?{display:"F"', 'n.includes("FOLGA"))return{display:"F"') and has_ff_map:
            continue
        if needle in text and repl not in text:
            text = text.replace(needle, repl)
            has_ff_option = '{key:"FF",label:"Folga Feriado"}' in text or "{key:'FF',label:'Folga Feriado'}" in text
            has_ff_map = 'title:"Folga Feriado"' in text
    if text != orig:
        path.write_text(text, encoding="utf-8")
        changed.append(path.name)

print("chunks patched:" + (",".join(changed) if changed else " none"))
