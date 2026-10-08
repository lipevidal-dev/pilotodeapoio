#!/bin/sh
# Separa o checkbox de agrupamento do checkbox de espaçamento.
# Troca o chunk do Motor de Escala e o main para furar o cache de 7 dias.
# O index só troca o nome do main. O CSS do resumo permanece.
# No backend, o dist é corrigido no container e o processo reinicia.
set -eu

patch_dir() {
  python3 - "$1" << 'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])

def read(name: str) -> str:
    path = root / name
    if not path.is_file():
        raise SystemExit(f"arquivo ausente: {name}")
    return path.read_text(encoding="utf-8")

def write(name: str, text: str) -> None:
    (root / name).write_text(text, encoding="utf-8")

def once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: achei {count} ocorrencias, esperava 1")
    return text.replace(old, new, 1)

def once_re(text: str, pattern: re.Pattern[str], repl: str, label: str) -> str:
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"{label}: achei {len(matches)} ocorrencias, esperava 1")
    return pattern.sub(repl, text, count=1)

# --- admin: chunk do Motor de Escala ---
chunk = read("chunk-G56JYLIU.js")
if chunk.count("pao_agrupamento_turnos") != 0:
    raise SystemExit("o chunk ja tem pao_agrupamento_turnos")
chunk = once(
    chunk,
    'no=new Set(["pao_meta_turnos","pao_espacamento_turnos","pao_meta_dias_trabalhados","pao_10_folgas","pao_1_folga_social","t8_t8_nd"])',
    'no=new Set(["pao_meta_turnos","pao_agrupamento_turnos","pao_espacamento_turnos","pao_meta_dias_trabalhados","pao_10_folgas","pao_1_folga_social","t8_t8_nd"])',
    "set das regras da matriz",
)
chunk = once(
    chunk,
    '{id:"pao_meta_turnos",label:"Meta de turnos"},{id:"pao_espacamento_turnos",label:"Espa\\xE7amento entre turnos"}',
    '{id:"pao_meta_turnos",label:"Meta de turnos"},{id:"pao_agrupamento_turnos",label:"Agrupamento de turnos",shiftCodes:["T6","T7","T9"]},{id:"pao_espacamento_turnos",label:"Espa\\xE7amento entre turnos"}',
    "linha da matriz",
)
chunk = once(
    chunk,
    'agrupamento_turnos:{label:"Agrupamento de turnos",ruleId:"pao_espacamento_turnos",min:1,max:6}',
    'agrupamento_turnos:{label:"Agrupamento de turnos",ruleId:"pao_agrupamento_turnos",min:1,max:6}',
    "ruleId do campo agrupamento",
)
if chunk.count("pao_agrupamento_turnos") != 3:
    raise SystemExit(f"chunk: pao_agrupamento_turnos apareceu {chunk.count('pao_agrupamento_turnos')} vezes")
if 'espacamento:{label:"Espa\\xE7amento entre turnos",ruleId:"pao_espacamento_turnos"' not in chunk:
    raise SystemExit("o campo de espacamento perdeu a regra propria")
if "t.pao_espacamento_turnos" not in chunk:
    raise SystemExit("a projecao de espacamento sumiu")
write("chunk-G56AGRUP1.js", chunk)

main = once(read("main-APAOREV11.js"), "chunk-G56JYLIU.js", "chunk-G56AGRUP1.js", "import do main")
write("main-APAOREV12.js", main)

index = read("index.html")
if 'id="schedule-expand-hot-style"' not in index:
    raise SystemExit("index sem o css do resumo")
index = once(index, "main-APAOREV11.js", "main-APAOREV12.js", "index main")
if 'id="schedule-expand-hot-style"' not in index:
    raise SystemExit("o css do resumo saiu do index")
write("index.html", index)

# --- backend dist (saida do tsc, com ou sem quebra de linha) ---
catalog = read("next-motor-rules-catalog.js")
if "pao_agrupamento_turnos" in catalog:
    raise SystemExit("catalogo ja tem pao_agrupamento_turnos")
catalog_row = re.compile(
    r'^(?P<b>[ \t]*)\{\n(?P<p>[ \t]*)id: "pao_espacamento_turnos",\n(?P=p)label: "PAO — espaçamento entre turnos",',
    re.M,
)
match = catalog_row.search(catalog)
if not match:
    raise SystemExit("catalogo: bloco do espacamento nao encontrado")
