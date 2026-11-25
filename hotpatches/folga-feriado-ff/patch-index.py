#!/usr/bin/env python3
from pathlib import Path
import re
import sys

index_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/folga-feriado-patch/index.html")
version = sys.argv[2] if len(sys.argv) > 2 else "1"
src = f"ff-display-v{version}.js"
text = index_path.read_text(encoding="utf-8")
tag = f'<script src="{src}"></script>'
text = re.sub(r'<script src="folga-feriado\.js[^"]*"></script>\n?', "", text)
text = re.sub(r'<script src="ff-display-v\d+\.js"></script>\n?', "", text)
if "</body>" not in text:
    raise SystemExit("index.html sem </body>")
text = text.replace("</body>", tag + "\n</body>", 1)
index_path.write_text(text, encoding="utf-8")
print(f"index.html patched with {src}")
