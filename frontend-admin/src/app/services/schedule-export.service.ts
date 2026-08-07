import { Injectable } from '@angular/core';
import type { EmployeeType } from '../models/api.models';
import type { ScheduleExportPayload, ScheduleGridData } from '../models/schedule-grid.models';
import { applyGridFilters } from '../utils/schedule-grid.filter';
import { downloadSchedulePdf } from '../utils/schedule-pdf-download.util';
import { downloadScheduleExcel } from '../utils/schedule-excel-download.util';

export type ScheduleExportScope = 'ALL' | 'PAO' | 'APAO';

export const SCHEDULE_EXPORT_SCOPE_OPTIONS: Array<{
  value: ScheduleExportScope;
  label: string;
  description: string;
}> = [
  { value: 'ALL', label: 'Completa', description: 'Todo mundo (PAO + APAO)' },
  { value: 'PAO', label: 'PAO', description: 'Somente PAOs' },
  { value: 'APAO', label: 'APAO', description: 'Somente APAOs' },
];

/**
 * Exportação da escala em PDF/Excel.
 * Sempre a partir dos dados da grade (não é snapshot da tela).
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

  scopeGrid(grid: ScheduleGridData, scope: ScheduleExportScope): ScheduleGridData {
    if (scope === 'ALL') return grid;
    return applyGridFilters(grid, {
      type: scope as EmployeeType,
      employeeId: null,
      singleEmployeeOnly: false,
    });
  }

  scopeTitle(grid: ScheduleGridData, scope: ScheduleExportScope): string {
    const month = String(grid.month).padStart(2, '0');
    const base = `Escala ${month}/${grid.year}`;
    if (scope === 'PAO') return `${base} — PAO`;
    if (scope === 'APAO') return `${base} — APAO`;
    return `${base} — Completa`;
  }

  exportPdf(payload: ScheduleExportPayload, title?: string): void {
    downloadSchedulePdf(payload.grid, title);
  }

  async exportExcel(payload: ScheduleExportPayload, title?: string): Promise<void> {
    await downloadScheduleExcel(payload.grid, title);
  }
}