brace, prop = match.group("b"), match.group("p")
inserted = (
    f'{brace}{{\n'
    f'{prop}id: "pao_agrupamento_turnos",\n'
    f'{prop}label: "PAO — agrupamento de turnos",\n'
    f'{prop}description: "Aloca o turno em sequência do tamanho configurado. T8 permanece no bloco T8/T8/ND.",\n'
    f'{prop}category: "pao",\n'
    f'{prop}defaultEnabled: true,\n'
    f'{prop}locked: false,\n'
    f"{brace}}},\n"
)
catalog = catalog[: match.start()] + inserted + catalog[match.start() :]
inherit_anchor = re.compile(
    r'if \(id\.startsWith\("pao_shift_rule__"\) && typeof enabled === "boolean"\) \{\n'
    r'(?P<i>[ \t]*)merged\[id\] = enabled;\n'
    r'(?P<b>[ \t]*)\}\n'
    r'(?P<c>[ \t]*)\}\n'
    r'(?P<r>[ \t]*)return merged;\n'
    r'\}\n'
    r'export function sanitizeNextMotorPatch'
)
anchor = inherit_anchor.search(catalog)
if not anchor:
    raise SystemExit("catalogo: fim de mergeNextMotorEnabled nao encontrado")
ret = anchor.group("r")
inherit = (
    f'{ret}if (typeof stored.pao_agrupamento_turnos !== "boolean" && typeof stored.pao_espacamento_turnos === "boolean") {{\n'
    f"{ret}    merged.pao_agrupamento_turnos = stored.pao_espacamento_turnos;\n"
    f"{ret}}}\n"
    f'{ret}const spacingPrefix = "pao_shift_rule__pao_espacamento_turnos__";\n'
    f'{ret}const agrupPrefix = "pao_shift_rule__pao_agrupamento_turnos__";\n'
    f"{ret}for (const [id, enabled] of Object.entries(stored)) {{\n"
    f'{ret}    if (!id.startsWith(spacingPrefix) || typeof enabled !== "boolean")\n'
    f"{ret}        continue;\n"
    f"{ret}    const shiftCode = id.slice(spacingPrefix.length);\n"
    f"{ret}    const agrupId = agrupPrefix + shiftCode;\n"
    f'{ret}    if (typeof stored[agrupId] !== "boolean")\n'
    f"{ret}        merged[agrupId] = enabled;\n"
    f"{ret}}}\n"
)
catalog = catalog[: anchor.start("r")] + inherit + catalog[anchor.start("r") :]
if catalog.count('id: "pao_agrupamento_turnos"') != 1:
    raise SystemExit("catalogo: regra nova nao ficou unica")
if "spacingPrefix" not in catalog:
    raise SystemExit("catalogo: heranca do espacamento nao entrou")
write("next-motor-rules-catalog.js", catalog)

params = read("next-motor-shift-params.js")
params = once_re(
    params,
    re.compile(
        r'(label: "Agrupamento de turnos",[\s\S]*?ruleId: )"pao_espacamento_turnos"'
    ),
    r'\1"pao_agrupamento_turnos"',
    "ruleId do agrupamento",
)
params = once_re(
    params,
    re.compile(r'("pao_meta_turnos",\n)([ \t]*)"pao_espacamento_turnos",'),
    r'\1\2"pao_agrupamento_turnos",\n\2"pao_espacamento_turnos",',
    "PAO_SHIFT_RULE_IDS",
)
if params.count("pao_agrupamento_turnos") != 2:
    raise SystemExit(f"shift-params: pao_agrupamento_turnos apareceu {params.count('pao_agrupamento_turnos')} vezes")
if 'legacyGlobalId: "pao_espacamento_turnos"' not in params:
    raise SystemExit("o legado do espacamento sumiu")
write("next-motor-shift-params.js", params)

prefs = read("clean-preferences.js")
prefs = once_re(
    prefs,
    re.compile(
        r'(export function getTurnAgrupamentoDays\(ws, shiftCode\) \{\n'
        r'[ \t]*if \(!motorShiftRuleEnabled\(ws\.options, )"pao_espacamento_turnos"'
    ),
    r'\1"pao_agrupamento_turnos"',
    "getTurnAgrupamentoDays",
)
if prefs.count('getTurnSpacingDays') < 1 or 'return 0' not in prefs:
    raise SystemExit("getTurnSpacingDays foi alterado")
spacing_gate = 'motorShiftRuleEnabled(ws.options, "pao_espacamento_turnos", shiftCode)'
if prefs.count(spacing_gate) < 1:
    raise SystemExit("o espacamento deixou de consultar a regra propria")
write("clean-preferences.js", prefs)

engine = read("clean-engine.js")
engine = once_re(
    engine,
    re.compile(
        r'(ruleEnabled\(options, "pao_meta_turnos"\) \|\|)(\s*)(ruleEnabled\(options, "pao_espacamento_turnos"\))'
    ),
    r'\1\2ruleEnabled(options, "pao_agrupamento_turnos") ||\2\3',
    "ramo legado do motor",
)
write("clean-engine.js", engine)
print("patch ok")
PY
}

