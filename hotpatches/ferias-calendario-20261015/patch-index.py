#!/usr/bin/env python3
from pathlib import Path
import sys

index_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ferias-cal-patch/index.html")
text = index_path.read_text(encoding="utf-8")
tag = '<script src="ferias-calendario.js?v=1"></script>'
if "ferias-calendario.js" in text:
    print("index.html already has ferias-calendario.js")
    raise SystemExit(0)
if "</body>" not in text:
    raise SystemExit("index.html sem </body>")
text = text.replace("</body>", tag + "\n</body>", 1)
index_path.write_text(text, encoding="utf-8")
print("index.html patched")
