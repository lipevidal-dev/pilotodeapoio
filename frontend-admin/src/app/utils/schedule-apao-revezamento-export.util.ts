import type { Workbook } from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';

/** Layout exigido pela empresa — somente EXPORTAR APAOS. */

type Rgb = [number, number, number];

const GOL_ORANGE: Rgb = [241, 90, 34];
const FR_BG: Rgb = [255, 0, 0];
const FA_BG: Rgb = [198, 224, 180];
const FS_BG: Rgb = [255, 255, 0];
const FC_BG: Rgb = [237, 125, 49];
const V_BG: Rgb = [166, 166, 166];
const DM_BG: Rgb = [189, 215, 238];
const L_BG: Rgb = [0, 176, 240];
const FB_BG: Rgb = [31, 78, 121];
const ND_BG: Rgb = [229, 231, 235];
const FP_BG: Rgb = [233, 213, 255];
const RA_BG: Rgb = [255, 230, 153];
const SIM_BG: Rgb = [89, 89, 89];
const WEEKEND_HEADER_BG: Rgb = [255, 199, 206];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** Bloco fixo da planilha da empresa, abaixo da grade. */
const LEGEND_LEFT: Array<[string, string]> = [
  ['FR', 'FOLGA REGULAMENTAR'],
  ['FA', 'FOLGA AGRUPADA'],
  ['FS', 'FOLGA SOCIAL'],
  ['K', 'CURSO'],
  ['FC', 'FOLGA COMPENSA'],
  ['V', 'VOO'],
];

const LEGEND_RIGHT: Array<[string, string] | null> = [
  ['FF', 'FOLGA FERIADO'],
  ['DM', 'DISPENSA MÉDICA'],
  ['L', 'FÉRIAS'],
  ['FB', 'FOLGA ANIVERSÁRIO'],
  ['EP', 'EXAME PERIÓDICO'],
  null,
];

const TURNOS: Array<[string, string]> = [
  ['Turno 1', '00:00 - 06:00'],
  ['Turno 2', '06:00 - 12:00'],
  ['Turno 3', '12:00 - 18:00'],
  ['Turno 4', '18:00 - 00:00'],
];

const MONTH_SHORT_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

const WEEKDAY_SHORT: Record<string, string> = {
  Dom: 'dom',
  Seg: 'seg',
  Ter: 'ter',
  Qua: 'qua',
  Qui: 'qui',
  Sex: 'sex',
  Sáb: 'sáb',
  Sab: 'sáb',
};

export interface ApaoRevezamentoCell {
  text: string;
  bg: Rgb;
  fg: Rgb;
}

