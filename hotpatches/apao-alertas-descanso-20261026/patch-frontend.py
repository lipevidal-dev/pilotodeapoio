#!/usr/bin/env python3
from __future__ import annotations

import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/pilotodeapoiov2")
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
BACKUP = ROOT / "hotpatch-backup" / f"apao-alertas-descanso-{STAMP}"


def update(relative: str, transform) -> None:
    path = ROOT / relative
    if not path.exists():
        raise SystemExit(f"Arquivo não encontrado: {path}")

    raw = path.read_bytes().decode("utf-8")
    newline = "\r\n" if "\r\n" in raw else "\n"
    current = raw.replace("\r\n", "\n")
    changed = transform(current)
    if changed == current:
        print(f"sem alteração: {relative}")
        return

    backup_path = BACKUP / relative
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup_path)
    path.write_bytes(changed.replace("\n", newline).encode("utf-8"))
    print(f"atualizado: {relative}")


def patch_options(text: str) -> str:
    match = re.search(
        r"(const APAO_OPERATIONAL_OPTIONS: AllocationSelectOption\[\] = \[)(.*?)(\n\];)",
        text,
        flags=re.DOTALL,
    )
    if not match:
        raise SystemExit("Bloco APAO_OPERATIONAL_OPTIONS não encontrado")

    block = match.group(2)
    additions = [
        ("VOO", "VOO"),
        ("CURSO", "Curso"),
        ("SIMULADOR", "Simulador"),
    ]
    missing = [
        f"  {{ key: '{key}', label: '{label}' }},"
        for key, label in additions
        if f"key: '{key}'" not in block
    ]
    if not missing:
        return text

    insertion = "\n" + "\n".join(missing)
    nd_line = "\n  { key: 'ND', label: 'ND' },"
    if nd_line in block:
        block = block.replace(nd_line, insertion + nd_line, 1)
    else:
        block += insertion
    return text[: match.start(2)] + block + text[match.end(2) :]


def patch_grid_ts(text: str) -> str:
    if "TooltipModule" not in text:
        marker = "import { ButtonModule } from 'primeng/button';"
        if marker not in text:
            raise SystemExit("Import ButtonModule não encontrado")
        text = text.replace(
            marker,
            marker + "\nimport { TooltipModule } from 'primeng/tooltip';",
            1,
        )

    api_import = re.search(
        r"import type \{(?P<items>[^}]*)\} from '../../models/api\.models';",
        text,
        flags=re.DOTALL,
    )
    if not api_import:
        raise SystemExit("Import de api.models não encontrado")
    if "Shift" not in api_import.group("items"):
        items = api_import.group("items").strip()
        replacement = f"import type {{ {items}, Shift }} from '../../models/api.models';"
        text = text[: api_import.start()] + replacement + text[api_import.end() :]

    if "computeApaoRestAlerts" not in text:
        marker = "import {\n  isDeletableCell as cellIsDeletable,"
        if marker not in text:
            raise SystemExit("Âncora dos utilitários da grade não encontrada")
        text = text.replace(
            marker,
            "import { computeApaoRestAlerts } from '../../utils/apao-rest-alerts.util';\n"
            + marker,
            1,
        )

    imports_match = re.search(r"(imports:\s*\[)(.*?)(\n\s*\],)", text, flags=re.DOTALL)
    if not imports_match:
        raise SystemExit("Array imports do ScheduleGridComponent não encontrado")
    imports_block = imports_match.group(2)
    if "TooltipModule" not in imports_block:
        if "ButtonModule," not in imports_block:
            raise SystemExit("ButtonModule não encontrado no array imports")
        imports_block = imports_block.replace("ButtonModule,", "ButtonModule,\n    TooltipModule,", 1)
        text = text[: imports_match.start(2)] + imports_block + text[imports_match.end(2) :]

    if "readonly apaoRestAlerts" not in text:
        marker = "  readonly auditTotals = input<GridAuditTotals | null>(null);"
        if marker not in text:
            raise SystemExit("Input auditTotals não encontrado")
        text = text.replace(
            marker,
            marker
            + "\n  readonly shifts = input<Shift[]>([]);"
            + "\n  readonly apaoRestAlerts = computed(() => computeApaoRestAlerts(this.grid(), this.shifts()));",
            1,
        )
    return text


def patch_grid_html(text: str) -> str:
    if 'class="apao-rest-alerts"' in text:
        return text
    marker = "              {{ group.label }}"
    if marker not in text:
        raise SystemExit("Título do grupo da grade não encontrado")
    replacement = """              <span class="group-label-text">{{ group.label }}</span>
              @if (group.type === 'APAO' && apaoRestAlerts().length > 0) {
                <span class="apao-rest-alerts" aria-label="Alertas de descanso APAO">
                  @for (alert of apaoRestAlerts(); track alert.kind) {
                    <span
                      class="apao-rest-alert"
                      [attr.aria-label]="alert.label + ': ' + alert.count"
                      [pTooltip]="alert.tooltip"
                      tooltipPosition="top"
                      [escape]="false"
                    >
                      <img [src]="alert.iconSrc" alt="" aria-hidden="true" />
                      <span>{{ alert.count }}</span>
                    </span>
                  }
                </span>
              }"""
    return text.replace(marker, replacement, 1)


ALERT_CSS = """

.group-label-text {
  vertical-align: middle;
}

.apao-rest-alerts {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.55rem;
  vertical-align: middle;
}

.apao-rest-alert {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  min-height: 1.25rem;
  padding: 0.08rem 0.3rem;
  border: 1px solid #fdba74;
  border-radius: 999px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  cursor: help;
}

.apao-rest-alert img {
  width: 0.9rem;
  height: 0.9rem;
  object-fit: contain;
}
"""


def patch_grid_scss(text: str) -> str:
    if ".apao-rest-alerts" in text:
        return text
    return text.rstrip() + ALERT_CSS + "\n"


def patch_schedule_html(text: str) -> str:
    if '[shifts]="activeScheduleData()?.shifts ?? []"' in text:
        return text
    marker = '          [auditTotals]="gridAuditTotals()"'
    if marker not in text:
        raise SystemExit("Binding auditTotals da escala não encontrado")
    return text.replace(
        marker,
        marker + '\n\n          [shifts]="activeScheduleData()?.shifts ?? []"',
        1,
    )


update(
    "frontend-admin/src/app/utils/build-manual-allocation-options.util.ts",
    patch_options,
)
update(
    "frontend-admin/src/app/components/schedule-grid/schedule-grid.component.ts",
    patch_grid_ts,
)
update(
    "frontend-admin/src/app/components/schedule-grid/schedule-grid.component.html",
    patch_grid_html,
)
update(
    "frontend-admin/src/app/components/schedule-grid/schedule-grid.component.scss",
    patch_grid_scss,
)
update(
    "frontend-admin/src/app/pages/schedule/schedule.component.html",
    patch_schedule_html,
)

print(f"backup: {BACKUP}")
