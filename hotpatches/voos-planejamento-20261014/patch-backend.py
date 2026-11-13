#!/usr/bin/env python3
from pathlib import Path
import sys

routes_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/app/dist/interfaces/http/routes/index.js")
text = routes_path.read_text(encoding="utf-8")

IMPORT_LINE = (
    'import { getAdminFlightPlanningController, getPortalFlightPlanningStatusController, '
    'submitPortalFlightPlanningController, updateAdminFlightPlanningSettingsController } '
    'from "../controllers/flight-planning.controller.js";\n'
)

ROUTES_BLOCK = (
    '    app.get("/portal/flight-planning", getPortalFlightPlanningStatusController);\n'
    '    app.post("/portal/flight-planning/requests", submitPortalFlightPlanningController);\n'
    '    app.get("/flight-planning", getAdminFlightPlanningController);\n'
    '    app.put("/flight-planning/settings", updateAdminFlightPlanningSettingsController);\n'
)

orig = text
if "flight-planning.controller.js" not in text:
    anchor = 'from "../controllers/next-motor-config.controller.js";\n'
    if anchor in text:
        text = text.replace(anchor, anchor + IMPORT_LINE, 1)
    else:
        text = IMPORT_LINE + text

if 'app.get("/flight-planning"' not in text:
    anchor = '    app.put("/config/next-motor", updateNextMotorConfigController);\n'
    if anchor not in text:
        raise SystemExit("routes/index.js: ponto de inserção não encontrado")
    text = text.replace(anchor, anchor + ROUTES_BLOCK, 1)

if text != orig:
    routes_path.write_text(text, encoding="utf-8")
    print("routes/index.js patched with flight-planning routes")
else:
    print("routes/index.js already had flight-planning routes")
