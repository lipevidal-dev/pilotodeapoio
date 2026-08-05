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
   * Abre documento A4 paisagem com a grade completa (dias fatiados em páginas)
   * e dispara o diálogo de impressão / "Salvar como PDF".
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
    // Aguarda fontes/layout antes de imprimir.
    win.focus();
    setTimeout(() => {
      try {
        win.print();
      } catch {
        // Usuário ainda pode usar Ctrl+P / Salvar como PDF na janela aberta.
      }
    }, 250);
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
