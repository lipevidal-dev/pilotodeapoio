#!/usr/bin/env python3
from pathlib import Path
import re
import sys

index_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/folga-feriado-patch/index.html")
version = sys.argv[2] if len(sys.argv) > 2 else "1"
text = index_path.read_text(encoding="utf-8")
tag = f'<script src="folga-feriado.js?v={version}"></script>'
if "folga-feriado.js" in text:
    text = re.sub(r"folga-feriado\.js\?v=\d+", f"folga-feriado.js?v={version}", text)
    index_path.write_text(text, encoding="utf-8")
    print(f"index.html cache-bust folga-feriado.js?v={version}")
    raise SystemExit(0)
if "</body>" not in text:
    raise SystemExit("index.html sem </body>")
text = text.replace("</body>", tag + "\n</body>", 1)
index_path.write_text(text, encoding="utf-8")
print("index.html patched with folga-feriado.js")
