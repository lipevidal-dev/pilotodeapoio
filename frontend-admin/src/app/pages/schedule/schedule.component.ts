import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { Subscription, concatMap, from, last } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { DividerModule } from 'primeng/divider';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { MessageService } from 'primeng/api';
import { ScheduleService } from '../../services/schedule.service';
import { ScheduleRefreshService } from '../../services/schedule-refresh.service';
import { ScheduleWorkspaceService } from '../../services/schedule-workspace.service';
import { ScheduleExportService } from '../../services/schedule-export.service';
import {
  ScheduleGridComponent,
  type GridDeletionSelectionComplete,
  type GridMoveRequest,
  type GridSelectionComplete,
} from '../../components/schedule-grid/schedule-grid.component';
import {
  ScheduleAllocationPopupComponent,
  type AllocationPopupContext,
  type ManualAllocationOption,
} from '../../components/schedule-allocation-popup/schedule-allocation-popup.component';
import {
  ScheduleDeleteConfirmPopupComponent,
  type DeletePopupContext,
} from '../../components/schedule-delete-confirm-popup/schedule-delete-confirm-popup.component';
import { ScheduleLegendComponent } from '../../components/schedule-legend/schedule-legend.component';
import { extractManualEditConflictMessage } from '../../utils/manual-edit-error.util';
import { groupContiguousDays, isoDateFromGrid } from '../../utils/schedule-grid-selection.util';
import { sortEmployeesBySeniority } from '../../utils/employee-sort.util';
import { buildScheduleGrid } from '../../utils/schedule-cell.mapper';
import { applyAuditPreviewToSchedule } from '../../utils/step-audit-grid.util';
import { applyGridFilters } from '../../utils/schedule-grid.filter';
import {
  computeGridAuditTotals,
  enrichGridAudit,
  type AuditViolation,
  type GridAuditTotals,
} from '../../utils/operational-audit.util';
import type {
  EmployeeType,
  GenerateByStepsResponse,
  ManualEditResponse,
  PublishBlockedResponse,
  ScheduleMonthResponse,
  ScheduleViolation,
  StepGenerationOptions,
  ViolationSeverity,
} from '../../models/api.models';
import type { ScheduleGridData } from '../../models/schedule-grid.models';

const DEFAULT_STEP_OPTIONS = (): StepGenerationOptions => ({
  paoCheckPreAllocations: false,
  paoCheckRestrictions: false,
  paoDemandPlanning: false,
  paoCoverageT6: false,
  paoCoverageT7: false,
  paoCoverageT8: false,
  paoAllocateFolgas: false,
  paoAllocateFlights: false,
  apaoCheckPreAllocations: false,
  apaoCheckShiftPreference: false,
  apaoCheckShiftRestrictions: false,
  apaoAllocate: false,
});

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputNumberModule,
    TableModule,
    TagModule,
    MessageModule,
    DividerModule,
    SelectModule,
    CheckboxModule,
    DialogModule,
    ScheduleGridComponent,
    ScheduleAllocationPopupComponent,
    ScheduleDeleteConfirmPopupComponent,
    ScheduleLegendComponent,
  ],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss',
})
export class ScheduleComponent implements OnInit, OnDestroy {
  @ViewChild('scheduleGrid') scheduleGrid?: ScheduleGridComponent;

  private readonly scheduleService = inject(ScheduleService);
  private readonly scheduleRefresh = inject(ScheduleRefreshService);
  private readonly workspace = inject(ScheduleWorkspaceService);
  private readonly exportService = inject(ScheduleExportService);
  private readonly messages = inject(MessageService);
  private refreshSub?: Subscription;

  readonly yearSig = signal(this.workspace.year());
  readonly monthSig = signal(this.workspace.month());

