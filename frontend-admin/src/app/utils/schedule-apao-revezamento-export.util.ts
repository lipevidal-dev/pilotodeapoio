import type { Workbook } from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ScheduleCellData, ScheduleGridData } from '../models/schedule-grid.models';

/** Layout exigido pela empresa — somente EXPORTAR APAOS. */

type Rgb = [number, number, number];

const GOL_ORANGE: Rgb = [241, 90, 34];
const FR_BG: Rgb = [255, 0, 0];
const FA_BG: Rgb = [198, 224, 180];
const WEEKEND_HEADER_BG: Rgb = [255, 199, 206];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

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

/** Converte célula interna (T4, F, FA…) para o código do layout GOL. */
export function mapApaoRevezamentoCell(cell: ScheduleCellData | undefined | null): ApaoRevezamentoCell {
  const display = (cell?.display ?? '').trim().toUpperCase();
  const kind = cell?.kind ?? 'empty';

  if (!display || kind === 'empty') {
    return { text: '', bg: WHITE, fg: BLACK };
  }

  const shiftMatch = /^T([1-4])$/.exec(display);
  if (shiftMatch) {
    return { text: shiftMatch[1]!, bg: WHITE, fg: BLACK };
  }

  if (
    kind === 'folga' ||
    kind === 'folga-weekend' ||
    display === 'F' ||
    display === 'FR' ||
    display === 'FOLGA'
  ) {
    return { text: 'FR', bg: FR_BG, fg: BLACK };
  }

  if (kind === 'fa' || display === 'FA') {
    return { text: 'FA', bg: FA_BG, fg: BLACK };
  }

  if (kind === 'fs' || display === 'FS') {
    return { text: 'FS', bg: FA_BG, fg: BLACK };
  }

  // Demais códigos operacionais: mantém texto, fundo branco (layout da empresa).
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

async function loadGolLogoBuffer(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('assets/brand/logo-gol-export.png');
    if (!res.ok) return null;
    return await res.arrayBuffer();
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

  const logoBuffer = await loadGolLogoBuffer();
  if (logoBuffer) {
    const imageId = workbook.addImage({
      buffer: new Uint8Array(logoBuffer),
      extension: 'png',
    });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 120, height: 32 },
      editAs: 'oneCell',
    });
  } else {
    sheet.mergeCells(1, 1, 2, 2);
    const logoCell = sheet.getCell(1, 1);
    logoCell.value = 'GOL';
    logoCell.font = { bold: true, size: 18, color: { argb: toArgb(GOL_ORANGE) } };
    logoCell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

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

  const logoBuffer = await loadGolLogoBuffer();
  if (logoBuffer) {
    const bytes = new Uint8Array(logoBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
    const dataUrl = `data:image/png;base64,${btoa(binary)}`;
    doc.addImage(dataUrl, 'PNG', margin, cursorY, 28, 8);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...GOL_ORANGE);
    doc.text('GOL', margin, cursorY + 6);
  }

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

  const monthLabel = String(grid.month).padStart(2, '0');
  doc.save(`escala-revezamento-apao_${grid.year}_${monthLabel}.pdf`);
}
