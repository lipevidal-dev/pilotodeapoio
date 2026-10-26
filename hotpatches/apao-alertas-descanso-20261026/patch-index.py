#!/usr/bin/env python3
from pathlib import Path
import re
import sys

index_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/apao-alertas-patch/index.html")
version = sys.argv[2] if len(sys.argv) > 2 else "1"
text = index_path.read_text(encoding="utf-8")
tag = f'<script src="apao-alertas.js?v={version}"></script>'
if "apao-alertas.js" in text:
    text = re.sub(r"apao-alertas\.js\?v=\d+", f"apao-alertas.js?v={version}", text)
    if tag not in text and "apao-alertas.js" not in text:
        raise SystemExit("falha ao atualizar o cache-bust de apao-alertas.js")
    index_path.write_text(text, encoding="utf-8")
    print(f"index.html cache-bust apao-alertas.js?v={version}")
    raise SystemExit(0)
if "</body>" not in text:
    raise SystemExit("index.html sem </body>")
text = text.replace("</body>", tag + "\n</body>", 1)
index_path.write_text(text, encoding="utf-8")
print("index.html patched")
