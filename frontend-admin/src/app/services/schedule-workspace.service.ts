import { Injectable, signal } from '@angular/core';
import type { GenerateScheduleResponse } from '../models/api.models';

/** Estado compartilhado da última geração (navegação entre seções da tela Escala). */
@Injectable({ providedIn: 'root' })
export class ScheduleWorkspaceService {
  readonly lastGeneration = signal<GenerateScheduleResponse | null>(null);
  readonly scheduleMonthId = signal<string | null>(null);
  readonly year = signal(new Date().getFullYear());
  readonly month = signal(new Date().getMonth() + 1);

  setGeneration(result: GenerateScheduleResponse, year: number, month: number): void {
    this.lastGeneration.set(result);
    this.scheduleMonthId.set(result.scheduleMonthId);
    this.year.set(year);
    this.month.set(month);
  }

  clear(): void {
    this.lastGeneration.set(null);
    this.scheduleMonthId.set(null);
  }
}
