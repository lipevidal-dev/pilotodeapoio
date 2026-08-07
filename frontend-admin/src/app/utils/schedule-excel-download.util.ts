import ExcelJS from 'exceljs';
import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';
import { cellKindClass } from './schedule-cell.mapper';

type Rgb = [number, number, number];

const CELL_COLORS: Record<string, Rgb> = {
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

const LIGHT_TEXT = new Set([
  'cell-fa',
  'cell-voo',
  'cell-simulador',
  'cell-cma',
  'cell-outro',
  'cell-other',
]);

function toHex([r, g, b]: Rgb): string {
  return [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function styleForCell(cell: ScheduleCellData): { bg: string; fg: string } {
  const cls = cellKindClass(cell.kind, cell.display);
  const bg = toHex(CELL_COLORS[cls] ?? CELL_COLORS['cell-empty']!);
  const fg = LIGHT_TEXT.has(cls) ? 'FFFFFF' : '111827';
  return { bg, fg };
}

function triggerDownload(buffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Excel A4-friendly: linhas = funcionários, colunas = dias, cores da escala. */
export async function downloadScheduleExcel(
  grid: ScheduleGridData,
  title?: string,
): Promise<void> {
  const monthLabel = String(grid.month).padStart(2, '0');
  const docTitle = title ?? `Escala ${monthLabel}/${grid.year}`;
  const fileName = `escala_${grid.year}_${monthLabel}.xlsx`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escala PAO/APAO';
  wb.created = new Date();

  const sheetName = docTitle.replace(/[\\/?*[\]]/g, ' ').slice(0, 31) || 'Escala';
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      paperSize: 9, // A4
    },
  });

  const dayCount = grid.dayNumbers.length;
  const lastCol = dayCount + 1;

  // Título
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = docTitle;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF111827' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 22;

  // Cabeçalho
  const header = ws.getRow(2);
  header.getCell(1).value = 'Funcionário';
  grid.dayNumbers.forEach((day, i) => {
    const wd = grid.weekdayLabels[i] ?? '';
    header.getCell(i + 2).value = wd ? `${day}\n${wd}` : day;
  });
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    };
  });
  header.height = 28;

  ws.getColumn(1).width = 22;
  for (let c = 2; c <= lastCol; c++) {
    ws.getColumn(c).width = 4.2;
  }

  let excelRow = 3;
  for (const group of grid.groups) {
    // Linha de grupo (PAO / APAO)
    ws.mergeCells(excelRow, 1, excelRow, lastCol);
    const groupCell = ws.getCell(excelRow, 1);
    groupCell.value = group.label;
    groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6900' } };
    groupCell.alignment = { vertical: 'middle', horizontal: 'left' };
    excelRow++;

    for (const row of group.rows) {
      const r = ws.getRow(excelRow);
      const nameCell = r.getCell(1);
      nameCell.value = row.name;
      nameCell.font = { bold: true, size: 9, color: { argb: 'FF111827' } };
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
      nameCell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };

      grid.dayNumbers.forEach((day, i) => {
        const cellData = row.cells[day - 1] ?? ({ display: '', kind: 'empty' } as ScheduleCellData);
        const cell = r.getCell(i + 2);
        cell.value = cellData.display || '';
        const { bg, fg } = styleForCell(cellData);
        cell.font = { bold: true, size: 8, color: { argb: `FF${fg}` } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
      });

      r.height = 16;
      excelRow++;
    }
  }

  // Rodapé leve
  excelRow += 1;
  ws.mergeCells(excelRow, 1, excelRow, lastCol);
  const foot = ws.getCell(excelRow, 1);
  foot.value = `Gerado em ${new Date().toLocaleString('pt-BR')} · Escala PAO/APAO`;
  foot.font = { size: 8, italic: true, color: { argb: 'FF6B7280' } };

  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(buffer as ArrayBuffer, fileName);
}