if [ "${1:-}" = "--patch-dir" ]; then
  patch_dir "$2"
  exit 0
fi

ADMIN="${ADMIN_CONTAINER:-piloto_apoio_admin}"
BACKEND="${BACKEND_CONTAINER:-piloto_apoio_backend}"
WORKDIR=/tmp/motor-agrup-12
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

docker cp "$ADMIN:/usr/share/nginx/html/index.html" index.html
docker cp "$ADMIN:/usr/share/nginx/html/main-APAOREV11.js" main-APAOREV11.js
docker cp "$ADMIN:/usr/share/nginx/html/chunk-G56JYLIU.js" chunk-G56JYLIU.js
docker cp "$BACKEND:/app/dist/domain/schedule/next-motor/next-motor-rules-catalog.js" next-motor-rules-catalog.js
docker cp "$BACKEND:/app/dist/domain/schedule/next-motor/next-motor-shift-params.js" next-motor-shift-params.js
docker cp "$BACKEND:/app/dist/domain/schedule/clean-engine/clean-preferences.js" clean-preferences.js
docker cp "$BACKEND:/app/dist/domain/schedule/clean-engine/clean-engine.js" clean-engine.js

patch_dir "$WORKDIR"

docker cp chunk-G56AGRUP1.js "$BACKEND:/tmp/chunk-G56AGRUP1.js"
docker cp next-motor-rules-catalog.js "$BACKEND:/tmp/next-motor-rules-catalog.js"
docker cp next-motor-shift-params.js "$BACKEND:/tmp/next-motor-shift-params.js"
docker cp clean-preferences.js "$BACKEND:/tmp/clean-preferences.js"
docker cp clean-engine.js "$BACKEND:/tmp/clean-engine.js"
docker exec "$BACKEND" node --check /tmp/chunk-G56AGRUP1.js
docker exec "$BACKEND" node --check /tmp/next-motor-rules-catalog.js
docker exec "$BACKEND" node --check /tmp/next-motor-shift-params.js
docker exec "$BACKEND" node --check /tmp/clean-preferences.js
docker exec "$BACKEND" node --check /tmp/clean-engine.js

docker cp chunk-G56AGRUP1.js "$ADMIN:/usr/share/nginx/html/chunk-G56AGRUP1.js"
docker cp main-APAOREV12.js "$ADMIN:/usr/share/nginx/html/main-APAOREV12.js"
docker cp index.html "$ADMIN:/usr/share/nginx/html/index.html"
docker cp next-motor-rules-catalog.js "$BACKEND:/app/dist/domain/schedule/next-motor/next-motor-rules-catalog.js"
docker cp next-motor-shift-params.js "$BACKEND:/app/dist/domain/schedule/next-motor/next-motor-shift-params.js"
docker cp clean-preferences.js "$BACKEND:/app/dist/domain/schedule/clean-engine/clean-preferences.js"
docker cp clean-engine.js "$BACKEND:/app/dist/domain/schedule/clean-engine/clean-engine.js"

echo "reiniciando piloto_apoio_backend"
docker restart "$BACKEND" >/dev/null

ok=0
i=0
while [ "$i" -lt 40 ]; do
  i=$((i + 1))
  sleep 3
  if curl -fsS "http://127.0.0.1:3333/config/next-motor" -o /tmp/motor-agrup-config.json 2>/dev/null; then
    if python3 - /tmp/motor-agrup-config.json << 'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
ids = [rule.get("id") for rule in data.get("rules", [])]
if "pao_agrupamento_turnos" not in ids:
    raise SystemExit(1)
field_ok = False
rule_ok = False
for group in data.get("paoShiftParams", []):
    for field in group.get("fields", []):
        if field.get("kind") == "agrupamento_turnos" and field.get("ruleId") == "pao_agrupamento_turnos":
            field_ok = True
        if field.get("kind") == "espacamento" and field.get("ruleId") != "pao_espacamento_turnos":
            raise SystemExit(1)
    for rule in group.get("rules", []):
        if rule.get("globalRuleId") == "pao_agrupamento_turnos":
            rule_ok = True
if not field_ok or not rule_ok:
    raise SystemExit(1)
PY
    then
      ok=1
      break
    fi
  fi
done
rm -f /tmp/motor-agrup-config.json

if [ "$ok" -ne 1 ]; then
  echo "a API nao voltou com o checkbox de agrupamento" >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:8080/index.html" | grep -q "main-APAOREV12.js"
curl -fsS "http://127.0.0.1:8080/main-APAOREV12.js" | grep -q "chunk-G56AGRUP1.js"
curl -fsS "http://127.0.0.1:8080/chunk-G56AGRUP1.js" | grep -q "pao_agrupamento_turnos"

echo "agrupamento ok: checkbox separado do espacamento"
