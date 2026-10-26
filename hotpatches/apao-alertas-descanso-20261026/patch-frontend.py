#!/usr/bin/env python3
"""Hotpatch antigo. NÃO reconstrói o admin — o ng build do VPS quebra."""
import sys

print(
    "Não use patch-frontend.py. Ele tentava reconstruir o frontend e quebra o build.\n"
    "Rode o apply.sh atualizado, que só injeta apao-alertas.js no nginx.",
    file=sys.stderr,
)
raise SystemExit(1)
