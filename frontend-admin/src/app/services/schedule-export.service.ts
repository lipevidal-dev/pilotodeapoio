import { Injectable } from '@angular/core';
import type { ScheduleExportPayload, ScheduleGridData } from '../models/schedule-grid.models';
import { buildSchedulePdfHtml } from '../utils/schedule-pdf-html.util';

/**
 * Exportação da escala.
 * PDF é gerado a partir dos dados da grade (não é print/snapshot da tela).
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

  /**
   * Abre 1 folha A4 paisagem com a grade completa e dispara Salvar como PDF.
   */
  exportPdf(payload: ScheduleExportPayload, title?: string): void {
    const html = buildSchedulePdfHtml(payload.grid, title);
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) {
      throw new Error('Popup bloqueado. Permita pop-ups para exportar o PDF.');
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
  }

  /** Reservado: exportar PNG */
  exportPng(_payload: ScheduleExportPayload): void {
    // Fase futura
  }

  /** Reservado: exportar Excel */
  exportExcel(_payload: ScheduleExportPayload): void {
    // Fase futura
  }
}
