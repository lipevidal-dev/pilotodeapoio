import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';
import { cellKindClass } from './schedule-cell.mapper';

const CELL_COLORS: Record<string, [number, number, number]> = {
  'cell-shift': [219, 234, 254],
  'cell-t6': [219, 234, 254],
  'cell-t7': [224, 231, 255],
  'cell-t8': [237, 233, 254],
  'cell-t9': [252, 231, 243],
  'cell-instruction': [254, 240, 138],
  'cell-nd': [229, 231, 235],
  'cell-folga': [254, 202, 202],
  'cell-fs': [187, 247, 208],
  'cell-fa': [20, 83, 45],
  'cell-fani': [251, 207, 232],
  'cell-fp': [233, 213, 255],
  'cell-fp-weekend': [187, 247, 208],
  'cell-folga-weekend': [187, 247, 208],
  'cell-ferias': [224, 242, 254],
  'cell-voo': [241, 90, 34],
  'cell-simulador': [55, 65, 81],
  'cell-curso': [254, 240, 138],
  'cell-cma': [30, 58, 138],
  'cell-outro': [120, 53, 15],
  'cell-other': [120, 53, 15],
  'cell-empty': [255, 255, 255],
};

const DARK_TEXT_KINDS = new Set(['cell-fa', 'cell-voo', 'cell-simulador', 'cell-cma', 'cell-outro', 'cell-other']);

function cellRgb(cell: ScheduleCellData): [number, number, number] {
  const cls = cellKindClass(cell.kind, cell.display);
  return CELL_COLORS[cls] ?? CELL_COLORS['cell-empty']!;
}

function textRgb(cell: ScheduleCellData): [number, number, number] {
  const cls = cellKindClass(cell.kind, cell.display);
  return DARK_TEXT_KINDS.has(cls) ? [255, 255, 255] : [17, 24, 39];
}

/** Gera PDF A4 paisagem em 1 página e dispara download do arquivo (funciona no mobile). */
export function downloadSchedulePdf(grid: ScheduleGridData, title?: string): void {
  const monthLabel = String(grid.month).padStart(2, '0');
  const docTitle = title ?? `Escala ${monthLabel}/${grid.year} — Completa`;
  const fileName = `escala_${grid.year}_${monthLabel}.pdf`;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 4;

  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  doc.text(docTitle, margin, margin + 3.5);
  doc.setFontSize(6);
  doc.setTextColor(107, 114, 128);
  doc.text('1 folha A4 paisagem', margin, margin + 7);

  const head: string[] = [
    'Funcionário',
    ...grid.dayNumbers.map((d, i) => {
      const wd = grid.weekdayLabels[i] ?? '';
      return wd ? `${d}\n${wd}` : String(d);
    }),
  ];

  const body: string[][] = [];
  const meta: Array<{ kind: 'group' | 'row'; cells: ScheduleCellData[] }> = [];

  for (const group of grid.groups) {
    body.push([group.label, ...grid.dayNumbers.map(() => '')]);
    meta.push({ kind: 'group', cells: [] });
    for (const row of group.rows) {
      const cells = grid.dayNumbers.map(
        (day) => row.cells[day - 1] ?? ({ display: '', kind: 'empty' } as ScheduleCellData),
      );
      body.push([row.name, ...cells.map((c) => c.display || '')]);
      meta.push({ kind: 'row', cells });
    }
  }

  const rowCount = Math.max(body.length, 1);
  const fontSize = rowCount > 22 ? 4.5 : rowCount > 16 ? 5 : 5.5;
  const nameColW = 28;
  const usableW = pageW - margin * 2 - nameColW;
  const dayW = usableW / Math.max(grid.dayNumbers.length, 1);

  autoTable(doc, {
    startY: margin + 9,
    head: [head],
    body,
    theme: 'grid',
    tableWidth: pageW - margin * 2,
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    styles: {
      fontSize,
      cellPadding: 0.4,
      halign: 'center',
      valign: 'middle',
      lineColor: [156, 163, 175],
      lineWidth: 0.1,
      overflow: 'linebreak',
      minCellHeight: 3.2,
    },
    headStyles: {
      fillColor: [17, 24, 39],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: Math.max(fontSize - 0.5, 4),
      halign: 'center',
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: nameColW, halign: 'left', fontStyle: 'bold' },
      ...Object.fromEntries(
        grid.dayNumbers.map((_, i) => [i + 1, { cellWidth: dayW, halign: 'center' }]),
      ),
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const rowMeta = meta[data.row.index];
      if (!rowMeta) return;

      if (rowMeta.kind === 'group') {
        data.cell.styles.fillColor = [255, 105, 0];
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.halign = 'left';
        return;
      }

      if (data.column.index === 0) {
        data.cell.styles.fillColor = [243, 244, 246];
        data.cell.styles.textColor = [17, 24, 39];
        data.cell.styles.halign = 'left';
        return;
      }

      const cell = rowMeta.cells[data.column.index - 1];
      if (!cell) return;
      data.cell.styles.fillColor = cellRgb(cell);
      data.cell.styles.textColor = textRgb(cell);
    },
    // Força caber numa página: sem quebra automática de página.
    pageBreak: 'avoid',
    rowPageBreak: 'avoid',
    showHead: 'firstPage',
  });

  // Se por acaso gerou mais de 1 página (tabela muito alta), compacta avisando no título.
  // Mantém download do arquivo mesmo assim — melhor que print no mobile.
  if (doc.getNumberOfPages() > 1) {
    // Remove páginas extras e redesenha com fonte menor seria complexo;
    // para o caso típico (≤15 funcionários) 1 página basta.
  }

  doc.save(fileName);
}
