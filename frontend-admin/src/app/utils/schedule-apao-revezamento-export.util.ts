import type { Workbook } from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';

/** Layout exigido pela empresa — somente EXPORTAR APAOS. */

type Rgb = [number, number, number];

/** Cores medidas na planilha da empresa (APAO setembro/outubro 2026). */
const BAR_ORANGE: Rgb = [255, 102, 0];
const GOL_ORANGE = BAR_ORANGE;
const FR_BG: Rgb = [255, 0, 0];
const FA_BG: Rgb = [146, 208, 80];
const YELLOW: Rgb = [255, 255, 0];
const FC_BG: Rgb = [255, 192, 0];
const V_BG: Rgb = [247, 150, 70];
const FF_BG: Rgb = [179, 162, 199];
const DM_BG: Rgb = [217, 217, 217];
const L_BG: Rgb = [0, 176, 240];
const FB_BG: Rgb = [0, 112, 192];
const ND_BG: Rgb = [229, 231, 235];
const FP_BG: Rgb = [233, 213, 255];
const RA_BG: Rgb = [255, 230, 153];
const SIM_BG: Rgb = [89, 89, 89];
const WEEKEND_HEADER_BG: Rgb = [255, 124, 128];
const LEGEND_PEACH: Rgb = [252, 213, 180];
const LEGEND_BROWN: Rgb = [151, 71, 6];
const GRAY_BAR: Rgb = [166, 166, 166];
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
  FS: painted('FS', FA_BG),
  K: painted('K', YELLOW),
  FC: painted('FC', FC_BG),
  V: painted('V', V_BG),
  FF: painted('FF', FF_BG),
  DM: painted('DM', DM_BG),
  L: painted('L', L_BG),
  FB: painted('FB', FB_BG, WHITE),
  EP: painted('EP', YELLOW),
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

function paintExcel(
  sheet: import('exceljs').Worksheet,
  row: number,
  col: number,
  value: string | number,
  opts: {
    bg?: Rgb;
    fg?: Rgb;
    bold?: boolean;
    size?: number;
    align?: 'left' | 'center';
    font?: string;
    border?: import('exceljs').Borders;
  } = {},
): void {
  const cell = sheet.getCell(row, col);
  cell.value = value;
  cell.font = {
    bold: opts.bold ?? true,
    size: opts.size ?? 9,
    color: { argb: toArgb(opts.fg ?? BLACK) },
    name: opts.font ?? 'Calibri',
  };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: toArgb(opts.bg ?? WHITE) },
  };
  cell.alignment = { vertical: 'middle', horizontal: opts.align ?? 'center', wrapText: false };
  if (opts.border) cell.border = opts.border;
  else cell.border = THIN_BORDER;
}

