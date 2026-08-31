import type { Workbook } from 'exceljs';
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
  return [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function styleForCell(cell: ScheduleCellData): { bg: string; fg: string } {
  const cssClass = cellKindClass(cell.kind, cell.display);
  const background = toHex(CELL_COLORS[cssClass] ?? CELL_COLORS['cell-empty']!);
  const foreground = LIGHT_TEXT.has(cssClass) ? 'FFFFFF' : '111827';
  return { bg: background, fg: foreground };
}

function asValidDate(value?: string | Date): Date {
  const date = value instanceof Date ? new Date(value) : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function worksheetName(title: string): string {
  return title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Escala';
}

function triggerDownload(buffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari/iOS ainda pode estar consumindo a URL quando o clique retorna.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Monta o workbook no padrão visual clássico da escala. */
export async function buildScheduleExcelWorkbook(
  grid: ScheduleGridData,
  title?: string,
  generatedAt?: string | Date,
): Promise<Workbook> {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default;
  const monthLabel = String(grid.month).padStart(2, '0');
  const documentTitle = title ?? `Escala ${monthLabel}/${grid.year}`;
  const generatedDate = asValidDate(generatedAt);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Escala PAO/APAO';
  workbook.created = generatedDate;

  const sheet = workbook.addWorksheet(worksheetName(documentTitle), {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      paperSize: 9,
    },
  });

  const lastColumn = grid.dayNumbers.length + 1;

  sheet.mergeCells(1, 1, 1, lastColumn);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = documentTitle;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF111827' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 22;

  const header = sheet.getRow(2);
  header.getCell(1).value = 'Funcionário';
  grid.dayNumbers.forEach((day, index) => {
    const weekday = grid.weekdayLabels[index] ?? '';
    header.getCell(index + 2).value = weekday ? `${day}\n${weekday}` : day;
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

  sheet.getColumn(1).width = 22;
  for (let column = 2; column <= lastColumn; column += 1) {
    sheet.getColumn(column).width = 4.2;
  }

  let excelRow = 3;
  for (const group of grid.groups) {
    sheet.mergeCells(excelRow, 1, excelRow, lastColumn);
    const groupCell = sheet.getCell(excelRow, 1);
    groupCell.value = group.label;
    groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6900' } };
    groupCell.alignment = { vertical: 'middle', horizontal: 'left' };
    excelRow += 1;

    for (const employee of group.rows) {
      const row = sheet.getRow(excelRow);
      const nameCell = row.getCell(1);
      nameCell.value = employee.name;
      nameCell.font = { bold: true, size: 9, color: { argb: 'FF111827' } };
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
      nameCell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };

      grid.dayNumbers.forEach((day, index) => {
        const cellData =
          employee.cells[day - 1] ?? ({ display: '', kind: 'empty' } as ScheduleCellData);
        const cell = row.getCell(index + 2);
        const { bg, fg } = styleForCell(cellData);
        cell.value = cellData.display || '';
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

      row.height = 16;
      excelRow += 1;
    }
  }

  excelRow += 1;
  sheet.mergeCells(excelRow, 1, excelRow, lastColumn);
  const footer = sheet.getCell(excelRow, 1);
  footer.value = `Gerado em ${generatedDate.toLocaleString('pt-BR')} · Escala PAO/APAO`;
  footer.font = { size: 8, italic: true, color: { argb: 'FF6B7280' } };

  return workbook;
}

export async function buildScheduleExcelBuffer(
  grid: ScheduleGridData,
  title?: string,
  generatedAt?: string | Date,
): Promise<ArrayBuffer> {
  const workbook = await buildScheduleExcelWorkbook(grid, title, generatedAt);
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Excel A4-friendly: linhas = funcionários, colunas = dias, cores da escala. */
export async function downloadScheduleExcel(
  grid: ScheduleGridData,
  title?: string,
  generatedAt?: string | Date,
): Promise<void> {
  const monthLabel = String(grid.month).padStart(2, '0');
  const buffer = await buildScheduleExcelBuffer(grid, title, generatedAt);
  triggerDownload(buffer, `escala_${grid.year}_${monthLabel}.xlsx`);
}
