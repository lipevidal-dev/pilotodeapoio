# EXPORTAR APAOS — Escala de Revezamento

Somente o escopo **Exportar APAOs** (Excel/PDF) usa este layout.

- `chunk-APAOREV07.js` — gerador Excel/PDF
- `patch-apao-export.py` — injeta branch `scope === 'apao'` no `ScheduleExportService` minificado
- Códigos: `T1..T4` → `1..4`, folga → `FR` (vermelho), `FA` (verde)
- CIF vem de `Employee.cif` (API `/api/employees`)

Source permanente: `frontend-admin/src/app/utils/schedule-apao-revezamento-export.util.ts`
+ `ScheduleExportService` (branch `apao`).
