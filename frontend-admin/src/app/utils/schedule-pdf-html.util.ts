import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';
import { cellKindClass } from './schedule-cell.mapper';

const CELL_COLORS: Record<string, { bg: string; fg: string }> = {
  'cell-shift': { bg: '#dbeafe', fg: '#1d4ed8' },
  'cell-t6': { bg: '#dbeafe', fg: '#1d4ed8' },
  'cell-t7': { bg: '#e0e7ff', fg: '#4338ca' },
  'cell-t8': { bg: '#ede9fe', fg: '#6d28d9' },
  'cell-t9': { bg: '#fce7f3', fg: '#be185d' },
  'cell-instruction': { bg: '#fef08a', fg: '#854d0e' },
  'cell-nd': { bg: '#e5e7eb', fg: '#4b5563' },
  'cell-folga': { bg: '#fecaca', fg: '#991b1b' },
  'cell-fs': { bg: '#bbf7d0', fg: '#166534' },
  'cell-fa': { bg: '#14532d', fg: '#dcfce7' },
  'cell-fani': { bg: '#fbcfe8', fg: '#9d174d' },
  'cell-fp': { bg: '#e9d5ff', fg: '#6b21a8' },
  'cell-fp-weekend': { bg: '#bbf7d0', fg: '#166534' },
  'cell-folga-weekend': { bg: '#bbf7d0', fg: '#166534' },
  'cell-ferias': { bg: '#e0f2fe', fg: '#0369a1' },
  'cell-voo': { bg: '#f15a22', fg: '#ffffff' },
  'cell-simulador': { bg: '#374151', fg: '#f3f4f6' },
  'cell-curso': { bg: '#fef08a', fg: '#854d0e' },
  'cell-cma': { bg: '#1e3a8a', fg: '#dbeafe' },
  'cell-outro': { bg: '#78350f', fg: '#fef3c7' },
  'cell-other': { bg: '#78350f', fg: '#fef3c7' },
  'cell-empty': { bg: '#ffffff', fg: '#9ca3af' },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellStyle(cell: ScheduleCellData): string {
  const cls = cellKindClass(cell.kind, cell.display);
  const colors = CELL_COLORS[cls] ?? CELL_COLORS['cell-empty']!;
  return `background:${colors.bg};color:${colors.fg};`;
}

/** HTML em 1 página A4 paisagem — escala completa, sem fatiar dias. */
export function buildSchedulePdfHtml(grid: ScheduleGridData, title?: string): string {
  const monthLabel = String(grid.month).padStart(2, '0');
  const docTitle = title ?? `Escala ${monthLabel}/${grid.year} — Completa`;

  const headDays = grid.dayNumbers
    .map((d, i) => {
      const wd = grid.weekdayLabels[i] ?? '';
      return `<th><span class="day">${d}</span><span class="wd">${escapeHtml(wd)}</span></th>`;
    })
    .join('');

  const body = grid.groups
    .map((group) => {
      const groupRow = `<tr class="group-row"><td colspan="${grid.dayNumbers.length + 1}">${escapeHtml(group.label)}</td></tr>`;
      const employeeRows = group.rows
        .map((row) => {
          const cells = grid.dayNumbers
            .map((day) => {
              const cell = row.cells[day - 1] ?? { display: '', kind: 'empty' as const };
              return `<td style="${cellStyle(cell)}">${escapeHtml(cell.display || '')}</td>`;
            })
            .join('');
          return `<tr><th class="emp">${escapeHtml(row.name)}</th>${cells}</tr>`;
        })
        .join('');
      return groupRow + employeeRows;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(docTitle)}</title>
  <style>
    @page { size: A4 landscape; margin: 4mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      background: #fff;
    }
    .sheet {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    header {
      flex: 0 0 auto;
      margin-bottom: 3px;
    }
    h1 { font-size: 11px; margin: 0; }
    header p { margin: 0; font-size: 7px; color: #6b7280; }
    .table-wrap {
      flex: 1 1 auto;
      min-height: 0;
    }
    table {
      width: 100%;
      height: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 5.5px;
    }
    th, td {
      border: 0.35px solid #9ca3af;
      padding: 0;
      text-align: center;
      vertical-align: middle;
      overflow: hidden;
      white-space: nowrap;
      line-height: 1.05;
    }
    thead th {
      background: #111827;
      color: #fff;
      font-weight: 700;
    }
    th.emp {
      width: 78px;
      text-align: left;
      padding-left: 2px;
      background: #111827;
      color: #fff;
      font-size: 5.5px;
    }
    tbody th.emp {
      background: #f3f4f6;
      color: #111827;
      font-weight: 600;
    }
    .day { display: block; }
    .wd { display: block; font-size: 4.5px; font-weight: 500; opacity: 0.9; }
    .group-row td {
      background: #ff6900;
      color: #fff;
      font-weight: 700;
      text-align: left;
      padding-left: 4px;
      font-size: 6px;
    }
    @media print {
      html, body, .sheet { height: 100%; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <header>
      <h1>${escapeHtml(docTitle)}</h1>
      <p>1 folha A4 paisagem · ${new Date().toLocaleString('pt-BR')}</p>
    </header>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="emp">Funcionário</th>
            ${headDays}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 200);
    };
  </script>
</body>
</html>`;
}
