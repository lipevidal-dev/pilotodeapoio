import { Injectable } from '@angular/core';
import type { ScheduleExportPayload, ScheduleGridData } from '../models/schedule-grid.models';

/**
 * Preparação para exportação futura (Fase 7+).
 * PDF, PNG e Excel ainda não implementados.
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

  /** Reservado: exportar PDF */
  exportPdf(_payload: ScheduleExportPayload): void {
    // Fase futura
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
