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
      const { downloadScheduleExcel } = await import('../utils/schedule-excel-download.util');
      const monthLabel = String(payload.month).padStart(2, '0');
      const title = `Escala ${monthLabel}/${payload.year} — ${schedulePdfScopeLabel(scope ?? 'all')}`;
      await downloadScheduleExcel(payload.grid, title, payload.generatedAt);
      return true;
    } catch (error) {
      console.error('[ScheduleExportService] Falha ao gerar Excel.', error);
      return false;
    }
  }
}
