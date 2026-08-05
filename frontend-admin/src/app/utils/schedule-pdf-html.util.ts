import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';
import { cellKindClass } from './schedule-cell.mapper';

/** Quantidade de dias por página no PDF — evita corte horizontal em A4 paisagem. */
export const PDF_DAYS_PER_PAGE = 16;

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

function chunkDays(dayNumbers: number[], size: number): number[][] {
  const chunks: number[][] = [];
  for (let i = 0; i < dayNumbers.length; i += size) {
    chunks.push(dayNumbers.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [[]];
}

function weekdayLabel(grid: ScheduleGridData, day: number): string {
  const idx = grid.dayNumbers.indexOf(day);
  return idx >= 0 ? (grid.weekdayLabels[idx] ?? '') : '';
}

function buildTableChunk(grid: ScheduleGridData, days: number[], title: string): string {
  const headDays = days
    .map((d) => {
      const wd = weekdayLabel(grid, d);
      return `<th><span class="day">${d}</span><span class="wd">${escapeHtml(wd)}</span></th>`;
    })
    .join('');

  const body = grid.groups
    .map((group) => {
      const groupRow = `<tr class="group-row"><td colspan="${days.length + 1}">${escapeHtml(group.label)}</td></tr>`;
      const employeeRows = group.rows
        .map((row) => {
          const cells = days
            .map((day) => {
              const cell = row.cells[day - 1] ?? { display: '', kind: 'empty' as const };
              const text = escapeHtml(cell.display || '');
              return `<td style="${cellStyle(cell)}">${text}</td>`;
            })
            .join('');
          return `<tr><th class="emp">${escapeHtml(row.name)}</th>${cells}</tr>`;
        })
        .join('');
      return groupRow + employeeRows;
    })
    .join('');

  return `
    <section class="page">
      <header>
        <h1>${escapeHtml(title)}</h1>
        <p>Dias ${days[0] ?? '-'}–${days[days.length - 1] ?? '-'} · gerado em ${new Date().toLocaleString('pt-BR')}</p>
      </header>
      <table>
        <thead>
          <tr>
            <th class="emp">Funcionário</th>
            ${headDays}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

/** HTML independente do viewport — usado para imprimir/salvar PDF completo. */
export function buildSchedulePdfHtml(grid: ScheduleGridData, title?: string): string {
  const monthLabel = String(grid.month).padStart(2, '0');
  const docTitle = title ?? `Escala ${monthLabel}/${grid.year} — Completa`;
  const chunks = chunkDays(grid.dayNumbers, PDF_DAYS_PER_PAGE);
  const pages = chunks.map((days) => buildTableChunk(grid, days, docTitle)).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(docTitle)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      background: #fff;
    }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    header { margin-bottom: 8px; }
    h1 { font-size: 14px; margin: 0 0 2px; }
    header p { margin: 0; font-size: 9px; color: #6b7280; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 7px;
    }
    th, td {
      border: 0.4px solid #9ca3af;
      padding: 2px 1px;
      text-align: center;
      vertical-align: middle;
      overflow: hidden;
      white-space: nowrap;
    }
    thead th {
      background: #111827;
      color: #fff;
      font-weight: 700;
    }
    th.emp, td.emp, .emp {
      width: 92px;
      text-align: left;
      padding-left: 4px;
      font-size: 7px;
      background: #f3f4f6;
      color: #111827;
    }
    thead th.emp { background: #111827; color: #fff; }
    .day { display: block; line-height: 1.1; }
    .wd { display: block; font-size: 6px; font-weight: 500; opacity: 0.85; }
    .group-row td {
      background: #ff6900;
      color: #fff;
      font-weight: 700;
      text-align: left;
      padding-left: 6px;
      font-size: 8px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${pages}
</body>
</html>`;
}
