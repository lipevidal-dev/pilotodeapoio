#!/usr/bin/env python3
"""Aceita type F4 no backend já compilado, sem rebuild da imagem."""
from pathlib import Path
import sys

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/app/dist")

patches = [
    (
        "\"FOLGA\",\"FS\",\"FP\"",
        "\"FOLGA\",\"F4\",\"FS\",\"FP\"",
    ),
    (
        '"FOLGA",\n  "FS",\n  "FP"',
        '"FOLGA",\n  "F4",\n  "FS",\n  "FP"',
    ),
    (
        'case "FOLGA":\n            return "FOLGA";\n        case "FS":',
        'case "FOLGA":\n            return "FOLGA";\n        case "F4":\n            return "FOLGA 4";\n        case "FS":',
    ),
    (
        'case "FOLGA": return "FOLGA";\n        case "FS":',
        'case "FOLGA": return "FOLGA";\n        case "F4": return "FOLGA 4";\n        case "FS":',
    ),
    (
        'case "FOLGA":\n        return "F";\n    case "FS":',
        'case "FOLGA":\n        return "F";\n    case "F4":\n        return "F4";\n    case "FS":',
    ),
]

changed = []
for path in ROOT.rglob("*.js"):
    text = path.read_text(encoding="utf-8", errors="ignore")
    orig = text
    for needle, repl in patches:
        if needle in text and repl not in text:
            text = text.replace(needle, repl)
    if '"F4"' not in text and "manualAllocationTypeSchema" in text and '"FOLGA"' in text:
        text = text.replace('"FOLGA",', '"FOLGA","F4",', 1)
    if text != orig:
        path.write_text(text, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))

print("backend dist patched:" + (",".join(changed) if changed else " none"))