  readonly generating = signal(false);
  readonly generatingSteps = signal(false);
  readonly stepModalVisible = signal(false);
  readonly stepOptions = signal<StepGenerationOptions>(DEFAULT_STEP_OPTIONS());
  readonly stepAuditResult = signal<GenerateByStepsResponse | null>(null);
  readonly generatingFlights = signal(false);
  readonly generatingApao = signal(false);
  readonly publishing = signal(false);
  readonly clearing = signal(false);
  readonly loadingView = signal(false);
  readonly publishBlocked = signal<PublishBlockedResponse | null>(null);
  readonly publishResult = signal<{ status: string } | null>(null);
  readonly scheduleData = signal<ScheduleMonthResponse | null>(null);
  readonly manualEditing = signal(false);
  readonly allocationPopupVisible = signal(false);
  readonly allocationContext = signal<AllocationPopupContext | null>(null);
  readonly deletePopupVisible = signal(false);
  readonly deleteContext = signal<DeletePopupContext | null>(null);
  private pendingSelection: GridSelectionComplete | null = null;
  private pendingDeleteSelection: GridDeletionSelectionComplete | null = null;

  readonly filterType = signal<'ALL' | EmployeeType>('ALL');
  readonly filterEmployeeId = signal<string | null>(null);
  readonly singleEmployeeOnly = signal(false);
  /** IDs de painéis/subseções recolhidos pelo usuário após a geração. */
  private readonly collapsedSections = signal<Set<string>>(new Set());

  readonly generation = computed(() => this.workspace.lastGeneration());
  readonly scheduleMonthId = computed(() => this.workspace.scheduleMonthId());

  readonly gridEditable = computed(() => {
    const status = this.scheduleData()?.scheduleMonth.status;
    return status === 'GENERATED' || status === 'DRAFT';
  });

  readonly stepAllocationEntries = computed(() => {
    const audit = this.stepAuditResult();
    if (!audit) return [];
    return Object.entries(audit.report.allocationsByStep).map(([step, counts]) => ({
      step,
      assignments: counts.assignments,
      allocations: counts.allocations,
    }));
  });

  readonly apaoWithoutPaoWarning = computed(() => {
    const steps = this.stepOptions();
    const hasPaoCoverage =
      steps.paoDemandPlanning || steps.paoCoverageT6 || steps.paoCoverageT7 || steps.paoCoverageT8;
    return steps.apaoAllocate && !hasPaoCoverage;
  });

  /** Violações do mês (atualizadas após edição manual ou recarregar). */
  readonly violationList = computed((): ScheduleViolation[] => {
    const audit = this.stepAuditResult();
    if (audit?.report.violations?.length) {
      return audit.report.violations;
    }
    const data = this.scheduleData();
    if (data?.ruleViolations?.length) {
      const nameById = new Map(data.employees.map((e) => [e.id, e.name]));
      return data.ruleViolations.map((v) => ({
        severity: v.severity,
        ruleCode: v.ruleCode,
        message: v.message,
        date: v.date ?? '',
        employee: v.employeeId ? (nameById.get(v.employeeId) ?? v.employeeId) : '—',
        detail: v.message,
        employeeId: v.employeeId,
      }));
    }
    const gen = this.generation();
    if (gen?.violations?.length) {
      return gen.violations;
    }
    return [];
  });

  readonly criticalViolations = computed(() =>
    this.filterViolations(this.violationList(), 'CRITICAL'),
  );
  readonly warningViolations = computed(() =>
    this.filterViolations(this.violationList(), 'WARNING'),
  );
  readonly infoViolations = computed(() =>
    this.filterViolations(this.violationList(), 'INFO'),
  );

  readonly rawGrid = computed(() => {
    const data = this.scheduleData();
    if (!data) return null;
    const audit = this.stepAuditResult();
    const viewData = audit ? applyAuditPreviewToSchedule(data, audit) : data;
    return buildScheduleGrid({
      year: this.yearSig(),
      month: this.monthSig(),
      employees: viewData.employees,
      assignments: viewData.assignments,
      preAllocations: viewData.preAllocations,
      operationalCadastros: viewData.operationalCadastros,
    });
  });

  readonly auditViolations = computed((): AuditViolation[] =>
    this.violationList().map((v) => ({
      severity: v.severity,
      ruleCode: v.ruleCode,
      employee: v.employee,
      employeeId: v.employeeId,
    })),
  );

  readonly displayGrid = computed((): ScheduleGridData | null => {
    const grid = this.rawGrid();
    if (!grid) return null;
    const filtered = applyGridFilters(grid, {
      type: this.filterType(),
      employeeId: this.filterEmployeeId(),
      singleEmployeeOnly: this.singleEmployeeOnly(),
    });
    return enrichGridAudit(filtered, this.auditViolations());
  });