function toArgb([r, g, b]: Rgb): string {
  return `FF${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function monthBanner(year: number, month: number): string {
  const label = MONTH_SHORT_PT[month - 1] ?? String(month).padStart(2, '0');
  return `Mês: ${label}/${year}`;
}

function weekdayShort(label: string): string {
  return WEEKDAY_SHORT[label] ?? label.toLowerCase();
}

function isWeekendLabel(label: string): boolean {
  const short = weekdayShort(label);
  return short === 'sáb' || short === 'dom';
}

function normCode(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function painted(text: string, bg: Rgb, fg: Rgb = BLACK): ApaoRevezamentoCell {
  return { text, bg, fg };
}

const LEGEND_PAINT: Record<string, ApaoRevezamentoCell> = {
  FR: painted('FR', FR_BG),
  FA: painted('FA', FA_BG),
  FS: painted('FS', FS_BG),
  K: painted('K', FS_BG),
  FC: painted('FC', FC_BG),
  V: painted('V', V_BG),
  FF: painted('FF', WHITE),
  DM: painted('DM', DM_BG),
  L: painted('L', L_BG),
  FB: painted('FB', FB_BG, WHITE),
  EP: painted('EP', FS_BG),
  ND: painted('ND', ND_BG),
  FP: painted('FP', FP_BG),
  RA: painted('RA', RA_BG),
  SIM: painted('SIM', SIM_BG, WHITE),
};

/** Converte célula interna (T4, F, FER, VOO…) para o código e a cor da legenda GOL. */
export function mapApaoRevezamentoCell(cell: ScheduleCellData | undefined | null): ApaoRevezamentoCell {
  const display = normCode(cell?.display ?? '');
  const kind = cell?.kind ?? 'empty';

  if (!display || kind === 'empty') {
    return { text: '', bg: WHITE, fg: BLACK };
  }

  const shiftMatch = /^T([1-4])$/.exec(display);
  if (shiftMatch) {
    return { text: shiftMatch[1]!, bg: WHITE, fg: BLACK };
  }

  if (kind === 'ferias' || display === 'FER' || display === 'FERIAS' || display === 'L') {
    return LEGEND_PAINT['L']!;
  }
  if (kind === 'fani' || display === 'FANI' || display === 'FB') return LEGEND_PAINT['FB']!;
  if (kind === 'fa' || display === 'FA') return LEGEND_PAINT['FA']!;
  if (kind === 'fs' || display === 'FS') return LEGEND_PAINT['FS']!;
  if (kind === 'voo' || display === 'VOO' || display === 'V') return LEGEND_PAINT['V']!;
  if (kind === 'curso' || display === 'CRS' || display === 'CURSO' || display === 'K') {
    return LEGEND_PAINT['K']!;
  }
  if (kind === 'cma' || display === 'CMA' || display === 'EP') return LEGEND_PAINT['EP']!;
  if (display === 'DM' || display.includes('DISPENSA')) return LEGEND_PAINT['DM']!;
  if (display === 'FC') return LEGEND_PAINT['FC']!;
  if (display === 'FF') return LEGEND_PAINT['FF']!;
  if (kind === 'fp' || kind === 'fp-weekend' || display === 'FP') return LEGEND_PAINT['FP']!;
  if (kind === 'nd' || display === 'ND') return LEGEND_PAINT['ND']!;
  if (kind === 'simulador' || display === 'SIM' || display === 'S') return LEGEND_PAINT['SIM']!;
  if (display === 'RA') return LEGEND_PAINT['RA']!;

  if (
    kind === 'folga' ||
    kind === 'folga-weekend' ||
    display === 'F' ||
    display === 'FR' ||
    display === 'FOLGA'
  ) {
    return LEGEND_PAINT['FR']!;
  }

  return { text: display, bg: WHITE, fg: BLACK };
}

function apaoRows(grid: ScheduleGridData) {
  return grid.groups.filter((g) => g.type === 'APAO').flatMap((g) => g.rows);
}

function triggerXlsxDownload(buffer: ArrayBuffer, fileName: string): void {
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
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const THIN_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FF000000' } },
  left: { style: 'thin' as const, color: { argb: 'FF000000' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  right: { style: 'thin' as const, color: { argb: 'FF000000' } },
};

interface LegendLayout {
  code1: number;
  label1: [number, number];
  code2: number;
  label2: [number, number];
  turnoCol: number;
  turnoEnd: number;
  horarioCol: number;
  horarioEnd: number;
}

function legendLayout(lastCol: number): LegendLayout {
  const start = 3;
  const end = Math.max(lastCol, start + 20);
  const horarioW = 5;
  const turnoW = 4;
  const horarioCol = end - horarioW + 1;
  const turnoCol = horarioCol - turnoW;
  const leftEnd = turnoCol - 2;
  const leftSpan = leftEnd - start + 1;
  const code2 = start + Math.floor(leftSpan / 2);
  return {
    code1: start,
    label1: [start + 1, code2 - 1],
    code2,
    label2: [code2 + 1, leftEnd],
    turnoCol,
    turnoEnd: turnoCol + turnoW - 1,
    horarioCol,
    horarioEnd: end,
  };
}

function paintExcel(
  sheet: import('exceljs').Worksheet,
  row: number,
  col: number,
  value: string | number,
  opts: { bg?: Rgb; fg?: Rgb; bold?: boolean; size?: number; align?: 'left' | 'center' },
): void {
  const cell = sheet.getCell(row, col);
  cell.value = value;
  cell.font = {
    bold: opts.bold ?? true,
    size: opts.size ?? 9,
    color: { argb: toArgb(opts.fg ?? BLACK) },
    name: 'Calibri',
  };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: toArgb(opts.bg ?? WHITE) },
  };
  cell.alignment = { vertical: 'middle', horizontal: opts.align ?? 'center' };
  cell.border = THIN_BORDER;
}

function writeExcelLegend(sheet: import('exceljs').Worksheet, startRow: number, lastCol: number): void {
  const layout = legendLayout(lastCol);
  const headerRow = startRow;
  sheet.mergeCells(headerRow, 1, headerRow, layout.turnoCol - 2);
  paintExcel(sheet, headerRow, 1, 'LEGENDA AEROVIÁRIO', {
    bg: GOL_ORANGE,
    fg: WHITE,
    size: 11,
    align: 'left',
  });
  sheet.mergeCells(headerRow, layout.turnoCol, headerRow, layout.turnoEnd);
  paintExcel(sheet, headerRow, layout.turnoCol, 'TURNOS', { bg: GOL_ORANGE, fg: WHITE, size: 11 });
  sheet.mergeCells(headerRow, layout.horarioCol, headerRow, layout.horarioEnd);
  paintExcel(sheet, headerRow, layout.horarioCol, 'HORÁRIOS', { bg: GOL_ORANGE, fg: WHITE, size: 11 });
  sheet.getRow(headerRow).height = 18;

  for (let i = 0; i < LEGEND_LEFT.length; i += 1) {
    const row = headerRow + 1 + i;
    const left = LEGEND_LEFT[i]!;
    const right = LEGEND_RIGHT[i];
    const turno = TURNOS[i];
    const leftPaint = LEGEND_PAINT[left[0]]!;
    sheet.mergeCells(row, layout.label1[0], row, layout.label1[1]);
    paintExcel(sheet, row, layout.code1, leftPaint.text, { bg: leftPaint.bg, fg: leftPaint.fg, size: 8 });
    paintExcel(sheet, row, layout.label1[0], left[1], { align: 'left', size: 9 });

    sheet.mergeCells(row, layout.label2[0], row, layout.label2[1]);
    if (right) {
      const rightPaint = LEGEND_PAINT[right[0]]!;
      paintExcel(sheet, row, layout.code2, rightPaint.text, {
        bg: rightPaint.bg,
        fg: rightPaint.fg,
        size: 8,
      });
      paintExcel(sheet, row, layout.label2[0], right[1], { align: 'left', size: 9 });
    } else {
      paintExcel(sheet, row, layout.code2, '', { bg: WHITE });
      paintExcel(sheet, row, layout.label2[0], '', { align: 'left' });
    }

    sheet.mergeCells(row, layout.turnoCol, row, layout.turnoEnd);
    sheet.mergeCells(row, layout.horarioCol, row, layout.horarioEnd);
    paintExcel(sheet, row, layout.turnoCol, turno?.[0] ?? '', { align: 'center', size: 9 });
    paintExcel(sheet, row, layout.horarioCol, turno?.[1] ?? '', { align: 'center', size: 9 });
    sheet.getRow(row).height = 16;
  }
}

/** Monta workbook no layout Escala de Revezamento (somente APAOs). */
export async function buildApaoRevezamentoExcelWorkbook(grid: ScheduleGridData): Promise<Workbook> {
  const excelModule = await import('exceljs');
  const ExcelJS = excelModule.default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Escala APAO — Revezamento';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Escala de Revezamento', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      paperSize: 9,
    },
  });

  const days = grid.dayNumbers;
  const lastCol = 2 + days.length; // NOME | CIF | dias

  // Título
  sheet.mergeCells(1, 3, 2, lastCol);
  const titleCell = sheet.getCell(1, 3);
  titleCell.value = 'Escala de Revezamento';
  titleCell.font = { bold: true, size: 20, color: { argb: 'FF111827' }, name: 'Calibri' };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 22;
  sheet.getRow(2).height = 22;

  sheet.mergeCells(1, 1, 2, 2);
  const logoCell = sheet.getCell(1, 1);
  logoCell.value = 'GOL';
  logoCell.font = { bold: true, size: 22, color: { argb: toArgb(GOL_ORANGE) }, name: 'Calibri' };
  logoCell.alignment = { vertical: 'middle', horizontal: 'center' };

  // Faixa do mês
  sheet.mergeCells(3, 1, 3, lastCol);
  const monthCell = sheet.getCell(3, 1);
  monthCell.value = monthBanner(grid.year, grid.month);
  monthCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  monthCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(GOL_ORANGE) } };
  monthCell.alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(3).height = 20;

  // Cabeçalho NOME / CIF (merge 2 linhas)
  sheet.mergeCells(4, 1, 5, 1);
  sheet.mergeCells(4, 2, 5, 2);
  const nomeHeader = sheet.getCell(4, 1);
  nomeHeader.value = 'NOME';
  const cifHeader = sheet.getCell(4, 2);
  cifHeader.value = 'CIF';
  for (const cell of [nomeHeader, cifHeader]) {
    cell.font = { bold: true, size: 10, color: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } },
    };
  }

  days.forEach((day, index) => {
    const col = index + 3;
    const weekday = grid.weekdayLabels[index] ?? '';
    const weekend = isWeekendLabel(weekday);
    const dayCell = sheet.getCell(4, col);
    const wdCell = sheet.getCell(5, col);
    dayCell.value = day;
    wdCell.value = weekdayShort(weekday);
    for (const cell of [dayCell, wdCell]) {
      cell.font = { bold: true, size: 8, color: { argb: 'FF000000' } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        textRotation: cell === wdCell ? 90 : 0,
      };
      cell.fill = weekend
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(WEEKEND_HEADER_BG) } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    }
  });
  sheet.getRow(4).height = 16;
  sheet.getRow(5).height = 36;

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 8;
  for (let col = 3; col <= lastCol; col += 1) {
    sheet.getColumn(col).width = 3.4;
  }

  let excelRow = 6;
  for (const row of apaoRows(grid)) {
    const excel = sheet.getRow(excelRow);
    const nameCell = excel.getCell(1);
    nameCell.value = (row.name ?? '').toUpperCase();
    nameCell.font = { bold: true, size: 9, color: { argb: 'FF000000' } };
    nameCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const cifCell = excel.getCell(2);
    cifCell.value = row.cif?.trim() || '';
    cifCell.font = { bold: true, size: 9, color: { argb: 'FF000000' } };
    cifCell.alignment = { vertical: 'middle', horizontal: 'center' };

    for (const cell of [nameCell, cifCell]) {
      cell.border = {
        top: { style: 'dashed', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'dashed', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    }

    days.forEach((day, index) => {
      const mapped = mapApaoRevezamentoCell(row.cells[day - 1]);
      const cell = excel.getCell(index + 3);
      cell.value = mapped.text;
      cell.font = { bold: true, size: 8, color: { argb: toArgb(mapped.fg) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(mapped.bg) } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });

    excel.height = 16;
    excelRow += 1;
  }

  writeExcelLegend(sheet, excelRow + 1, lastCol);
  return workbook;
}

export async function downloadApaoRevezamentoExcel(grid: ScheduleGridData): Promise<void> {
  const workbook = await buildApaoRevezamentoExcelWorkbook(grid);
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const monthLabel = String(grid.month).padStart(2, '0');
  triggerXlsxDownload(buffer, `escala-revezamento-apao_${grid.year}_${monthLabel}.xlsx`);
}

/** PDF no mesmo layout Escala de Revezamento (somente APAOs). */
export async function downloadApaoRevezamentoPdf(grid: ScheduleGridData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 6;
  let cursorY = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...GOL_ORANGE);
  doc.text('GOL', margin, cursorY + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text('Escala de Revezamento', margin + 34, cursorY + 6);
  cursorY += 12;

  // Faixa do mês
  doc.setFillColor(...GOL_ORANGE);
  doc.rect(margin, cursorY, pageW - margin * 2, 7, 'F');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(monthBanner(grid.year, grid.month), margin + 2, cursorY + 5);
  cursorY += 9;

  const headTop = ['NOME', 'CIF', ...grid.dayNumbers.map(String)];
  const headWeek = ['', '', ...grid.weekdayLabels.map((w) => weekdayShort(w))];
  const body: string[][] = [];
  const bodyMeta: ApaoRevezamentoCell[][] = [];

  for (const row of apaoRows(grid)) {
    const mappedDays = grid.dayNumbers.map((day) => mapApaoRevezamentoCell(row.cells[day - 1]));
    body.push([(row.name ?? '').toUpperCase(), row.cif?.trim() || '', ...mappedDays.map((c) => c.text)]);
    bodyMeta.push(mappedDays);
  }

  const nameColW = 40;
  const cifColW = 14;
  const usableW = pageW - margin * 2 - nameColW - cifColW;
  const dayW = usableW / Math.max(grid.dayNumbers.length, 1);

  autoTable(doc, {
    startY: cursorY,
    head: [headTop, headWeek],
    body,
    theme: 'grid',
    tableWidth: pageW - margin * 2,
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    styles: {
      fontSize: 7,
      cellPadding: 0.5,
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      minCellHeight: 4,
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: nameColW, halign: 'left' },
      1: { cellWidth: cifColW, halign: 'center' },
      ...Object.fromEntries(grid.dayNumbers.map((_, i) => [i + 2, { cellWidth: dayW, halign: 'center' }])),
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index >= 2) {
          const weekday = grid.weekdayLabels[data.column.index - 2] ?? '';
          if (isWeekendLabel(weekday)) {
            data.cell.styles.fillColor = WEEKEND_HEADER_BG;
          }
        }
        return;
      }
      if (data.section !== 'body') return;
      if (data.column.index <= 1) {
        data.cell.styles.fillColor = WHITE;
        data.cell.styles.halign = data.column.index === 0 ? 'left' : 'center';
        return;
      }
      const meta = bodyMeta[data.row.index]?.[data.column.index - 2];
      if (!meta) return;
      data.cell.styles.fillColor = meta.bg;
      data.cell.styles.textColor = meta.fg;
    },
    pageBreak: 'auto',
    showHead: 'everyPage',
  });

  const afterTable = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY;
  const legendBody = LEGEND_LEFT.map((left, index) => {
    const right = LEGEND_RIGHT[index];
    const turno = TURNOS[index];
    return [left[0], left[1], right?.[0] ?? '', right?.[1] ?? '', turno?.[0] ?? '', turno?.[1] ?? ''];
  });
  autoTable(doc, {
    startY: afterTable + 3,
    head: [['LEGENDA AEROVIÁRIO', '', '', '', 'TURNOS', 'HORÁRIOS']],
    body: legendBody,
    theme: 'grid',
    tableWidth: pageW - margin * 2,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: 0.8,
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      minCellHeight: 5,
    },
    headStyles: {
      fillColor: GOL_ORANGE,
      textColor: WHITE,
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 48, halign: 'left' },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 48, halign: 'left' },
      4: { cellWidth: 28, halign: 'center' },
      5: { cellWidth: 36, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        data.cell.styles.fillColor = GOL_ORANGE;
        data.cell.styles.textColor = WHITE;
        if (data.column.index >= 4) data.cell.styles.halign = 'center';
        return;
      }
      if (data.column.index !== 0 && data.column.index !== 2) return;
      const code = String(data.cell.raw ?? '');
      const paint = LEGEND_PAINT[code];
      if (!paint) return;
      data.cell.styles.fillColor = paint.bg;
      data.cell.styles.textColor = paint.fg;
      data.cell.styles.halign = 'center';
    },
  });

  const monthLabel = String(grid.month).padStart(2, '0');
  doc.save(`escala-revezamento-apao_${grid.year}_${monthLabel}.pdf`);
}
