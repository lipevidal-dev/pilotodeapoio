import { Injectable } from '@angular/core';
import type { ScheduleExportPayload, ScheduleGridData } from '../models/schedule-grid.models';
import { downloadSchedulePdf } from '../utils/schedule-pdf-download.util';

/**
 * Exportação da escala.
 * PDF = arquivo baixável (jsPDF), não print/snapshot da tela.
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

  /** Baixa um PDF A4 paisagem (1 página) — funciona no desktop e no mobile. */
  exportPdf(payload: ScheduleExportPayload, title?: string): void {
    downloadSchedulePdf(payload.grid, title);
  }

  exportPng(_payload: ScheduleExportPayload): void {
    // Fase futura
  }

  exportExcel(_payload: ScheduleExportPayload): void {
    // Fase futura
  }
}