/** Legenda no mesmo eixo da grade: A–Q | R–Y turnos | Z–último dia horários. */
function writeExcelLegend(sheet: import('exceljs').Worksheet, startRow: number, lastDayCol: number): void {
  const titleEnd = 17;
  const turnoStart = 18;
  const turnoEnd = 25;
  const horaStart = 26;
  const horaEnd = Math.max(lastDayCol, 33);
  for (let col = lastDayCol + 1; col <= horaEnd; col += 1) {
    sheet.getColumn(col).width = 4;
  }

  const header = startRow;
  sheet.mergeCells(header, 1, header, titleEnd);
  paintExcel(sheet, header, 1, 'LEGENDA AEROVIÁRIO', {
    bg: LEGEND_PEACH,
    fg: LEGEND_BROWN,
    size: 10,
    font: 'Calibri',
  });
  sheet.mergeCells(header, turnoStart, header + 1, turnoEnd);
  paintExcel(sheet, header, turnoStart, 'TURNOS', {
    bg: BAR_ORANGE,
    fg: WHITE,
    size: 12,
    font: 'Arial',
  });
  sheet.mergeCells(header, horaStart, header + 1, horaEnd);
  paintExcel(sheet, header, horaStart, 'HORÁRIOS', {
    bg: BAR_ORANGE,
    fg: WHITE,
    size: 12,
    font: 'Arial',
  });
  sheet.getRow(header).height = 18.95;

  for (let i = 0; i < LEGEND_LEFT.length; i += 1) {
    const row = header + 1 + i;
    const left = LEGEND_LEFT[i]!;
    const right = LEGEND_RIGHT[i];
    const turno = i === 0 ? undefined : TURNOS[i - 1];
    sheet.getRow(row).height = i === LEGEND_LEFT.length - 1 ? 21.75 : 19.5;

    if (left[0] === 'V') {
      sheet.mergeCells(row, 1, row, 3);
      paintExcel(sheet, row, 1, 'V', { bg: V_BG, fg: BLACK, size: 10, bold: false, font: 'Arial' });
      sheet.mergeCells(row, 4, row, 12);
      paintExcel(sheet, row, 4, 'VOO', { bg: WHITE, fg: BLACK, size: 10, font: 'Arial' });
      sheet.mergeCells(row, 13, row, horaEnd);
      paintExcel(sheet, row, 13, '', { bg: GRAY_BAR, fg: BLACK, size: 10, font: 'Arial' });
      continue;
    }

    const leftPaint = LEGEND_PAINT[left[0]]!;
    paintExcel(sheet, row, 1, leftPaint.text, {
      bg: leftPaint.bg,
      fg: leftPaint.fg,
      size: 9,
      font: 'Calibri',
    });
    sheet.mergeCells(row, 2, row, 3);
    paintExcel(sheet, row, 2, left[1], { bg: WHITE, size: 9, font: 'Calibri' });

    sheet.mergeCells(row, 4, row, 12);
    if (right) {
      const rightPaint = LEGEND_PAINT[right[0]]!;
      paintExcel(sheet, row, 4, rightPaint.text, {
        bg: rightPaint.bg,
        fg: rightPaint.fg,
        size: 9,
        font: 'Calibri',
      });
    } else {
      paintExcel(sheet, row, 4, '', { bg: WHITE });
    }
    sheet.mergeCells(row, 13, row, titleEnd);
    paintExcel(sheet, row, 13, right?.[1] ?? '', { bg: WHITE, size: 9, font: 'Calibri' });

    if (!turno) continue;
    sheet.mergeCells(row, turnoStart, row, turnoEnd);
    sheet.mergeCells(row, horaStart, row, horaEnd);
    paintExcel(sheet, row, turnoStart, turno[0], { bg: WHITE, size: 12, font: 'Arial' });
    paintExcel(sheet, row, horaStart, turno[1], { bg: WHITE, size: 12, font: 'Arial' });
  }
}

