import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { concatMap, from, toArray } from 'rxjs';
import { PortalService } from '../../services/portal.service';
import {
  ScheduleGridComponent,
  type GridCellClickEvent,
  type GridSelectionComplete,
} from '../../components/schedule-grid/schedule-grid.component';
import { ScheduleLegendComponent } from '../../components/schedule-legend/schedule-legend.component';
import { ScheduleCellComponent } from '../../components/schedule-cell/schedule-cell.component';
import {
  PortalRequestDialogComponent,
  type PortalRequestDialogContext,
} from '../../components/portal-request-dialog/portal-request-dialog.component';
import {
  ShiftSwapDialogComponent,
  type ShiftSwapDialogContext,
} from '../../components/shift-swap-dialog/shift-swap-dialog.component';
import { SchedulePdfDialogComponent } from '../../components/schedule-pdf-dialog/schedule-pdf-dialog.component';
import { buildScheduleGrid } from '../../utils/schedule-cell.mapper';
import {
  filterGridByPdfScope,
  type SchedulePdfScope,
} from '../../utils/schedule-pdf-scope.util';
import { computeGridAuditTotals } from '../../utils/operational-audit.util';
import { ScheduleExportService } from '../../services/schedule-export.service';
import { ShiftSwapService } from '../../services/shift-swap.service';
import {
  portalPendingRequestLabel,
  portalPendingTypeFromCell,
} from '../../utils/portal-request.util';
import {
  portalFpLimitMessage,
  wouldExceedPortalFpLimit,
} from '../../utils/portal-fp-limit.util';
import { isSelectableCell } from '../../utils/schedule-grid-cell.util';
import { ViewportService } from '../../core/viewport.service';
import type { EmployeeType, PortalRequestType, PortalScheduleResponse } from '../../models/api.models';
import type { EmployeeRowData, ScheduleCellData, ScheduleGridData } from '../../models/schedule-grid.models';

export interface MobileCalendarDay {
  day: number | null;
  cell: ScheduleCellData | null;
}

export interface MobileCalendarWeek {
  days: MobileCalendarDay[];
}

export type PortalScheduleViewMode = 'planned' | 'executed';

@Component({
  selector: 'app-portal-schedule',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    MessageModule,
    ToastModule,
    ScheduleGridComponent,
    ScheduleLegendComponent,
    ScheduleCellComponent,
    PortalRequestDialogComponent,
    ShiftSwapDialogComponent,
    SchedulePdfDialogComponent,
  ],
  providers: [MessageService],
  templateUrl: './portal-schedule.component.html',
  styleUrl: './portal-schedule.component.scss',
})
export class PortalScheduleComponent implements OnInit {
  @ViewChild(ScheduleGridComponent) scheduleGrid?: ScheduleGridComponent;

  private readonly portalService = inject(PortalService);
  private readonly shiftSwapService = inject(ShiftSwapService);
  private readonly messages = inject(MessageService);
  private readonly viewport = inject(ViewportService);
  private readonly exportService = inject(ScheduleExportService);

  readonly isMobile = this.viewport.isMobile;
  readonly isSelectableCell = isSelectableCell;
  readonly yearSig = signal(new Date().getFullYear());
  readonly monthSig = signal(new Date().getMonth() + 1);
  readonly loadingView = signal(false);
  readonly exportingPdf = signal(false);
  readonly pdfDialogVisible = signal(false);
  /** Filtro temporário aplicado na grade só durante a captura do PDF. */
  readonly pdfExportScope = signal<SchedulePdfScope | null>(null);
  readonly submittingRequest = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly scheduleData = signal<PortalScheduleResponse | null>(null);
  readonly executedScheduleData = signal<PortalScheduleResponse | null>(null);
  readonly scheduleView = signal<PortalScheduleViewMode>('planned');
  readonly employeeId = signal<string | null>(null);

  readonly isExecutedView = computed(() => this.scheduleView() === 'executed');

  readonly activeScheduleData = computed(() =>
    this.isExecutedView() ? this.executedScheduleData() : this.scheduleData(),
  );

  readonly pageEyebrow = computed(() =>
    this.isExecutedView() ? 'Minha Escala Realizada' : 'Minha Escala Planejada',
  );

  readonly employeeType = computed((): EmployeeType => {
    const empId = this.employeeId();
    const data = this.activeScheduleData() ?? this.scheduleData();
    if (!empId || !data) return 'PAO';
    const employee = data.employees.find((e) => e.id === empId);
    const cargo = String(employee?.cargoCode ?? employee?.type ?? 'PAO').toUpperCase();
    return cargo.includes('APAO') ? 'APAO' : (employee?.type ?? 'PAO');
  });

  readonly isApao = computed(() => String(this.employeeType()).toUpperCase().includes('APAO'));

  /** Permite clicar na própria célula na Realizada (1º passo da troca). */
  readonly allowSelfSwap = computed(() => this.isExecutedView());

  readonly requestDialogVisible = signal(false);
  readonly requestDialogContext = signal<PortalRequestDialogContext | null>(null);
  readonly swapDialogVisible = signal(false);
  readonly swapDialogContext = signal<ShiftSwapDialogContext | null>(null);
  readonly submittingSwap = signal(false);
  readonly mobileSelectedDays = signal<Set<number>>(new Set());
  /**
   * Seleção multi-dia da troca:
   * - ownDays: dias da própria escala
   * - peer: dias do colega (mesma quantidade)
   * - selfDestDays: destino na própria escala (APAO)
   */
  readonly swapPick = signal<{
    ownDays: number[];
    peer: { employeeId: string; employeeName: string; days: number[] } | null;
    selfDestDays: number[];
  }>({ ownDays: [], peer: null, selfDestDays: [] });

