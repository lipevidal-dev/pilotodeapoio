#!/usr/bin/env python3
"""Injeta rotas de observação no server.js compilado, sem rebuild."""
from __future__ import annotations

from pathlib import Path
import sys

IMPORT_LINE = 'import { registerEmployeeObservationRoutes } from "./employee-observation-routes.js";'
CALL_LINE = "await registerEmployeeObservationRoutes(app);"


def patch_text(text: str) -> str:
    if "registerEmployeeObservationRoutes" in text:
        return text
    if 'from "./routes/index.js"' in text and IMPORT_LINE not in text:
        text = text.replace(
            'from "./routes/index.js";',
            'from "./routes/index.js";\n' + IMPORT_LINE,
            1,
        )
    elif 'from "./routes/index.js"' not in text:
        raise SystemExit("import de registerRoutes não encontrado")
    if "await registerRoutes(app);" in text:
        text = text.replace(
            "await registerRoutes(app);",
            "await registerRoutes(app);\n  " + CALL_LINE,
            1,
        )
    elif "registerRoutes(app)" in text:
        text = text.replace(
            "registerRoutes(app)",
            "registerRoutes(app);\n  " + CALL_LINE.replace("await ", ""),
            1,
        )
    else:
        raise SystemExit("chamada registerRoutes(app) não encontrada")
    if "registerEmployeeObservationRoutes" not in text:
        raise SystemExit("falha ao injetar rotas de observação")
    return text


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "/app/dist/interfaces/http/server.js")
    if not path.exists():
        raise SystemExit(f"{path} ausente")
    original = path.read_text(encoding="utf-8")
    updated = patch_text(original)
    if updated == original:
        print("backend já tinha rotas de observação")
        return
    path.write_text(updated, encoding="utf-8")
    print("backend patched:", path)


if __name__ == "__main__":
    main()