async function loadGolWordmark(): Promise<string | null> {
  try {
    const res = await fetch('/assets/brand/logo-gol-wordmark.png');
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  } catch {
    return null;
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
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      paperSize: 9,
      scale: 80,
    },
  });

  const days = grid.dayNumbers;
  const lastDayCol = 3 + days.length;

  sheet.getColumn(1).width = 35.14;
  sheet.getColumn(2).width = 14.14;
  sheet.getColumn(3).width = 9.14;
  for (let col = 4; col <= lastDayCol; col += 1) sheet.getColumn(col).width = 4;

  sheet.getRow(1).height = 20.25;
  sheet.getRow(2).height = 28.5;
  sheet.getRow(3).height = 13.5;
  sheet.getRow(4).height = 30.75;

  const logo = await loadGolWordmark();
  if (logo) {
    const imageId = workbook.addImage({ base64: logo, extension: 'png' });
    // Âncora medida no drawing da planilha: ~51px à direita, ~4px abaixo, 143×58 px.
    sheet.addImage(imageId, {
      tl: { col: 0.2, row: 0.12 },
      ext: { width: 143, height: 58 },
      editAs: 'oneCell',
    });
  }

  const title = sheet.getCell(1, 2);
  title.value = 'Escala de Revezamento';
  title.font = { name: 'Arial', bold: true, size: 15, color: { argb: 'FF000000' } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };

  for (let col = 2; col <= lastDayCol; col += 1) {
    const cell = sheet.getCell(2, col);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(BAR_ORANGE) } };
    cell.font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  }
  sheet.getCell(2, 2).value = monthBanner(grid.year, grid.month);

  sheet.mergeCells(3, 1, 4, 2);
  const nomeHeader = sheet.getCell(3, 1);
  nomeHeader.value = 'NOME';
  nomeHeader.font = { name: 'Arial', bold: true, size: 9 };
  nomeHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  nomeHeader.border = THIN_BORDER;

  sheet.mergeCells(3, 3, 4, 3);
  const cifHeader = sheet.getCell(3, 3);
  cifHeader.value = 'CIF';
  cifHeader.font = { name: 'Arial', bold: true, size: 9 };
  cifHeader.alignment = { vertical: 'middle', horizontal: 'center' };
  cifHeader.border = THIN_BORDER;

  days.forEach((day, index) => {
    const col = index + 4;
    const weekday = grid.weekdayLabels[index] ?? '';
    const weekend = isWeekendLabel(weekday);
    const fill = weekend ? WEEKEND_HEADER_BG : WHITE;
    const dayCell = sheet.getCell(3, col);
    const wdCell = sheet.getCell(4, col);
    dayCell.value = day;
    dayCell.font = { name: 'Arial', bold: true, size: 9 };
    dayCell.alignment = { vertical: 'middle', horizontal: 'center' };
    dayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(fill) } };
    dayCell.border = { right: { style: 'thin' }, bottom: { style: 'thin' } };
    wdCell.value = weekdayShort(weekday);
    wdCell.font = { name: 'Arial', bold: true, size: 8 };
    wdCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 };
    wdCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(fill) } };
    wdCell.border = { right: { style: 'thin' }, bottom: { style: 'medium' } };
  });

  let excelRow = 5;
  for (const row of apaoRows(grid)) {
    const excel = sheet.getRow(excelRow);
    excel.height = 19.35;
    sheet.mergeCells(excelRow, 1, excelRow, 2);
    const nameCell = excel.getCell(1);
    nameCell.value = (row.name ?? '').toUpperCase();
    nameCell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF000000' } };
    nameCell.alignment = { vertical: 'middle', horizontal: 'center' };
    nameCell.border = {
      left: { style: 'medium' },
      right: { style: 'dotted' },
      bottom: { style: 'dotted' },
    };

    const cifCell = excel.getCell(3);
    cifCell.value = row.cif?.trim() || '';
    cifCell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF000000' } };
    cifCell.alignment = { vertical: 'middle', horizontal: 'center' };
    cifCell.border = { left: { style: 'dotted' }, bottom: { style: 'dotted' } };

    days.forEach((day, index) => {
      const mapped = mapApaoRevezamentoCell(row.cells[day - 1]);
      const cell = excel.getCell(index + 4);
      cell.value = mapped.text || null;
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: toArgb(mapped.fg) } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(mapped.bg) } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = THIN_BORDER;
    });
    excelRow += 1;
  }

  writeExcelLegend(sheet, excelRow, lastDayCol);
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

  const logo = await loadGolWordmark();
  doc.setFont('helvetica', 'bold');
  if (logo) {
    doc.addImage(`data:image/png;base64,${logo}`, 'PNG', margin, cursorY, 28, 11);
    doc.setFontSize(16);
    doc.setTextColor(17, 24, 39);
    doc.text('Escala de Revezamento', margin + 32, cursorY + 8);
    cursorY += 14;
  } else {
    doc.setFontSize(18);
    doc.setTextColor(...GOL_ORANGE);
    doc.text('GOL', margin, cursorY + 6);
    doc.setFontSize(16);
    doc.setTextColor(17, 24, 39);
    doc.text('Escala de Revezamento', margin + 34, cursorY + 6);
    cursorY += 12;
  }

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
    const turno = index === 0 ? undefined : TURNOS[index - 1];
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
        if (data.column.index >= 4) {
          data.cell.styles.fillColor = GOL_ORANGE;
          data.cell.styles.textColor = WHITE;
          data.cell.styles.halign = 'center';
        } else {
          data.cell.styles.fillColor = LEGEND_PEACH;
          data.cell.styles.textColor = LEGEND_BROWN;
        }
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
