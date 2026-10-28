#!/usr/bin/env python3
"""Reinjeta o Excel/PDF Escala de Revezamento no frontend que voltou à imagem original."""
from __future__ import annotations

from pathlib import Path
import re
import shutil
import sys

SUFFIX = "XLSREV11"
GENERATOR = f"chunk-APAOREV11.js"

OLD_PDF = (
    'exportPdf(t,e){return ge(this,null,function*(){try{let{exportScheduleToPdfA4:o}='
    'yield import("./chunk-A65CVCXV.js"),i=e?.scope?we(e.scope):void 0;return yield o('
    '{year:t.year,month:t.month,rootId:e?.rootId??An,scopeLabel:i}),!0}catch{return!1}})}'
)
NEW_PDF = (
    'exportPdf(t,e){return ge(this,null,function*(){try{if(e?.scope==="apao"){'
    f'let{{downloadApaoRevezamentoPdf:r}}=yield import("./{GENERATOR}");'
    'return yield r(t.grid),!0}let{exportScheduleToPdfA4:o}=yield import("./chunk-A65CVCXV.js"),'
    'i=e?.scope?we(e.scope):void 0;return yield o({year:t.year,month:t.month,rootId:e?.rootId??An,'
    'scopeLabel:i}),!0}catch{return!1}})}'
)
OLD_XLS = (
    'exportExcel(t,e){return ge(this,null,function*(){try{let{downloadScheduleExcel:o}='
    'yield import("./chunk-KDIG6MPL.js"),s=`Escala ${String(t.month).padStart(2,"0")}/${t.year} '
    '\\u2014 ${we(e??"all")}`;return yield o(t.grid,s,t.generatedAt),!0}catch(o){'
    'return console.error("[ScheduleExportService] Falha ao gerar Excel.",o),!1}})}'
)
NEW_XLS = (
    'exportExcel(t,e){return ge(this,null,function*(){try{if(e==="apao"){'
    f'let{{downloadApaoRevezamentoExcel:r}}=yield import("./{GENERATOR}");'
    'return yield r(t.grid),!0}let{downloadScheduleExcel:o}=yield import("./chunk-KDIG6MPL.js"),'
    's=`Escala ${String(t.month).padStart(2,"0")}/${t.year} \\u2014 ${we(e??"all")}`;'
    'return yield o(t.grid,s,t.generatedAt),!0}catch(o){'
    'return console.error("[ScheduleExportService] Falha ao gerar Excel.",o),!1}})}'
)


def main() -> None:
    html = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    index_path = html / "index.html"
    if not index_path.exists():
        raise SystemExit("index.html ausente")

    generator_src = html / "chunk-APAOREV07.js"
    if not generator_src.exists():
        raise SystemExit("chunk-APAOREV07.js ausente no workdir")
    generator_dst = html / GENERATOR
    shutil.copyfile(generator_src, generator_dst)

    candidates: list[tuple[Path, str]] = []
    for path in sorted(html.glob("chunk-*.js")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "Falha ao gerar Excel" not in text or "downloadScheduleExcel" not in text:
            continue
        candidates.append((path, text))
    if not candidates:
        raise SystemExit("chunk do ScheduleExportService não encontrado")
    unpatched = [(path, text) for path, text in candidates if 'e==="apao"' not in text]
    if not unpatched:
        print(f"excel já apontava para APAO em {candidates[0][0].name}; nada a patchar")
        return
    export_chunk, export_text = unpatched[0]

    if OLD_XLS not in export_text or OLD_PDF not in export_text:
        i = export_text.find("exportExcel")
        print("exportExcel atual:", repr(export_text[i : i + 280] if i >= 0 else "ausente"))
        raise SystemExit(f"assinatura antiga não encontrada em {export_chunk.name}")

    patched_export = export_text.replace(OLD_PDF, NEW_PDF).replace(OLD_XLS, NEW_XLS)
    new_export_name = f"chunk-KLMVE6{SUFFIX}.js"
    (html / new_export_name).write_text(patched_export, encoding="utf-8")

    renamed = {export_chunk.name: new_export_name}
    for path in sorted(html.glob("chunk-*.js")):
        if path.name in {export_chunk.name, new_export_name, GENERATOR, "chunk-APAOREV07.js"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if export_chunk.name not in text:
            continue
        updated = text.replace(export_chunk.name, new_export_name)
        new_name = path.name.replace(".js", f"-{SUFFIX}.js")
        (html / new_name).write_text(updated, encoding="utf-8")
        renamed[path.name] = new_name

    index = index_path.read_text(encoding="utf-8")
    main_match = re.search(r"main-[A-Za-z0-9]+\.js", index)
    if not main_match:
        raise SystemExit("main-*.js não encontrado no index.html")
    main_name = main_match.group(0)
    main_path = html / main_name
    if not main_path.exists():
        raise SystemExit(f"{main_name} ausente no workdir")

    main_text = main_path.read_text(encoding="utf-8", errors="ignore")
    for old, new in renamed.items():
        main_text = main_text.replace(old, new)
    new_main = f"main-{SUFFIX}.js"
    (html / new_main).write_text(main_text, encoding="utf-8")
    index = index.replace(main_name, new_main)
    index_path.write_text(index, encoding="utf-8")

    if 'e==="apao"' not in patched_export or GENERATOR not in patched_export:
        raise SystemExit("patch do Excel não gravou o branch APAO")
    if new_main not in index_path.read_text(encoding="utf-8"):
        raise SystemExit("index.html não aponta para o main novo")

    print("excel restaurado:")
    print(" ", "generator", GENERATOR)
    print(" ", "export", new_export_name)
    for old, new in renamed.items():
        print(" ", old, "->", new)
    print(" ", "main", main_name, "->", new_main)


if __name__ == "__main__":
    main()
