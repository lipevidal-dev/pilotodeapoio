# EXPORTAR APAOS — Escala de Revezamento

Somente o escopo **Exportar APAOs** (Excel/PDF) usa este layout.

- `chunk-APAOREV07.js` — gerador Excel/PDF
- `patch-apao-export.py` — injeta branch `scope === 'apao'` no `ScheduleExportService` minificado
- Códigos: `T1..T4` → `1..4`, folga → `FR` (vermelho), `FA` (verde)
- CIF vem de `Employee.cif` (API `/api/employees`)

Source permanente: `frontend-admin/src/app/utils/schedule-apao-revezamento-export.util.ts`
+ `ScheduleExportService` (branch `apao`).

O JS do admin fica em cache por 7 dias. `cache-bust.sh` publica nomes novos
(`main-APAOREV08.js`) para o navegador baixar o layout Escala de Revezamento.

`apply-legend.sh` acrescenta o bloco LEGENDA AEROVIÁRIO e as cores da legenda
(`main-APAOREV09.js`).

`apply-espelho.sh` alinha o Excel ao arquivo da empresa: logo GOL
(`logo-gol-wordmark.png`), NOME em A+B, CIF em C, dias a partir de D
com largura 4, e a legenda no mesmo eixo (`main-APAOREV10.js`).
