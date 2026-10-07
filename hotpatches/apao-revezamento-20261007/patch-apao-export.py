#!/usr/bin/env python3
from pathlib import Path
import subprocess

OLD_PDF = (
    'exportPdf(t,e){return ge(this,null,function*(){try{let{exportScheduleToPdfA4:o}='
    'yield import("./chunk-A65CVCXV.js"),i=e?.scope?we(e.scope):void 0;return yield o('
    '{year:t.year,month:t.month,rootId:e?.rootId??An,scopeLabel:i}),!0}catch{return!1}})}'
)
NEW_PDF = (
    'exportPdf(t,e){return ge(this,null,function*(){try{if(e?.scope==="apao"){'
    'let{downloadApaoRevezamentoPdf:r}=yield import("./chunk-APAOREV07.js");'
    'return yield r(t.grid),!0}let{exportScheduleToPdfA4:o}=yield import("./chunk-A65CVCXV.js"),'
    'i=e?.scope?we(e.scope):void 0;return yield o({year:t.year,month:t.month,rootId:e?.rootId??An,'
    'scopeLabel:i}),!0}catch{return!1}})}'
)
# No arquivo minificado o "—" aparece como texto literal \u2014 (6 chars), não como glifo.
OLD_XLS = (
    'exportExcel(t,e){return ge(this,null,function*(){try{let{downloadScheduleExcel:o}='
    'yield import("./chunk-KDIG6MPL.js"),s=`Escala ${String(t.month).padStart(2,"0")}/${t.year} '
    '\\u2014 ${we(e??"all")}`;return yield o(t.grid,s,t.generatedAt),!0}catch(o){'
    'return console.error("[ScheduleExportService] Falha ao gerar Excel.",o),!1}})}'
)
NEW_XLS = (
    'exportExcel(t,e){return ge(this,null,function*(){try{if(e==="apao"){'
    'let{downloadApaoRevezamentoExcel:r}=yield import("./chunk-APAOREV07.js");'
    'return yield r(t.grid),!0}let{downloadScheduleExcel:o}=yield import("./chunk-KDIG6MPL.js"),'
    's=`Escala ${String(t.month).padStart(2,"0")}/${t.year} \\u2014 ${we(e??"all")}`;'
    'return yield o(t.grid,s,t.generatedAt),!0}catch(o){'
    'return console.error("[ScheduleExportService] Falha ao gerar Excel.",o),!1}})}'
)

html = Path("/tmp/admin-html-apao")
subprocess.check_call(["rm", "-rf", str(html)])
html.mkdir(parents=True)
subprocess.check_call(["docker", "cp", "piloto_apoio_admin:/usr/share/nginx/html/.", str(html)])

# ensure APAO chunk + logo present in temp tree and container
subprocess.check_call(["cp", "/tmp/chunk-APAOREV07.js", str(html / "chunk-APAOREV07.js")])
subprocess.check_call(
    ["docker", "cp", "/tmp/chunk-APAOREV07.js", "piloto_apoio_admin:/usr/share/nginx/html/chunk-APAOREV07.js"]
)
logo_src = Path("/tmp/logo-gol-export.png")
if logo_src.exists():
    brand = html / "assets" / "brand"
    brand.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(["cp", str(logo_src), str(brand / "logo-gol-export.png")])
    subprocess.check_call(
        [
            "docker",
            "cp",
            str(logo_src),
            "piloto_apoio_admin:/usr/share/nginx/html/assets/brand/logo-gol-export.png",
        ]
    )

patched = []
for f in sorted(html.glob("chunk-KLMVE6*.js")):
    t = f.read_text()
    if OLD_PDF not in t or OLD_XLS not in t:
        print("SKIP", f.name, "pdf", OLD_PDF in t, "xls", OLD_XLS in t)
        if "exportExcel" in t:
            i = t.find("exportExcel")
            print(repr(t[i : i + 240]))
        continue
    t = t.replace(OLD_PDF, NEW_PDF).replace(OLD_XLS, NEW_XLS)
    f.write_text(t)
    subprocess.check_call(["docker", "cp", str(f), f"piloto_apoio_admin:/usr/share/nginx/html/{f.name}"])
    patched.append(f.name)

print("PATCHED", patched)
ce = (html / "chunk-KLMVE6CE.js").read_text()
print("CE has APAOREV", "chunk-APAOREV07.js" in ce)
print("CE has apao excel branch", 'e==="apao"' in ce)
print("CE has apao pdf branch", 'e?.scope==="apao"' in ce)
