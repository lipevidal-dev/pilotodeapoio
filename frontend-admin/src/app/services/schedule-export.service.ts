import { Injectable } from '@angular/core';
import type { ScheduleExportPayload, ScheduleGridData } from '../models/schedule-grid.models';
import type { SchedulePdfScope } from '../utils/schedule-pdf-scope.util';
import { schedulePdfScopeLabel } from '../utils/schedule-pdf-scope.util';

const PRINT_ROOT_ID = 'escala-print-root';

/**
 * Preparação e exportação da grade operacional.
 * PDF libs (html2canvas/jspdf) só entram no bundle sob demanda.
 */
@Injectable({ providedIn: 'root' })
export class ScheduleExportService {
  prepareExportPayload(grid: ScheduleGridData): ScheduleExportPayload {
    return {
      year: grid.year,
      month: grid.month,
      generatedAt: new Date().toISOString(),
      grid,
      format: null,
    };
  }

  /** Captura a grade visível e baixa PDF A4 (uma página). */
  async exportPdf(
    payload: ScheduleExportPayload,
    options?: { rootId?: string; scope?: SchedulePdfScope },
  ): Promise<boolean> {
    try {
      const { exportScheduleToPdfA4 } = await import('../utils/schedule-export-pdf.util');
      const scopeLabel = options?.scope ? schedulePdfScopeLabel(options.scope) : undefined;
      await exportScheduleToPdfA4({
        year: payload.year,
        month: payload.month,
        rootId: options?.rootId ?? PRINT_ROOT_ID,
        scopeLabel,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Reservado: exportar PNG */
  exportPng(_payload: ScheduleExportPayload): void {
    // Fase futura
  }

  /** Gera uma planilha XLSX com a mesma grade e o mesmo escopo escolhidos no modal. */
  async exportExcel(payload: ScheduleExportPayload, scope?: SchedulePdfScope): Promise<boolean> {
    try {
      const excelModule = await import('exceljs');
      // O bundle browser do ExcelJS expõe a API em `default`, enquanto alguns
      // ambientes de execução também expõem propriedades no namespace.
      const ExcelJS = excelModule.default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'PCoordenador';
      workbook.created = new Date(payload.generatedAt);

      const sheet = workbook.addWorksheet('Escala', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
      });
      const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
        new Date(payload.year, payload.month - 1, 1),
      );
      const lastColumn = 1 + payload.grid.dayNumbers.length;
      sheet.mergeCells(1, 1, 1, lastColumn);
      const title = sheet.getCell(1, 1);
      title.value = `Escala ${monthLabel} / ${payload.year} — ${schedulePdfScopeLabel(scope ?? 'all')}`;
      title.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 };
      title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF15A22' } };
      title.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 24;

      const header = sheet.getRow(2);
      header.values = ['Funcionário', ...payload.grid.dayNumbers.map((day) => String(day).padStart(2, '0'))];
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4B5563' } };
      header.alignment = { horizontal: 'center', vertical: 'middle' };

      for (const group of payload.grid.groups) {
        const groupRow = sheet.addRow([group.label]);
        sheet.mergeCells(groupRow.number, 1, groupRow.number, lastColumn);
        groupRow.font = { bold: true, color: { argb: 'FFF15A22' } };
        groupRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1EB' } };
        for (const employee of group.rows) {
          const row = sheet.addRow([
            employee.name,
            ...employee.cells.map((cell) => cell.display?.trim() || ''),
          ]);
          row.alignment = { horizontal: 'center', vertical: 'middle' };
          row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        }
      }

      sheet.getColumn(1).width = 28;
      for (let column = 2; column <= lastColumn; column += 1) sheet.getColumn(column).width = 6;
      sheet.eachRow((row) => {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          };
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `escala-${payload.year}-${String(payload.month).padStart(2, '0')}-${scope ?? 'all'}.xlsx`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Safari/iOS ainda pode estar consumindo a URL quando o clique retorna.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return true;
    } catch (error) {
      console.error('[ScheduleExportService] Falha ao gerar Excel.', error);
      return false;
    }
  }
}