  readonly gridAuditTotals = computed((): GridAuditTotals | null => {
    const grid = this.displayGrid();
    const data = this.scheduleData();
    if (!grid) return null;
    return computeGridAuditTotals(grid, data?.assignments ?? []);
  });

  readonly employeeOptions = computed(() => {
    const data = this.scheduleData();
    if (!data) return [];
    const list = sortEmployeesBySeniority(data.employees);
    return [{ label: 'Todos', value: null as string | null }, ...list.map((e) => ({ label: e.name, value: e.id }))];
  });

  readonly typeOptions = [
    { label: 'Todos', value: 'ALL' as const },
    { label: 'PAO', value: 'PAO' as const },
    { label: 'APAO', value: 'APAO' as const },
  ];

  hasVisibleRows(grid: ScheduleGridData): boolean {
    return grid.groups.some((g) => g.rows.length > 0);
  }

  periodLabel(): string {
    const months = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
    ];
    return `${months[this.monthSig() - 1]}/${this.yearSig()}`;
  }

  ngOnInit(): void {
    this.yearSig.set(this.workspace.year());
    this.monthSig.set(this.workspace.month());
    this.loadScheduleView();
    this.refreshSub = this.scheduleRefresh.changes$.subscribe(() => this.loadScheduleView());
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
  }

  openStepModal(): void {
    this.stepModalVisible.set(true);
  }

  closeStepModal(): void {
    this.stepModalVisible.set(false);
  }

  updateStepOption(key: keyof StepGenerationOptions, value: boolean): void {
    this.stepOptions.update((current) => ({ ...current, [key]: value }));
  }

  clearStepAudit(): void {
    this.stepAuditResult.set(null);
  }

  generateBySteps(): void {
    if (this.apaoWithoutPaoWarning()) {
      this.messages.add({
        severity: 'warn',
        summary: 'APAO sem cobertura PAO',
        detail: 'APAO depende de cobertura PAO. Execute primeiro T6/T7/T8 ou marque cobertura.',
      });
    }

    this.generatingSteps.set(true);
    this.publishBlocked.set(null);
    this.publishResult.set(null);
    const steps = this.stepOptions();
    this.scheduleService.generateBySteps(this.yearSig(), this.monthSig(), steps).subscribe({
      next: (result) => {
        this.generatingSteps.set(false);
        this.stepAuditResult.set(result);
        this.stepModalVisible.set(false);
        this.messages.add({
          severity: 'info',
          summary: 'Auditoria por etapas',
          detail: 'Grade parcial exibida — simulação não persistida.',
        });
      },
      error: (err: HttpErrorResponse) => {
        this.generatingSteps.set(false);
        const msg = err.error?.error ?? err.message ?? 'Erro na geração por etapas';
        this.messages.add({ severity: 'error', summary: 'Gerar por Etapas', detail: msg });
      },
    });
  }

  generate(): void {
    this.generating.set(true);
    this.stepAuditResult.set(null);
    this.publishBlocked.set(null);
    this.publishResult.set(null);
    this.scheduleService.generateSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (result) => {
        this.workspace.setGeneration(result, this.yearSig(), this.monthSig());
        this.generating.set(false);
        this.messages.add({
          severity: result.summary.criticalCount ? 'warn' : 'success',
          summary: 'Escala gerada',
          detail: `Status ${result.status} — ${result.assignmentsCreated} alocações.`,
        });
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.generating.set(false);
        const msg = err.error?.error ?? err.message ?? 'Erro ao gerar escala';
        this.messages.add({ severity: 'error', summary: 'Geração', detail: msg });
      },
    });
  }

  generateApao(): void {
    const id = this.scheduleMonthId() ?? this.scheduleData()?.scheduleMonth.id;
    if (!id) return;
    this.generatingApao.set(true);
    this.scheduleService.generateApaoSchedule(id).subscribe({
      next: (result) => {
        this.generatingApao.set(false);
        this.messages.add({
          severity: 'success',
          summary: 'Escala APAO',
          detail: `${result.assignmentsCreated ?? 0} turno(s) APAO; ${result.allocationsCreated ?? 0} folga(s) geradas.`,
        });
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.generatingApao.set(false);
        const msg = err.error?.error ?? err.message ?? 'Erro ao gerar escala APAO';
        this.messages.add({ severity: 'error', summary: 'Gerar Escala APAO', detail: msg });
      },
    });
  }

  generateFlights(): void {
    const id = this.scheduleMonthId() ?? this.scheduleData()?.scheduleMonth.id;
    if (!id) return;
    this.generatingFlights.set(true);
    this.scheduleService.generateFlights(id).subscribe({
      next: (result) => {
        this.generatingFlights.set(false);
        this.messages.add({
          severity: 'success',
          summary: 'Voos gerados',
          detail: `${result.flightsCreated} dia(s) PAO marcados como VOO.`,
        });
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.generatingFlights.set(false);
        const msg = err.error?.error ?? err.message ?? 'Erro ao gerar voos';
        this.messages.add({ severity: 'error', summary: 'Gerar Voos', detail: msg });
      },
    });
  }

  clearGeneration(): void {
    const id = this.scheduleMonthId() ?? this.scheduleData()?.scheduleMonth.id;
    if (!id) return;
    if (
      !window.confirm(
        'Remover toda a geração deste mês (turnos, folgas sociais, folgas comuns, voos)? Férias e folgas pedidas (FP) não são alteradas.',
      )
    ) {
      return;
    }
    this.clearing.set(true);
    this.scheduleService.clearGeneratedData(id).subscribe({
      next: () => {
        this.clearing.set(false);
        this.workspace.clear();
        this.messages.add({
          severity: 'success',
          summary: 'Geração limpa',
          detail: 'Turnos, folgas e voos removidos. Mês voltou para rascunho.',
        });
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.clearing.set(false);
        const msg = err.error?.error ?? err.message ?? 'Erro ao limpar geração';
        this.messages.add({ severity: 'error', summary: 'Limpar geração', detail: msg });
      },
    });
  }

  publish(): void {
    const id = this.scheduleMonthId();
    if (!id) return;
    this.publishing.set(true);
    this.publishBlocked.set(null);
    this.publishResult.set(null);
    this.scheduleService.publishSchedule(id).subscribe({
      next: (res) => {
        this.publishing.set(false);
        this.publishResult.set({ status: res.status });
        this.messages.add({
          severity: 'success',
          summary: 'Publicado',
          detail: `Escala ${res.month}/${res.year} publicada.`,
        });
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.publishing.set(false);
        if (err.status === 409 && err.error?.code === 'PUBLISH_BLOCKED_CRITICAL_VIOLATIONS') {
          this.publishBlocked.set(err.error as PublishBlockedResponse);
          this.messages.add({
            severity: 'error',
            summary: 'Publicação bloqueada',
            detail: err.error.message,
          });
          return;
        }
        const msg = err.error?.message ?? err.error?.error ?? 'Erro ao publicar';
        this.messages.add({ severity: 'error', summary: 'Publicação', detail: msg });
      },
    });
  }

  onSelectionCompleted(selection: GridSelectionComplete): void {
    this.pendingSelection = selection;
    this.allocationContext.set({
      employeeName: selection.employeeName,
      startDay: selection.startDay,
      endDay: selection.endDay,
      selectedDays: selection.days,
    });
    this.allocationPopupVisible.set(true);
  }

  closeAllocationPopup(): void {
    this.allocationPopupVisible.set(false);
    this.allocationContext.set(null);
    this.pendingSelection = null;
    this.scheduleGrid?.clearSelection();
  }

  onDeletionSelectionCompleted(selection: GridDeletionSelectionComplete): void {
    this.pendingDeleteSelection = selection;
    this.deleteContext.set({
      employeeName: selection.employeeName,
      startDay: selection.startDay,
      endDay: selection.endDay,
      days: selection.days,
      cells: selection.cells,
    });
    this.deletePopupVisible.set(true);
  }

  closeDeletePopup(): void {
    this.deletePopupVisible.set(false);
    this.deleteContext.set(null);
    this.pendingDeleteSelection = null;
    this.scheduleGrid?.clearSelection();
  }

  onDeleteConfirmed(opts: { force: boolean }): void {
    const selection = this.pendingDeleteSelection;
    const monthId = this.scheduleMonthId() ?? this.scheduleData()?.scheduleMonth.id;
    if (!selection || !monthId) return;

    const ranges = groupContiguousDays(selection.days);
    const year = this.yearSig();
    const month = this.monthSig();

    this.manualEditing.set(true);
    this.deletePopupVisible.set(false);

    from(ranges)
      .pipe(
        concatMap((range) =>
          this.scheduleService.manualEditRange(monthId, {
            employeeId: selection.employeeId,
            startDate: isoDateFromGrid(year, month, range.startDay),
            endDate: isoDateFromGrid(year, month, range.endDay),
            type: 'CLEAR',
            mode: 'clear',
            force: opts.force || undefined,
          }),
        ),
        last(),
      )
      .subscribe({
        next: (res) =>
          this.handleManualEditSuccess(
            res,
            ranges.length > 1
              ? `${ranges.length} períodos excluídos com sucesso.`
              : 'Alocação excluída com sucesso.',
          ),
        error: (err: HttpErrorResponse) => this.handleManualEditError(err),
      });
  }

  onAllocationOption(option: ManualAllocationOption): void {
    const selection = this.pendingSelection;
    const monthId = this.scheduleMonthId() ?? this.scheduleData()?.scheduleMonth.id;
    if (!selection || !monthId) return;

    const ranges = selection.days?.length
      ? groupContiguousDays(selection.days)
      : [{ startDay: selection.startDay, endDay: selection.endDay }];
    const year = this.yearSig();
    const month = this.monthSig();
    const mode = option === 'CLEAR' ? 'clear' : 'set';

    this.manualEditing.set(true);
    this.allocationPopupVisible.set(false);

    from(ranges)
      .pipe(
        concatMap((range) =>
          this.scheduleService.manualEditRange(monthId, {
            employeeId: selection.employeeId,
            startDate: isoDateFromGrid(year, month, range.startDay),
            endDate: isoDateFromGrid(year, month, range.endDay),
            type: option,
            mode,
          }),
        ),
        last(),
      )
      .subscribe({
        next: (res) =>
          this.handleManualEditSuccess(
            res,
            ranges.length > 1
              ? `${ranges.length} períodos atualizados com sucesso.`
              : 'Período atualizado com sucesso.',
          ),
        error: (err: HttpErrorResponse) => this.handleManualEditError(err),
      });
  }

  onMoveRequested(move: GridMoveRequest): void {
    const monthId = this.scheduleMonthId() ?? this.scheduleData()?.scheduleMonth.id;
    if (!monthId) return;
    this.manualEditing.set(true);
    this.scheduleService
      .manualMove(monthId, {
        source: {
          employeeId: move.source.employeeId,
          date: isoDateFromGrid(this.yearSig(), this.monthSig(), move.source.day),
        },
        target: {
          employeeId: move.target.employeeId,
          date: isoDateFromGrid(this.yearSig(), this.monthSig(), move.target.day),
        },
        mode: 'move',
      })
      .subscribe({
        next: (res) => this.handleManualEditSuccess(res, 'Alteração aplicada com sucesso.'),
        error: (err: HttpErrorResponse) => this.handleManualEditError(err),
      });
  }

  private handleManualEditSuccess(res: ManualEditResponse, detail: string): void {
    this.manualEditing.set(false);
    this.scheduleGrid?.clearSelection();
    this.pendingSelection = null;
    this.pendingDeleteSelection = null;
    this.allocationContext.set(null);
    this.deleteContext.set(null);
    const ruleViolations = res.validation.violations.map((v, idx) => ({
      id: `manual-${idx}`,
      severity: v.severity,
      ruleCode: v.ruleCode,
      message: v.message,
      date: v.date ?? null,
      employeeId: res.employees.find((e) => e.name === v.employee)?.id ?? null,
    }));
    this.workspace.lastGeneration.set(null);
    this.scheduleData.set({
      scheduleMonth: res.scheduleMonth,
      employees: res.employees,
      shifts: res.shifts,
      assignments: res.assignments,
      preAllocations: res.preAllocations,
      operationalCadastros: res.operationalCadastros,
      ruleViolations,
      validation: res.validation,
    });
    this.messages.add({ severity: 'success', summary: 'Escala', detail, life: 4000 });
  }

  private handleManualEditError(err: HttpErrorResponse): void {
    this.manualEditing.set(false);
    const detail = extractManualEditConflictMessage(err);
    const conflicts = (err.error as { conflicts?: Array<{ code?: string; message?: string }> } | null)
      ?.conflicts;
    if (conflicts?.length) {
      console.warn('[manual-edit] conflitos:', conflicts);
    }
    this.messages.add({ severity: 'error', summary: 'Conflito', detail, life: 6000 });
    if (this.pendingDeleteSelection) {
      this.deletePopupVisible.set(true);
    }
  }

  loadScheduleView(): void {
    this.loadingView.set(true);
    this.scheduleService.getSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (data) => {
        this.loadingView.set(false);
        this.scheduleData.set(data);
        const grid = buildScheduleGrid({
          year: this.yearSig(),
          month: this.monthSig(),
          employees: data.employees,
          assignments: data.assignments,
          preAllocations: data.preAllocations,
          operationalCadastros: data.operationalCadastros,
        });
        this.exportService.prepareExportPayload(grid);
      },
      error: () => {
        this.loadingView.set(false);
        this.scheduleData.set(null);
      },
    });
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
    this.loadScheduleView();
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
    this.loadScheduleView();
  }

  goToday(): void {
    const now = new Date();
    this.yearSig.set(now.getFullYear());
    this.monthSig.set(now.getMonth() + 1);
    this.loadScheduleView();
  }

  onFiltersChange(): void {
    if (this.singleEmployeeOnly() && !this.filterEmployeeId()) {
      const first = this.scheduleData()?.employees[0];
      if (first) this.filterEmployeeId.set(first.id);
    }
  }

  summaryValue(key: string): string | number | boolean {
    const gen = this.generation();
    if (!gen) return '—';
    const s = gen.summary;
    const list = this.violationList();
    if (key === 'totalAssignments') {
      return gen.assignmentsCreated ?? s.totalAssignments ?? '—';
    }
    if (key === 'totalViolations') {
      return list.length || s.totalViolations || gen.violations.length;
    }
    if (key === 'criticalCount') {
      return this.criticalViolations().length || s.criticalCount || 0;
    }
    if (key === 'warningCount') {
      return this.warningViolations().length || s.warningCount || 0;
    }
    if (key === 'infoCount') {
      return this.infoViolations().length || s.infoCount || 0;
    }
    const v = s[key];
    if (v === undefined || v === null) return '—';
    if (Array.isArray(v)) return v.join('; ');
    return v as string | number | boolean;
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleDateString('pt-BR');
    } catch {
      return value;
    }
  }

  violationEmployee(v: ScheduleViolation): string {
    return v.employee || v.employeeId || '—';
  }

  isSectionCollapsed(sectionId: string): boolean {
    return this.collapsedSections().has(sectionId);
  }

  toggleSection(sectionId: string): void {
    this.collapsedSections.update((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }

  sectionChevron(sectionId: string): string {
    return this.isSectionCollapsed(sectionId) ? 'pi pi-chevron-right' : 'pi pi-chevron-down';
  }

  statusTagSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'PUBLISHED':
        return 'success';
      case 'GENERATED':
        return 'info';
      default:
        return 'secondary';
    }
  }

  private normalizeViolationSeverity(severity: string | undefined): ViolationSeverity {
    const u = (severity ?? '').toUpperCase();
    if (u === 'CRITICAL' || u === 'CRÍTICA' || u === 'ALTA') {
      return 'CRITICAL';
    }
    if (u === 'WARNING' || u === 'MÉDIA' || u === 'MEDIA') {
      return 'WARNING';
    }
    return 'INFO';
  }

  private filterViolations(
    list: ScheduleViolation[] | undefined,
    severity: ViolationSeverity,
  ): ScheduleViolation[] {
    if (!list) return [];
    return list.filter((v) => this.normalizeViolationSeverity(v.severity) === severity);
  }
}
