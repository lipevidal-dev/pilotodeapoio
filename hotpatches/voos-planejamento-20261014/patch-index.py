#!/usr/bin/env python3
from pathlib import Path
import re
import sys

index = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/nginx/html/index.html")
version = sys.argv[2] if len(sys.argv) > 2 else "5"

text = index.read_text(encoding="utf-8")
tag = f'<script src="voos-planejamento.js?v={version}"></script>'

if "voos-planejamento.js" in text:
    text = re.sub(
        r'<script[^>]*src="/?voos-planejamento\.js(?:\?v=\d+)?"[^>]*></script>',
        tag,
        text,
    )
elif "</body>" in text:
    text = text.replace("</body>", tag + "\n</body>", 1)
else:
    raise SystemExit("index.html sem </body>")

index.write_text(text, encoding="utf-8")
print(f"index.html patched with voos-planejamento.js?v={version}")
