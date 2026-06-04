import os
import re

root_dir = "c:/Users/xirin/OneDrive/Desktop/Escala Piloto de Apoio/Sistema_Escala_PAO_APAO_V4"
pattern = re.compile(r"delete_month_schedule")

for dirpath, _, filenames in os.walk(root_dir):
    if ".venv" in dirpath or ".git" in dirpath or "__pycache__" in dirpath:
        continue
    for f in filenames:
        if f.endswith(".py"):
            file_path = os.path.join(dirpath, f)
            with open(file_path, "r", encoding="utf-8", errors="ignore") as file:
                for line_num, line in enumerate(file, 1):
                    if pattern.search(line):
                        print(f"{os.path.relpath(file_path, root_dir)}:{line_num}: {line.strip()}")