  private clearSwapPick(): void {
    this.swapPick.set({ ownDays: [], peer: null, selfDestDays: [] });
  }
  /** false = calendário pessoal; true = grade de toda a equipe */
  readonly mobileTeamView = signal(false);
  /** Período em que a aba Realizada já foi aplicada como padrão (ano-mês). */
  private executedDefaultPeriodKey: string | null = null;

  readonly isPublished = computed(() => this.scheduleData()?.isPublished ?? false);

  readonly periodLabel = computed(() => {
    const y = this.yearSig();
    const m = this.monthSig();
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
    return `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} / ${y}`;
  });

  readonly displayGrid = computed((): ScheduleGridData | null => {
    const data = this.activeScheduleData();
    if (!data) return null;
    const empId = this.employeeId();
    // Portal: só efeito visual das trocas em que o colaborador participa.
    const mySwaps =
      this.isExecutedView() && empId
        ? (data.shiftSwaps ?? []).filter(
            (s) => s.requesterEmployeeId === empId || s.targetEmployeeId === empId,
          )
        : undefined;
    let grid = buildScheduleGrid({
      year: this.yearSig(),
      month: this.monthSig(),
      employees: data.employees,
      assignments: data.assignments,
      preAllocations: data.preAllocations,
      operationalCadastros: data.operationalCadastros,
      shifts: data.shifts,
      // Troca de turno só aparece/age na escala realizada.
      shiftSwaps: mySwaps,
    });
    const scope = this.pdfExportScope();
    if (scope) {
      grid = filterGridByPdfScope(grid, scope, this.employeeId());
    }
    return this.applySwapSourceHighlight(grid);
  });

  readonly employeeRow = computed((): EmployeeRowData | null => {
    const grid = this.displayGrid();
    const empId = this.employeeId();
    if (!grid || !empId) return null;
    for (const group of grid.groups) {
      const row = group.rows.find((r) => r.employeeId === empId);
      if (row) return row;
    }
    return null;
  });

  readonly mobileCalendarWeeks = computed((): MobileCalendarWeek[] => {
    const grid = this.displayGrid();
    const row = this.employeeRow();
    if (!grid || !row) return [];

    const weeks: MobileCalendarWeek[] = [];
    let current: MobileCalendarDay[] = [];

    const firstDate = new Date(grid.year, grid.month - 1, 1);
    const startPad = (firstDate.getDay() + 6) % 7;
    for (let i = 0; i < startPad; i++) {
      current.push({ day: null, cell: null });
    }

    for (let i = 0; i < grid.dayNumbers.length; i++) {
      current.push({
        day: grid.dayNumbers[i]!,
        cell: row.cells[i] ?? null,
      });
      if (current.length === 7) {
        weeks.push({ days: current });
        current = [];
      }
    }

    if (current.length > 0) {
      while (current.length < 7) {
        current.push({ day: null, cell: null });
      }
      weeks.push({ days: current });
    }

    return weeks;
  });

  readonly mobileSelectedCount = computed(() => this.mobileSelectedDays().size);

  readonly gridAuditTotals = computed(() => {
    if (this.isExecutedView()) return null;
    const grid = this.displayGrid();
    const data = this.scheduleData();
    if (!grid) return null;
    return computeGridAuditTotals(grid, data?.assignments ?? [], data?.employees ?? []);
  });

  ngOnInit(): void {
    this.portalService.getProfile().subscribe({
      next: (profile) => this.employeeId.set(profile.employeeId),
      error: () => this.loadError.set('Não foi possível identificar seu cadastro de funcionário.'),
    });
    this.loadSchedule();
  }

