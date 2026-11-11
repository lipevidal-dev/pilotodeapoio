#!/usr/bin/env python3
from pathlib import Path
import re
import sys

index_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/folga-4-patch/index.html")
version = sys.argv[2] if len(sys.argv) > 2 else "1"
text = index_path.read_text(encoding="utf-8")
tag = f'<script src="folga-4.js?v={version}"></script>'
if "folga-4.js" in text:
    text = re.sub(r"folga-4\.js\?v=\d+", f"folga-4.js?v={version}", text)
    index_path.write_text(text, encoding="utf-8")
    print(f"index.html cache-bust folga-4.js?v={version}")
    raise SystemExit(0)
if "</body>" not in text:
    raise SystemExit("index.html sem </body>")
text = text.replace("</body>", tag + "\n</body>", 1)
index_path.write_text(text, encoding="utf-8")
print("index.html patched with folga-4.js")