  loadSchedule(): void {
    this.loadingView.set(true);
    this.loadError.set(null);
    this.portalService.getSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (data) => {
        this.scheduleData.set(data);
        const periodKey = `${this.yearSig()}-${this.monthSig()}`;

        if (!data.isPublished) {
          this.executedDefaultPeriodKey = null;
          if (this.isExecutedView()) {
            this.scheduleView.set('planned');
            this.executedScheduleData.set(null);
          }
        } else if (this.executedDefaultPeriodKey !== periodKey) {
          // Abre em Realizada na primeira carga do mês publicado.
          this.executedDefaultPeriodKey = periodKey;
          this.scheduleView.set('executed');
        }

        if (this.isExecutedView() && data.isPublished) {
          this.loadExecutedSchedule(false);
          return;
        }
        this.loadingView.set(false);
      },
      error: (err: { error?: { error?: string } }) => {
        this.loadingView.set(false);
        this.scheduleData.set(null);
        this.loadError.set(err.error?.error ?? 'Não foi possível carregar a escala deste mês.');
      },
    });
  }

  loadExecutedSchedule(showLoading = true): void {
    if (showLoading) this.loadingView.set(true);
    this.loadError.set(null);
    this.portalService.getExecutedSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (data) => {
        this.loadingView.set(false);
        this.executedScheduleData.set(data);
      },
      error: (err: { error?: { error?: string } }) => {
        this.loadingView.set(false);
        this.loadError.set(err.error?.error ?? 'Não foi possível carregar a escala realizada.');
      },
    });
  }

  setScheduleView(mode: PortalScheduleViewMode): void {
    if (this.scheduleView() === mode) return;
    if (mode === 'executed' && !this.isPublished()) {
      return;
    }
    this.scheduleView.set(mode);
    this.clearMobileSelection();
    this.mobileTeamView.set(false);
    if (mode === 'executed') {
      this.loadExecutedSchedule();
    }
  }

  prevMonth(): void {
    const m = this.monthSig();
    const y = this.yearSig();
    if (m === 1) {
      this.monthSig.set(12);
      this.yearSig.set(y - 1);
    } else {
      this.monthSig.set(m - 1);
    }
    this.clearMobileSelection();
    this.loadSchedule();
  }

  nextMonth(): void {
    const m = this.monthSig();
    const y = this.yearSig();
    if (m === 12) {
      this.monthSig.set(1);
      this.yearSig.set(y + 1);
    } else {
      this.monthSig.set(m + 1);
    }
    this.clearMobileSelection();
    this.loadSchedule();
  }

  goToday(): void {
    const now = new Date();
    this.yearSig.set(now.getFullYear());
    this.monthSig.set(now.getMonth() + 1);
    this.clearMobileSelection();
    this.loadSchedule();
  }

  async savePdf(): Promise<void> {
    const grid = this.displayGrid();
    if (!grid) {
      this.messages.add({
        severity: 'warn',
        summary: 'Exportar PDF',
        detail: 'Carregue a escala antes de salvar.',
      });
      return;
    }
    if (this.exportingPdf()) return;
    this.pdfDialogVisible.set(true);
  }

  onPdfDialogVisibleChange(visible: boolean): void {
    this.pdfDialogVisible.set(visible);
  }

  async confirmPdfExport(scope: SchedulePdfScope): Promise<void> {
    if (this.exportingPdf()) return;
    if (scope === 'mine' && !this.employeeId()) {
      this.messages.add({
        severity: 'warn',
        summary: 'Exportar PDF',
        detail: 'Usuário sem colaborador vinculado.',
      });
      return;
    }

    this.exportingPdf.set(true);
    this.pdfExportScope.set(scope);
    // Aguarda a grade filtrada renderizar antes da captura.
    await new Promise((r) => setTimeout(r, 200));

    const grid = this.displayGrid();
    if (!grid || grid.groups.every((g) => g.rows.length === 0)) {
      this.pdfExportScope.set(null);
      this.exportingPdf.set(false);
      this.pdfDialogVisible.set(false);
      this.messages.add({
        severity: 'warn',
        summary: 'Exportar PDF',
        detail: 'Nenhum colaborador encontrado para o filtro selecionado.',
      });
      return;
    }

    const payload = this.exportService.prepareExportPayload(grid);
    const ok = await this.exportService.exportPdf(payload, { scope });
    this.pdfExportScope.set(null);
    this.exportingPdf.set(false);
    this.pdfDialogVisible.set(false);

    if (!ok) {
      this.messages.add({
        severity: 'error',
        summary: 'Exportar PDF',
        detail: 'Não foi possível gerar o PDF.',
      });
    }
  }

  async confirmExcelExport(scope: SchedulePdfScope): Promise<void> {
    if (this.exportingPdf()) return;
    if (scope === 'mine' && !this.employeeId()) {
      this.messages.add({ severity: 'warn', summary: 'Exportar Excel', detail: 'Usuário sem colaborador vinculado.' });
      return;
    }
    this.exportingPdf.set(true);
    this.pdfExportScope.set(scope);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const grid = this.displayGrid();
    const ok = grid && grid.groups.some((group) => group.rows.length > 0)
      ? await this.exportService.exportExcel(this.exportService.prepareExportPayload(grid), scope)
      : false;
    this.pdfExportScope.set(null);
    this.exportingPdf.set(false);
    this.pdfDialogVisible.set(false);
    if (!ok) this.messages.add({ severity: 'error', summary: 'Exportar Excel', detail: 'Não foi possível gerar o Excel.' });
  }

  toggleMobileTeamView(): void {
    const next = !this.mobileTeamView();
    this.mobileTeamView.set(next);
    this.clearMobileSelection();
  }

  clearMobileSelection(): void {
    this.mobileSelectedDays.set(new Set());
  }

  isMobileDaySelected(day: number): boolean {
    return this.mobileSelectedDays().has(day);
  }

  isMobileDayTappable(cell: ScheduleCellData | null): boolean {
    if (this.isExecutedView()) {
      // 1º passo: selecionar dia da própria escala (PAO e APAO).
      return !!cell && this.isSwapOfferable(cell);
    }
    if (!cell) return false;
    return isSelectableCell(cell) || !!portalPendingTypeFromCell(cell);
  }

  onMobileDayTap(day: number, cell: ScheduleCellData | null): void {
    if (this.isExecutedView()) {
      const ownId = this.employeeId();
      const row = this.employeeRow();
      if (!cell || !ownId || !row) return;
      this.handleSwapCellClick({
        employeeId: ownId,
        employeeName: row.name,
        day,
        cell,
      });
      return;
    }
    if (!cell) return;

    const row = this.employeeRow();
    if (!row) return;

    const pendingType = portalPendingTypeFromCell(cell);
    if (pendingType) {
      this.openPendingRequest(day, row.name, pendingType, cell.requestId);
      return;
    }

    if (!isSelectableCell(cell)) return;

    const next = new Set(this.mobileSelectedDays());
    if (next.has(day)) next.delete(day);
    else next.add(day);
    this.mobileSelectedDays.set(next);
  }

  openMobileMultiRequest(): void {
    const row = this.employeeRow();
    const days = [...this.mobileSelectedDays()].sort((a, b) => a - b);
    if (!row || days.length === 0) return;
    this.openRequestForDays(days, row.name);
    this.clearMobileSelection();
  }

  onCellClicked(event: GridCellClickEvent): void {
    // Troca de turno só na escala realizada.
    if (this.isExecutedView()) {
      if (event.cell.shiftSwap) {
        this.clearSwapPick();
        this.openSwapFromCell(event);
        return;
      }
      if (!this.employeeId() || !this.isSwapOfferable(event.cell)) return;
      this.handleSwapCellClick(event);
      return;
    }

    // Escala planejada: solicitações de folga/voo/etc. (sem troca).
    const pendingType = portalPendingTypeFromCell(event.cell);
    if (!pendingType) return;
    this.openPendingRequest(event.day, event.employeeName, pendingType, event.cell.requestId);
  }

  /**
   * Multi-seleção com contagem igual nos dois lados.
   * FA = bloco de 2: se ainda não há 2 dias no outro lado, avisa.
   */
  private handleSwapCellClick(event: GridCellClickEvent): void {
    const ownId = this.employeeId();
    if (!ownId) return;
    const isOwn = event.employeeId === ownId;
    const pick = this.swapPick();
    const row = this.rowForEmployee(event.employeeId);
    if (!row) return;

    const faDays = this.resolveFaBlockDays(row, event.day, event.cell);
    const isFa = faDays.length === 2;

    // ——— Própria escala ———
    if (isOwn) {
      const pickNow = this.swapPick();
      const inOwn = pickNow.ownDays.includes(event.day);
      const faFullyInOwn = isFa && faDays.every((d) => pickNow.ownDays.includes(d));

      if (pickNow.selfDestDays.length > 0) {
        this.handleSelfDestClick(event, row, faDays, isFa);
        return;
      }

      // APAO realocação: com FA (bloco de 2) na origem, clique fora inicia o destino.
      if (
        this.isApao() &&
        this.ownSelectionIsFaBlock(pickNow.ownDays) &&
        !inOwn &&
        !faFullyInOwn
      ) {
        this.handleSelfDestClick(event, row, faDays, isFa);
        return;
      }

      this.toggleOwnDay(event.day, event.cell, row);
      return;
    }

    // ——— Colega ———
    if (pick.ownDays.length < 1) {
      this.messages.add({
        severity: 'warn',
        summary: 'Selecione primeiro os seus dias',
        detail: 'Clique nos dias da sua escala e, em seguida, nos dias do colega (mesma quantidade).',
        life: 6000,
      });
      return;
    }

    this.handlePeerClick(event, row, faDays, isFa);
  }

  /** Só é bloco FA se os 2 dias consecutivos forem explicitamente FA (não F comum). */
  private ownSelectionIsFaBlock(days: number[]): boolean {
    if (days.length !== 2) return false;
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted[1] !== sorted[0]! + 1) return false;
    const row = this.employeeRow() ?? this.rowForEmployee(this.employeeId() ?? '');
    if (!row) return false;
    const a = row.cells[sorted[0]! - 1];
    const b = row.cells[sorted[1]! - 1];
    return this.isFaCell(a) && this.isFaCell(b);
  }

  /** APAO multi-seleciona origem (FA = 2 de uma vez); destino começa ao clicar fora da origem. */
  private toggleOwnDay(day: number, cell: ScheduleCellData, row: EmployeeRowData): void {
    const pick = this.swapPick();
    const faDays = this.resolveFaBlockDays(row, day, cell);
    const isFa = faDays.length === 2;
    let ownDays = [...pick.ownDays];

    if (isFa) {
      const allSelected = faDays.every((d) => ownDays.includes(d));
      if (allSelected) {
        ownDays = ownDays.filter((d) => !faDays.includes(d));
        this.messages.add({
          severity: 'info',
          summary: 'Folga agrupada removida',
          detail: 'Seleção da FA cancelada.',
        });
      } else {
        for (const d of faDays) {
          if (!ownDays.includes(d)) ownDays.push(d);
        }
        ownDays.sort((a, b) => a - b);
        this.messages.add({
          severity: 'info',
          summary: 'Folga agrupada selecionada',
          detail: `Dias ${faDays[0]}–${faDays[1]} (bloco de 2). Selecione 2 dias do colega (ou 2 na sua escala, APAO).`,
          life: 7000,
        });
      }
    } else if (ownDays.includes(day)) {
      ownDays = ownDays.filter((d) => d !== day);
    } else {
      ownDays.push(day);
      ownDays.sort((a, b) => a - b);
      this.messages.add({
        severity: 'info',
        summary: `${ownDays.length} dia(s) selecionado(s)`,
        detail: `Selecione ${ownDays.length} dia(s) do colega para trocar${
          this.isApao() ? ', ou outros dias seus para realocar' : ''
        }.`,
        life: 6000,
      });
    }

    this.swapPick.set({ ownDays, peer: null, selfDestDays: [] });
  }

  private handleSelfDestClick(
    event: GridCellClickEvent,
    row: EmployeeRowData,
    faDays: number[],
    isFa: boolean,
  ): void {
    const pick = this.swapPick();
    const needed = pick.ownDays.length;
    let dest = [...pick.selfDestDays];

    if (isFa) {
      if (needed < 2) {
        this.messages.add({
          severity: 'warn',
          summary: 'Folga agrupada precisa de 2 dias',
          detail: `Selecione mais ${2 - needed} dia(s) na origem antes de trocar com a FA.`,
          life: 7000,
        });
        return;
      }
      if (needed - dest.length < 2) {
        this.messages.add({
          severity: 'warn',
          summary: 'Folga agrupada precisa de 2 dias',
          detail: `Ainda faltam ${needed - dest.length} dia(s) no destino; a FA ocupa 2.`,
          life: 7000,
        });
        return;
      }
      if (faDays.some((d) => pick.ownDays.includes(d))) {
        this.messages.add({
          severity: 'warn',
          summary: 'Destino inválido',
          detail: 'O destino não pode sobrepor a origem.',
        });
        return;
      }
      for (const d of faDays) {
        if (!dest.includes(d)) dest.push(d);
      }
    } else {
      if (pick.ownDays.includes(event.day)) {
        this.messages.add({
          severity: 'warn',
          summary: 'Destino inválido',
          detail: 'Escolha dias diferentes dos já selecionados na origem.',
        });
        return;
      }
      if (dest.includes(event.day)) {
        dest = dest.filter((d) => d !== event.day);
      } else if (dest.length >= needed) {
        this.messages.add({
          severity: 'warn',
          summary: 'Quantidade completa',
          detail: `Já há ${needed} dia(s) de destino. Remova um para alterar.`,
        });
        return;
      } else {
        dest.push(event.day);
      }
    }

    dest.sort((a, b) => a - b);
    this.swapPick.set({ ...pick, peer: null, selfDestDays: dest });

    if (dest.length === needed) {
      this.openMultiSelfDialog(pick.ownDays, dest);
    } else {
      this.messages.add({
        severity: 'info',
        summary: `Destino ${dest.length}/${needed}`,
        detail: `Selecione mais ${needed - dest.length} dia(s) na sua escala.`,
        life: 5000,
      });
    }
  }

  private handlePeerClick(
    event: GridCellClickEvent,
    row: EmployeeRowData,
    faDays: number[],
    isFa: boolean,
  ): void {
    const pick = this.swapPick();
    const needed = pick.ownDays.length;
    let peer = pick.peer;
    if (!peer || peer.employeeId !== event.employeeId) {
      peer = { employeeId: event.employeeId, employeeName: event.employeeName, days: [] };
    }
    let days = [...peer.days];

    if (isFa) {
      if (needed < 2) {
        this.messages.add({
          severity: 'warn',
          summary: 'Folga agrupada precisa de 2 dias',
          detail: `Selecione mais ${2 - needed} dia(s) na sua escala antes de trocar com a FA.`,
          life: 7000,
        });
        return;
      }
      const remaining = needed - days.length;
      if (remaining < 2) {
        this.messages.add({
          severity: 'warn',
          summary: 'Folga agrupada precisa de 2 dias',
          detail:
            remaining <= 0
              ? 'A quantidade de destino já está completa.'
              : `Falta ${remaining} dia no destino; a FA ocupa 2. Remova um dia ou selecione mais um na origem.`,
          life: 7000,
        });
        return;
      }
      const allSelected = faDays.every((d) => days.includes(d));
      if (allSelected) {
        days = days.filter((d) => !faDays.includes(d));
      } else {
        for (const d of faDays) {
          if (!days.includes(d)) days.push(d);
        }
      }
    } else if (days.includes(event.day)) {
      days = days.filter((d) => d !== event.day);
    } else if (days.length >= needed) {
      this.messages.add({
        severity: 'warn',
        summary: 'Quantidade completa',
        detail: `Selecione exatamente ${needed} dia(s) do colega (já completos).`,
      });
      return;
    } else {
      days.push(event.day);
    }

    days.sort((a, b) => a - b);
    this.swapPick.set({
      ownDays: pick.ownDays,
      peer: { ...peer, days },
      selfDestDays: [],
    });

    if (days.length === needed) {
      this.openMultiPeerDialog(pick.ownDays, {
        employeeId: peer.employeeId,
        employeeName: peer.employeeName,
        days,
      });
    } else {
      this.messages.add({
        severity: 'info',
        summary: `Colega ${days.length}/${needed}`,
        detail: `Selecione mais ${needed - days.length} dia(s) de ${event.employeeName}.`,
        life: 5000,
      });
    }
  }

  private rowForEmployee(employeeId: string): EmployeeRowData | null {
    const grid = this.displayGrid();
    if (!grid) return null;
    for (const group of grid.groups) {
      const row = group.rows.find((r) => r.employeeId === employeeId);
      if (row) return row;
    }
    return null;
  }

  private labelsForDays(employeeId: string | null, days: number[]): string {
    if (!employeeId) return days.join(',');
    const row = this.rowForEmployee(employeeId);
    return days
      .map((d) => {
        const cell = row?.cells[d - 1];
        const disp = (cell?.display ?? '').trim();
        if (disp) return disp;
        if (cell?.folgaBaseKind === 'fa') return 'FA';
        if (cell?.kind === 'fa') return 'FA';
        if (cell?.kind && cell.kind !== 'empty') {
          return cell.kind.replace(/-/g, ' ').toUpperCase();
        }
        return '—';
      })
      .join('+');
  }

  private openMultiPeerDialog(
    ownDays: number[],
    peer: { employeeId: string; employeeName: string; days: number[] },
  ): void {
    const ownId = this.employeeId();
    const ownName =
      this.employeeRow()?.name ||
      this.rowForEmployee(ownId ?? '')?.name ||
      'Você';
    this.swapDialogContext.set({
      mode: 'offer',
      day: ownDays[0]!,
      dateIso: this.dateIsoForDay(ownDays[0]!),
      kind: 'PEER',
      targetEmployeeId: peer.employeeId,
      targetName: peer.employeeName,
      targetShiftCode: this.labelsForDays(peer.employeeId, peer.days),
      requesterName: ownName,
      requesterShiftCode: this.labelsForDays(ownId, ownDays),
      ownShiftCode: this.labelsForDays(ownId, ownDays),
      sourceDate: this.dateIsoForDay(ownDays[0]!),
      targetDate: this.dateIsoForDay(peer.days[0]!),
      pairLength: ownDays.length,
      sourceDates: ownDays.map((d) => this.dateIsoForDay(d)),
      targetDates: peer.days.map((d) => this.dateIsoForDay(d)),
      sourceLabel: this.labelsForDays(ownId, ownDays),
      targetLabel: this.labelsForDays(peer.employeeId, peer.days),
    });
    this.swapDialogVisible.set(true);
  }

  private openMultiSelfDialog(ownDays: number[], destDays: number[]): void {
    const ownId = this.employeeId();
    this.swapDialogContext.set({
      mode: 'offer_self',
      day: ownDays[0]!,
      dateIso: this.dateIsoForDay(ownDays[0]!),
      kind: 'SELF',
      targetName: 'sua escala',
      targetShiftCode: this.labelsForDays(ownId, destDays),
      ownShiftCode: this.labelsForDays(ownId, ownDays),
      sourceDate: this.dateIsoForDay(ownDays[0]!),
      targetDate: this.dateIsoForDay(destDays[0]!),
      pairLength: ownDays.length,
      sourceDates: ownDays.map((d) => this.dateIsoForDay(d)),
      targetDates: destDays.map((d) => this.dateIsoForDay(d)),
      sourceLabel: this.labelsForDays(ownId, ownDays),
      targetLabel: this.labelsForDays(ownId, destDays),
    });
    this.swapDialogVisible.set(true);
  }

  /** Dias do bloco FA (1 ou 2). Só expande se o vizinho também for FA — F comum fica 1 dia. */
  private resolveFaBlockDays(
    row: EmployeeRowData,
    day: number,
    cell: ScheduleCellData,
  ): number[] {
    if (!this.isFaCell(cell)) return [day];
    const prev = day > 1 ? row.cells[day - 2] : null;
    const next = row.cells[day] ?? null;
    if (this.isFaCell(prev)) return [day - 1, day];
    if (this.isFaCell(next)) return [day, day + 1];
    return [day];
  }

  /** FA explícita na grade (não confunde com F / FOLGA comum). */
  private isFaCell(cell: ScheduleCellData | null | undefined): boolean {
    if (!cell) return false;
    if (cell.kind === 'fa') return true;
    if (cell.folgaBaseKind === 'fa') return true;
    const disp = (cell.display ?? '').trim().toUpperCase();
    if (disp === 'FA') return true;
    const title = (cell.title ?? '').trim().toUpperCase();
    return title === 'FA' || title.includes('FOLGA AGRUPADA');
  }

  /** Aplica efeito vermelho + estrelinha nos dias selecionados (origem e destino). */
  private applySwapSourceHighlight(grid: ScheduleGridData): ScheduleGridData {
    const pick = this.swapPick();
    const empId = this.employeeId();
    if (!this.isExecutedView() || !empId) return grid;
    if (pick.ownDays.length < 1 && !pick.peer && pick.selfDestDays.length < 1) return grid;

    const ownDays = new Set([...pick.ownDays, ...pick.selfDestDays]);
    const peerId = pick.peer?.employeeId;
    const peerDays = new Set(pick.peer?.days ?? []);

    return {
      ...grid,
      groups: grid.groups.map((group) => ({
        ...group,
        rows: group.rows.map((row) => {
          const markOwn = row.employeeId === empId;
          const markPeer = !!peerId && row.employeeId === peerId;
          if (!markOwn && !markPeer) return row;
          return {
            ...row,
            cells: row.cells.map((cell, idx) => {
              const day = idx + 1;
              const selected =
                (markOwn && ownDays.has(day)) || (markPeer && peerDays.has(day));
              if (!selected) return cell;
              return { ...cell, swapSelected: true };
            }),
          };
        }),
      })),
    };
  }

  isSwapOfferable(cell: ScheduleCellData): boolean {
    return !cell.shiftSwap && !cell.requestPending;
  }

  private openSwapFromCell(event: GridCellClickEvent): void {
    const swap = event.cell.shiftSwap;
    if (!swap) return;
    const ownId = this.employeeId();

    if (swap.status === 'AWAITING_ADMIN') {
      this.swapDialogContext.set({
        mode: 'awaiting_admin',
        kind: swap.counterpartName === 'sua escala' ? 'SELF' : 'PEER',
        day: event.day,
        dateIso: swap.sourceDate || this.dateIsoForDay(event.day),
        swapId: swap.id,
        targetName: swap.targetName || (swap.role === 'requester' ? swap.counterpartName : event.employeeName),
        targetShiftCode:
          swap.targetShiftCode ||
          (swap.role === 'requester' ? swap.counterpartShiftCode : event.cell.display),
        requesterName:
          swap.requesterName || (swap.role === 'target' ? swap.counterpartName : event.employeeName),
        requesterShiftCode:
          swap.requesterShiftCode ||
          (swap.role === 'target' ? swap.counterpartShiftCode : event.cell.display) ||
          swap.ownShiftCode,
        ownShiftCode: swap.ownShiftCode || event.cell.display,
        sourceDate: swap.sourceDate,
        targetDate: swap.targetDate ?? undefined,
      });
      this.swapDialogVisible.set(true);
      return;
    }

    if (swap.status === 'OFFERED' && swap.role !== 'target' && swap.role !== 'requester') {
      this.swapDialogContext.set({
        mode: 'awaiting_peer',
        kind: 'PEER',
        day: event.day,
        dateIso: swap.sourceDate || this.dateIsoForDay(event.day),
        swapId: swap.id,
        targetName: swap.targetName || swap.counterpartName,
        targetShiftCode: swap.targetShiftCode || swap.counterpartShiftCode,
        requesterName: swap.requesterName || event.employeeName,
        requesterShiftCode: swap.requesterShiftCode || swap.ownShiftCode || event.cell.display,
        ownShiftCode: swap.ownShiftCode || event.cell.display,
        sourceDate: swap.sourceDate,
        targetDate: swap.targetDate ?? undefined,
      });
      this.swapDialogVisible.set(true);
      return;
    }

    if (swap.role === 'target' && ownId === event.employeeId) {
      this.swapDialogContext.set({
        mode: 'respond',
        day: event.day,
        dateIso: swap.targetDate || this.dateIsoForDay(event.day),
        swapId: swap.id,
        targetName: swap.targetName || event.employeeName,
        targetShiftCode: swap.targetShiftCode || swap.ownShiftCode || event.cell.display,
        requesterName: swap.requesterName || swap.counterpartName,
        requesterShiftCode: swap.requesterShiftCode || swap.counterpartShiftCode,
        ownShiftCode: swap.ownShiftCode || event.cell.display,
        sourceDate: swap.sourceDate,
        targetDate: swap.targetDate ?? undefined,
      });
      this.swapDialogVisible.set(true);
      return;
    }

    if (swap.role === 'requester' && ownId === event.employeeId) {
      this.swapDialogContext.set({
        mode: swap.status === 'OFFERED' ? 'cancel' : 'awaiting_admin',
        day: event.day,
        dateIso: swap.sourceDate || this.dateIsoForDay(event.day),
        swapId: swap.id,
        targetName: swap.targetName || swap.counterpartName,
        targetShiftCode: swap.targetShiftCode || swap.counterpartShiftCode,
        requesterName: swap.requesterName || event.employeeName,
        requesterShiftCode: swap.requesterShiftCode || swap.ownShiftCode || event.cell.display,
        ownShiftCode: swap.ownShiftCode || event.cell.display,
        sourceDate: swap.sourceDate,
        targetDate: swap.targetDate ?? undefined,
      });
      this.swapDialogVisible.set(true);
    }
  }

  onSwapDialogVisibleChange(visible: boolean): void {
    this.swapDialogVisible.set(visible);
    if (!visible) {
      this.swapDialogContext.set(null);
      this.clearSwapPick();
    }
  }

  submitSwapOffer(payload: { notes?: string }): void {
    const ctx = this.swapDialogContext();
    if (!ctx) return;

    if (ctx.mode === 'offer_self' && ctx.sourceDate && ctx.targetDate) {
      this.submittingSwap.set(true);
      this.shiftSwapService
        .offerSelf({
          year: this.yearSig(),
          month: this.monthSig(),
          sourceDate: ctx.sourceDate,
          targetDate: ctx.targetDate,
          dates: ctx.sourceDates,
          targetDates: ctx.targetDates,
          pairLength: ctx.pairLength ?? ctx.sourceDates?.length ?? 1,
          requesterShiftCode: ctx.ownShiftCode || ctx.sourceLabel,
          targetShiftCode: ctx.targetShiftCode || ctx.targetLabel,
          notes: payload.notes,
        })
        .subscribe({
          next: () => {
            this.submittingSwap.set(false);
            this.swapDialogVisible.set(false);
            this.swapDialogContext.set(null);
            this.clearSwapPick();
            this.messages.add({
              severity: 'success',
              summary: 'Aguardando admin',
              detail: 'Realocação enviada. O administrador precisa aprovar.',
            });
            this.loadSchedule();
          },
          error: (err: { error?: { error?: string } }) => {
            this.submittingSwap.set(false);
            this.messages.add({
              severity: 'error',
              summary: 'Não foi possível solicitar',
              detail: err.error?.error ?? 'Erro ao solicitar realocação.',
            });
          },
        });
      return;
    }

    if (!ctx.targetEmployeeId || !ctx.sourceDate || !ctx.targetDate) return;
    this.submittingSwap.set(true);
    this.shiftSwapService
      .offer({
        targetEmployeeId: ctx.targetEmployeeId,
        year: this.yearSig(),
        month: this.monthSig(),
        date: ctx.sourceDate,
        targetDate: ctx.targetDate,
        dates: ctx.sourceDates,
        targetDates: ctx.targetDates,
        pairLength: ctx.pairLength ?? ctx.sourceDates?.length ?? 1,
        requesterShiftCode: ctx.ownShiftCode || ctx.sourceLabel,
        targetShiftCode: ctx.targetShiftCode || ctx.targetLabel,
        notes: payload.notes,
      })
      .subscribe({
        next: () => {
          this.submittingSwap.set(false);
          this.swapDialogVisible.set(false);
          this.swapDialogContext.set(null);
          this.clearSwapPick();
          this.messages.add({
            severity: 'success',
            summary: 'Troca ofertada',
            detail: 'O colega verá a solicitação na escala e em Troca de Turno.',
          });
          this.loadSchedule();
        },
        error: (err: { error?: { error?: string } }) => {
          this.submittingSwap.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Não foi possível ofertar',
            detail: err.error?.error ?? 'Erro ao ofertar troca.',
          });
        },
      });
  }

  acceptSwap(): void {
    const id = this.swapDialogContext()?.swapId;
    if (!id) return;
    this.submittingSwap.set(true);
    this.shiftSwapService.accept(id).subscribe({
      next: (row) => {
        this.submittingSwap.set(false);
        this.swapDialogVisible.set(false);
        this.swapDialogContext.set(null);
        const awaitingAdmin = row.status === 'AWAITING_ADMIN';
        this.messages.add({
          severity: 'success',
          summary: awaitingAdmin ? 'Aceite registrado' : 'Troca aceita',
          detail: awaitingAdmin
            ? 'Aguardando aprovação do administrador.'
            : 'A troca foi aplicada na escala realizada.',
        });
        this.loadSchedule();
      },
      error: (err: { error?: { error?: string } }) => {
        this.submittingSwap.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível aceitar.',
        });
      },
    });
  }

  rejectSwap(): void {
    const id = this.swapDialogContext()?.swapId;
    if (!id) return;
    this.submittingSwap.set(true);
    this.shiftSwapService.rejectByTarget(id).subscribe({
      next: () => {
        this.submittingSwap.set(false);
        this.swapDialogVisible.set(false);
        this.swapDialogContext.set(null);
        this.messages.add({ severity: 'info', summary: 'Troca recusada' });
        this.loadSchedule();
      },
      error: (err: { error?: { error?: string } }) => {
        this.submittingSwap.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível recusar.',
        });
      },
    });
  }

  cancelSwapOffer(): void {
    const id = this.swapDialogContext()?.swapId;
    if (!id) return;
    this.submittingSwap.set(true);
    this.shiftSwapService.cancel(id).subscribe({
      next: () => {
        this.submittingSwap.set(false);
        this.swapDialogVisible.set(false);
        this.swapDialogContext.set(null);
        this.messages.add({ severity: 'info', summary: 'Oferta cancelada' });
        this.loadSchedule();
      },
      error: (err: { error?: { error?: string } }) => {
        this.submittingSwap.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível cancelar.',
        });
      },
    });
  }

  onSelectionCompleted(selection: GridSelectionComplete): void {
    if (this.isExecutedView()) return;
    const days = this.daysFromSelection(selection);
    if (days.length === 0) return;
    this.openRequestForDays(days, selection.employeeName);
  }

  private openPendingRequest(
    day: number,
    employeeName: string,
    pendingType: PortalRequestType,
    requestId?: string,
  ): void {
    this.requestDialogContext.set({
      day,
      dateIso: this.dateIsoForDay(day),
      employeeName,
      pendingRequest: {
        type: pendingType,
        label: portalPendingRequestLabel(pendingType),
        requestId,
      },
    });
    this.requestDialogVisible.set(true);
  }

  private openRequestForDays(days: number[], employeeName: string): void {
    const firstDay = days[0]!;
    const dateIso =
      days.length === 1 ? this.dateIsoForDay(firstDay) : `${days.length} dias selecionados`;

    this.requestDialogContext.set({
      day: firstDay,
      days,
      dateIso,
      employeeName,
    });
    this.requestDialogVisible.set(true);
  }

  private daysFromSelection(selection: GridSelectionComplete): number[] {
    if (selection.days?.length) {
      return [...selection.days].sort((a, b) => a - b);
    }
    const days: number[] = [];
    for (let d = selection.startDay; d <= selection.endDay; d++) {
      days.push(d);
    }
    return days;
  }

  private dateIsoForDay(day: number): string {
    const y = this.yearSig();
    const m = this.monthSig();
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  onRequestDialogVisibleChange(visible: boolean): void {
    this.requestDialogVisible.set(visible);
    if (!visible) {
      this.requestDialogContext.set(null);
      this.scheduleGrid?.clearSelection();
    }
  }

  submitRequest(payload: { type: PortalRequestType; notes?: string }): void {
    const ctx = this.requestDialogContext();
    if (!ctx) return;

    const days = ctx.days?.length ? [...ctx.days].sort((a, b) => a - b) : [ctx.day];
    const year = this.yearSig();
    const month = this.monthSig();

    if (payload.type === 'FA') {
      if (days.length !== 2 || days[1] !== days[0]! + 1) {
        this.messages.add({
          severity: 'warn',
          summary: 'Folga agrupada',
          detail: 'Selecione exatamente 2 dias consecutivos para Folga agrupada.',
        });
        return;
      }
    }

    if (payload.type === 'FP') {
      const schedule = this.scheduleData();
      const limit = schedule?.portalFpRequestedLimit ?? 3;
      const current = schedule?.portalFpRequestedCount ?? 0;
      if (wouldExceedPortalFpLimit(current, days.length, limit)) {
        this.messages.add({
          severity: 'warn',
          summary: 'Limite de folgas pedidas',
          detail: portalFpLimitMessage(limit),
        });
        return;
      }
    }

    this.submittingRequest.set(true);

    const request$ =
      payload.type === 'FERIAS'
        ? this.portalService.createRequest({
            year,
            month,
            date: this.dateIsoForDay(days[0]!),
            endDate: this.dateIsoForDay(days[days.length - 1]!),
            type: 'FERIAS',
            notes: payload.notes,
          })
        : from(days).pipe(
            concatMap((day) =>
              this.portalService.createRequest({
                year,
                month,
                date: this.dateIsoForDay(day),
                type: payload.type,
                notes: payload.notes,
              }),
            ),
            toArray(),
          );

    request$.subscribe({
        next: () => {
          this.submittingRequest.set(false);
          this.requestDialogVisible.set(false);
          this.requestDialogContext.set(null);
          this.scheduleGrid?.clearSelection();
          this.clearMobileSelection();
          this.messages.add({
            severity: 'success',
            summary: 'Solicitação enviada',
            detail:
              payload.type === 'FERIAS' && days.length > 1
                ? `Férias solicitadas de ${this.dateIsoForDay(days[0]!)} a ${this.dateIsoForDay(days[days.length - 1]!)}. Aguarde a aprovação do administrador.`
                : days.length > 1
                  ? `${days.length} solicitações enviadas. Aguarde a aprovação do administrador.`
                  : 'Aguarde a aprovação do administrador.',
          });
          this.loadSchedule();
        },
        error: (err: { error?: { error?: string; code?: string } }) => {
          this.submittingRequest.set(false);
          const detail = err.error?.error ?? 'Não foi possível registrar a solicitação.';
          this.messages.add({
            severity: err.error?.code === 'PORTAL_FP_MONTHLY_LIMIT' ? 'warn' : 'error',
            summary: err.error?.code === 'PORTAL_FP_MONTHLY_LIMIT' ? 'Limite de folgas pedidas' : 'Erro',
            detail,
          });
        },
      });
  }

  cancelRequest(payload: { type: PortalRequestType; requestId?: string }): void {
    const ctx = this.requestDialogContext();
    if (!ctx?.pendingRequest) return;

    this.submittingRequest.set(true);
    this.portalService
      .cancelRequest({
        year: this.yearSig(),
        month: this.monthSig(),
        date: ctx.dateIso,
        type: payload.type,
        requestId: payload.requestId ?? ctx.pendingRequest.requestId,
      })
      .subscribe({
        next: () => {
          this.submittingRequest.set(false);
          this.requestDialogVisible.set(false);
          this.requestDialogContext.set(null);
          this.scheduleGrid?.clearSelection();
          this.messages.add({
            severity: 'success',
            summary: 'Solicitação excluída',
            detail: 'A solicitação pendente foi removida.',
          });
          this.loadSchedule();
        },
        error: (err: { error?: { error?: string } }) => {
          this.submittingRequest.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Não foi possível excluir a solicitação.',
          });
        },
      });
  }

  hasVisibleRows(grid: ScheduleGridData): boolean {
    return grid.groups.some((g) => g.rows.length > 0);
  }

  isToday(day: number): boolean {
    const now = new Date();
    return (
      now.getFullYear() === this.yearSig() &&
      now.getMonth() + 1 === this.monthSig() &&
      now.getDate() === day
    );
  }
}
