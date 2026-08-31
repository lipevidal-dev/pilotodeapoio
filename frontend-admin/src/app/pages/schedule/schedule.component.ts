import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { Subscription, concatMap, from, last } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { DividerModule } from 'primeng/divider';
import { MessageService } from 'primeng/api';
import { ScheduleService } from '../../services/schedule.service';
import { ScheduleRefreshService } from '../../services/schedule-refresh.service';
import { ScheduleWorkspaceService } from '../../services/schedule-workspace.service';
import { ScheduleExportService } from '../../services/schedule-export.service';
import { NextMotorConfigService } from '../../services/next-motor-config.service';
import {
  ScheduleGridComponent,
  type GridCellClickEvent,
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
import {
  PortalRequestApprovalDialogComponent,
  type PortalRequestApprovalContext,
} from '../../components/portal-request-approval-dialog/portal-request-approval-dialog.component';
import {
  ShiftSwapDialogComponent,
  type ShiftSwapDialogContext,
} from '../../components/shift-swap-dialog/shift-swap-dialog.component';
import { SchedulePdfDialogComponent } from '../../components/schedule-pdf-dialog/schedule-pdf-dialog.component';
import { PortalService } from '../../services/portal.service';
import { ShiftSwapService } from '../../services/shift-swap.service';
import { AuthService } from '../../services/auth.service';
import {
  filterGridByPdfScope,
  type SchedulePdfScope,
} from '../../utils/schedule-pdf-scope.util';
import {
  portalPendingRequestLabel,
  portalPendingTypeFromCell,
} from '../../utils/portal-request.util';
import { AirplaneIconComponent } from '../../components/icons/airplane-icon.component';
import { extractManualEditConflictMessage } from '../../utils/manual-edit-error.util';
import { groupContiguousDays, isoDateFromGrid } from '../../utils/schedule-grid-selection.util';
import { buildScheduleGrid } from '../../utils/schedule-cell.mapper';
import {
  computeGridAuditTotals,
  enrichGridAudit,
  type AuditViolation,
  type GridAuditTotals,
} from '../../utils/operational-audit.util';
import type {
  ManualEditResponse,
  ScheduleMonthResponse,
  ScheduleViolation,
  ViolationSeverity,
} from '../../models/api.models';
import type { ScheduleGridData } from '../../models/schedule-grid.models';
import {
  formatGenerationPersistenceIssueLine,
  generationRuleLabel,
  summarizeGenerationPersistenceIssues,
  type GenerationPersistenceValidation,
} from '../../utils/generation-validation.util';

export type ScheduleViewMode = 'planned' | 'executed';

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    MessageModule,
    DividerModule,
    ScheduleGridComponent,
    ScheduleAllocationPopupComponent,
    ScheduleDeleteConfirmPopupComponent,
    PortalRequestApprovalDialogComponent,
    ShiftSwapDialogComponent,
    SchedulePdfDialogComponent,
    AirplaneIconComponent,
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
  private readonly nextMotorConfig = inject(NextMotorConfigService);
  private readonly messages = inject(MessageService);
  private readonly portalService = inject(PortalService);
  private readonly shiftSwapService = inject(ShiftSwapService);
  private readonly auth = inject(AuthService);
  private refreshSub?: Subscription;

  readonly yearSig = signal(this.workspace.year());
  readonly monthSig = signal(this.workspace.month());

  readonly generatingNextMotor = signal(false);
  readonly generatingPreferencesOnly = signal(false);
  /** Geração completa com cobertura — oculto na UI; ligue para reexibir o botão antigo. */
  readonly showFullGenerateButton = signal(false);
  readonly nextMotorSummary = signal<{
    enabledCount: number;
    totalCount: number;
    scopeMode: 'all' | 'selected';
    scopeSelectedCount: number | null;
    paoMetaTurnos: number;
    paoMetaDias: number;
    allowedShiftCodes: string[];
  } | null>(null);
  readonly generatingFlights = signal(false);
  readonly publishing = signal(false);
  readonly unpublishing = signal(false);
  readonly clearing = signal(false);
  readonly loadingView = signal(false);
  readonly publishBlocked = signal<{ message: string } | null>(null);
  readonly generationBlocked = signal<GenerationPersistenceValidation | null>(null);
  readonly publishResult = signal<{ status: string } | null>(null);
  readonly scheduleData = signal<ScheduleMonthResponse | null>(null);
  readonly executedScheduleData = signal<ScheduleMonthResponse | null>(null);
  readonly scheduleView = signal<ScheduleViewMode>('planned');
  readonly manualEditing = signal(false);
  readonly allocationPopupVisible = signal(false);
  readonly allocationContext = signal<AllocationPopupContext | null>(null);
  readonly deletePopupVisible = signal(false);
  readonly deleteContext = signal<DeletePopupContext | null>(null);
  readonly approvalDialogVisible = signal(false);
  readonly approvalDialogContext = signal<PortalRequestApprovalContext | null>(null);
  readonly processingApproval = signal(false);
  readonly swapDialogVisible = signal(false);
  readonly swapDialogContext = signal<ShiftSwapDialogContext | null>(null);
  readonly processingSwap = signal(false);
  readonly summaryVisible = signal(false);
  readonly exportingPdf = signal(false);
  readonly pdfDialogVisible = signal(false);
  readonly pdfExportScope = signal<SchedulePdfScope | null>(null);
  readonly linkedEmployeeId = computed(() => this.auth.user()?.employeeId ?? null);
  private pendingSelection: GridSelectionComplete | null = null;
  private pendingDeleteSelection: GridDeletionSelectionComplete | null = null;
  /** Período em que a aba Realizada já foi aplicada como padrão (ano-mês). */
  private executedDefaultPeriodKey: string | null = null;

  /** IDs de painéis/subseções recolhidos pelo usuário após a geração. */
  private readonly collapsedSections = signal<Set<string>>(new Set());

  readonly generation = computed(() => this.workspace.lastGeneration());
  /** Mês exibido na grade — prioriza o carregado em tela, não o id stale da última geração. */
  readonly activeScheduleMonthId = computed(
    () =>
      this.activeScheduleData()?.scheduleMonth.id ?? this.workspace.scheduleMonthId(),
  );
  readonly scheduleMonthId = computed(() => this.workspace.scheduleMonthId());

  readonly isExecutedView = computed(() => this.scheduleView() === 'executed');

  readonly activeScheduleData = computed(() =>
    this.isExecutedView() ? this.executedScheduleData() : this.scheduleData(),
  );

  readonly pageTitle = computed(() =>
    this.isExecutedView() ? 'Escala Realizada' : 'Escala Planejada',
  );

  readonly pageSubtitle = computed(() =>
    this.isExecutedView()
      ? 'Registro diário do que foi executado — ajustes manuais independentes da escala planejada'
      : 'Grade mensal — navegar, gerar, editar e publicar',
  );

  readonly gridEditable = computed(() => {
    if (this.isExecutedView()) {
      return !!this.executedScheduleData();
    }
    const status = this.scheduleData()?.scheduleMonth.status;
    return status === 'GENERATED' || status === 'DRAFT';
  });

  readonly canPublishSchedule = computed(() => {
    const status = this.scheduleData()?.scheduleMonth.status;
    return !!status && status !== 'PUBLISHED' && status !== 'ARCHIVED';
  });

  readonly canUnpublishSchedule = computed(() => {
    return this.scheduleData()?.scheduleMonth.status === 'PUBLISHED';
  });

  /** Realizada só aparece depois que a planejada estiver publicada. */
  readonly canViewExecutedSchedule = computed(() => {
    return this.scheduleData()?.scheduleMonth.status === 'PUBLISHED';
  });

  readonly canClearGeneration = computed(() => {
    const data = this.scheduleData();
    if (!data) return false;
    if (data.scheduleMonth.status === 'PUBLISHED' || data.scheduleMonth.status === 'ARCHIVED') {
      return false;
    }
    return data.assignments.length > 0;
  });

  readonly canGenerateSchedule = computed(() => {
    const data = this.scheduleData();
    if (!data) return true;
    // Disponível em rascunho/criação mesmo com turnos manuais já alocados.
    return (
      data.scheduleMonth.status !== 'PUBLISHED' && data.scheduleMonth.status !== 'ARCHIVED'
    );
  });

  /** Violações do mês (atualizadas após edição manual ou recarregar). */
  readonly violationList = computed((): ScheduleViolation[] => {
    if (this.isExecutedView()) return [];
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
    const data = this.activeScheduleData();
    if (!data) return null;
    return buildScheduleGrid({
      year: this.yearSig(),
      month: this.monthSig(),
      employees: data.employees,
      assignments: data.assignments,
      preAllocations: data.preAllocations,
      operationalCadastros: data.operationalCadastros,
      shifts: data.shifts,
      // Troca de turno só aparece/age na escala realizada.
      shiftSwaps: this.isExecutedView() ? data.shiftSwaps : undefined,
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
    const enriched = enrichGridAudit(grid, this.auditViolations());
    const scope = this.pdfExportScope();
    if (!scope) return enriched;
    return filterGridByPdfScope(enriched, scope, this.linkedEmployeeId());
  });

  readonly gridAuditTotals = computed((): GridAuditTotals | null => {
    if (this.isExecutedView()) return null;
    const grid = this.displayGrid();
    const data = this.scheduleData();
    if (!grid) return null;
    return computeGridAuditTotals(grid, data?.assignments ?? [], data?.employees ?? []);
  });

  hasVisibleRows(grid: ScheduleGridData): boolean {
    return grid.groups.some((g) => g.rows.length > 0);
  }

  generationRuleLabel = generationRuleLabel;

  clearGenerationBlocked(): void {
    this.generationBlocked.set(null);
  }

  periodLabel(): string {
    const months = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
    ];
    return `${months[this.monthSig() - 1]}/${this.yearSig()}`;
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
    if (scope === 'mine' && !this.linkedEmployeeId()) {
      this.messages.add({
        severity: 'warn',
        summary: 'Exportar PDF',
        detail: 'Usuário sem colaborador vinculado.',
      });
      return;
    }

    this.exportingPdf.set(true);
    this.pdfExportScope.set(scope);
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
    if (scope === 'mine' && !this.linkedEmployeeId()) {
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

  ngOnInit(): void {
    this.yearSig.set(this.workspace.year());
    this.monthSig.set(this.workspace.month());
    this.loadScheduleView();
    this.loadNextMotorSummary();
    this.refreshSub = this.scheduleRefresh.changes$.subscribe(() => this.loadScheduleView());
  }

  loadNextMotorSummary(): void {
    this.nextMotorConfig.getConfig().subscribe({
      next: (data) => {
        const turnosFromShifts = (data.paoShiftParams ?? []).reduce(
          (sum, row) =>
            sum + (row.fields.find((f) => f.kind === 'meta_turnos')?.value ?? 0),
          0,
        );
        const turnos = turnosFromShifts > 0 ? turnosFromShifts : 20;
        const dias = data.params.find((p) => p.id === 'pao_meta_dias_trabalhados')?.value ?? 20;
        this.nextMotorSummary.set({
          enabledCount: data.enabledCount,
          totalCount: data.totalCount,
          scopeMode: data.scopeMode,
          scopeSelectedCount: data.scopeSelectedCount,
          paoMetaTurnos: turnos,
          paoMetaDias: dias,
          allowedShiftCodes: data.allowedShiftCodes ?? [],
        });
      },
      error: () => {
        this.nextMotorSummary.set(null);
      },
    });
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
  }

  generateWithNextMotor(preferencesOnly = false): void {
    const summary = this.nextMotorSummary();
    if (summary?.scopeMode === 'selected' && summary.scopeSelectedCount === 0) {
      this.messages.add({
        severity: 'warn',
        summary: 'Escopo vazio',
        detail: 'Selecione ao menos um funcionário em Configurações → Motor de Escala.',
      });
      return;
    }
    if (summary && summary.allowedShiftCodes.length === 0) {
      this.messages.add({
        severity: 'warn',
        summary: 'Nenhum turno habilitado',
        detail: 'Marque ao menos um turno em Configurações → Motor de Escala.',
      });
      return;
    }
    const y = this.yearSig();
    const m = this.monthSig();
    const confirmMsg = preferencesOnly
      ? `Gerar só preferências (sem preencher furos) para ${String(m).padStart(2, '0')}/${y}? ` +
        'Aloca turno a turno por senioridade e deixa os gaps abertos para você fechar manualmente. ' +
        'A geração anterior do mês será substituída (férias e folgas pedidas permanecem).'
      : `Gerar escala automática para ${String(m).padStart(2, '0')}/${y}? ` +
        'A geração anterior do mês será substituída (férias e folgas pedidas permanecem).';
    if (!window.confirm(confirmMsg)) {
      return;
    }
    const loadingSig = preferencesOnly ? this.generatingPreferencesOnly : this.generatingNextMotor;
    loadingSig.set(true);
    this.publishBlocked.set(null);
    this.generationBlocked.set(null);
    this.publishResult.set(null);
    this.scheduleService.generateSchedule(y, m, preferencesOnly).subscribe({
      next: (result) => {
        loadingSig.set(false);
        this.generationBlocked.set(null);
        const gaps = result.summary?.['coverageGaps'] ?? result.summary?.['coverageMissingCount'];
        const detail =
          `${result.assignmentsCreated} turno(s), ${result.allocationsCreated} alocação(ões).` +
          (typeof gaps === 'number' && gaps > 0
            ? ` ${gaps} furo(s)${preferencesOnly ? ' para alocar manualmente.' : ' de cobertura.'}`
            : '');
        this.messages.add({
          severity: result.success ? 'success' : 'warn',
          summary: preferencesOnly
            ? 'Preferências alocadas'
            : result.success
              ? 'Escala gerada'
              : 'Escala gerada com pendências',
          detail,
        });
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        loadingSig.set(false);
        const body = err.error as {
          error?: string;
          code?: string;
          validation?: GenerationPersistenceValidation;
        };
        const validation = body?.validation;
        if (err.status === 422 && validation?.issues?.length) {
          this.generationBlocked.set(validation);
          const summary = summarizeGenerationPersistenceIssues(validation.issues);
          this.messages.add({
            severity: 'error',
            summary: 'Geração não salva',
            detail: summary,
            life: 12000,
          });
          return;
        }
        const msg = body?.error ?? err.message ?? 'Erro ao gerar escala';
        this.messages.add({ severity: 'error', summary: 'Motor automático', detail: msg });
      },
    });
  }

  generateFlights(): void {
    const id = this.activeScheduleMonthId();
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
    const id = this.activeScheduleMonthId();
    if (!id) return;
    if (
      !window.confirm(
        'Remover toda a geração deste mês (turnos, ND, folgas sociais, folgas comuns, voos)? Férias, folgas pedidas (FP) e folgas APAO solicitadas/aprovadas no portal não são alteradas.',
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
    const id = this.activeScheduleMonthId();
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
        // Publicação habilita Realizada — abre nela na próxima carga.
        this.executedDefaultPeriodKey = null;
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.publishing.set(false);
        const msg = err.error?.message ?? err.error?.error ?? 'Erro ao publicar';
        this.publishBlocked.set({ message: msg });
        this.messages.add({ severity: 'error', summary: 'Publicação', detail: msg });
      },
    });
  }

  unpublish(): void {
    const id = this.activeScheduleMonthId();
    if (!id) return;
    this.unpublishing.set(true);
    this.publishBlocked.set(null);
    this.publishResult.set(null);
    this.scheduleService.unpublishSchedule(id).subscribe({
      next: (res) => {
        this.unpublishing.set(false);
        this.messages.add({
          severity: 'success',
          summary: 'Despublicado',
          detail: `Escala ${res.month}/${res.year} voltou para edição (${res.status}).`,
        });
        if (this.isExecutedView()) {
          this.scheduleView.set('planned');
          this.executedScheduleData.set(null);
        }
        this.loadScheduleView();
      },
      error: (err: HttpErrorResponse) => {
        this.unpublishing.set(false);
        const msg = err.error?.message ?? err.error?.error ?? 'Erro ao despublicar';
        this.publishBlocked.set({ message: msg });
        this.messages.add({ severity: 'error', summary: 'Despublicar', detail: msg });
      },
    });
  }

  onSelectionCompleted(selection: GridSelectionComplete): void {
    this.pendingSelection = selection;
    const emp = this.scheduleData()?.employees.find((e) => e.id === selection.employeeId);
    const employeeType =
      emp?.cargoCode ?? emp?.type ?? selection.employeeType;
    this.allocationContext.set({
      employeeName: selection.employeeName,
      employeeType,
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
    const monthId = this.activeScheduleMonthId();
    if (!selection || !monthId) return;

    const ranges = groupContiguousDays(selection.days);
    const year = this.yearSig();
    const month = this.monthSig();

    this.manualEditing.set(true);
    this.deletePopupVisible.set(false);

    from(ranges)
      .pipe(
        concatMap((range) =>
          this.manualEditRangeRequest(monthId, {
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
    const monthId = this.activeScheduleMonthId();
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
          this.manualEditRangeRequest(monthId, {
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
    const monthId = this.activeScheduleMonthId();
    if (!monthId) return;
    this.manualEditing.set(true);
    this.manualMoveRequest(monthId, {
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

    const applyGrid = () => {
      const grid = buildScheduleGrid({
        year: this.yearSig(),
        month: this.monthSig(),
        employees: res.employees,
        assignments: res.assignments,
        preAllocations: res.preAllocations,
        operationalCadastros: res.operationalCadastros,
        shifts: res.shifts,
      });
      this.exportService.prepareExportPayload(grid);
    };

    if (this.isExecutedView()) {
      this.executedScheduleData.set({
        scheduleMonth: res.scheduleMonth,
        employees: res.employees,
        shifts: res.shifts,
        assignments: res.assignments,
        preAllocations: res.preAllocations,
        operationalCadastros: res.operationalCadastros,
      });
      applyGrid();
      this.messages.add({
        severity: 'success',
        summary: 'Escala Realizada',
        detail,
        life: 4000,
      });
      return;
    }

    this.workspace.lastGeneration.set(null);
    this.syncWorkspacePeriod();
    // Usa o payload do PATCH — evita segundo GET /schedules e flash de loading.
    this.scheduleData.set({
      scheduleMonth: res.scheduleMonth,
      employees: res.employees,
      shifts: res.shifts,
      assignments: res.assignments,
      preAllocations: res.preAllocations,
      operationalCadastros: res.operationalCadastros,
    });
    this.workspace.scheduleMonthId.set(res.scheduleMonth.id);
    applyGrid();
    this.messages.add({ severity: 'success', summary: 'Escala', detail, life: 4000 });
  }

  private syncWorkspacePeriod(): void {
    this.workspace.year.set(this.yearSig());
    this.workspace.month.set(this.monthSig());
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
    this.syncWorkspacePeriod();
    this.loadingView.set(true);
    this.scheduleService.getSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (data) => {
        this.loadingView.set(false);
        this.scheduleData.set(data);
        this.workspace.scheduleMonthId.set(data.scheduleMonth.id);
        const periodKey = `${this.yearSig()}-${this.monthSig()}`;
        const published = data.scheduleMonth.status === 'PUBLISHED';

        if (!published) {
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

        if (this.isExecutedView() && published) {
          this.loadExecutedScheduleView(false);
          return;
        }

        const grid = buildScheduleGrid({
          year: this.yearSig(),
          month: this.monthSig(),
          employees: data.employees,
          assignments: data.assignments,
          preAllocations: data.preAllocations,
          operationalCadastros: data.operationalCadastros,
          shifts: data.shifts,
        });
        this.exportService.prepareExportPayload(grid);
      },
      error: () => {
        this.loadingView.set(false);
        this.scheduleData.set(null);
        this.messages.add({
          severity: 'error',
          summary: 'Escala',
          detail: 'Falha ao carregar escala do mês.',
        });
      },
    });
  }

  loadExecutedScheduleView(showLoading = true): void {
    if (showLoading) this.loadingView.set(true);
    this.scheduleService.getExecutedSchedule(this.yearSig(), this.monthSig()).subscribe({
      next: (data) => {
        this.loadingView.set(false);
        this.executedScheduleData.set(data);
        const grid = buildScheduleGrid({
          year: this.yearSig(),
          month: this.monthSig(),
          employees: data.employees,
          assignments: data.assignments,
          preAllocations: data.preAllocations,
          operationalCadastros: data.operationalCadastros,
          shifts: data.shifts,
          shiftSwaps: data.shiftSwaps,
        });
        this.exportService.prepareExportPayload(grid);
      },
      error: () => {
        this.loadingView.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Escala Realizada',
          detail: 'Falha ao carregar escala realizada.',
        });
      },
    });
  }

  setScheduleView(mode: ScheduleViewMode): void {
    if (this.scheduleView() === mode) return;
    if (mode === 'executed' && !this.canViewExecutedSchedule()) {
      this.messages.add({
        severity: 'warn',
        summary: 'Escala Realizada',
        detail: 'Disponível somente após publicar a escala planejada.',
        life: 4000,
      });
      return;
    }
    this.scheduleView.set(mode);
    this.scheduleGrid?.clearSelection();
    if (mode === 'executed') {
      this.loadExecutedScheduleView();
      return;
    }
    const data = this.scheduleData();
    if (data) {
      const grid = buildScheduleGrid({
        year: this.yearSig(),
        month: this.monthSig(),
        employees: data.employees,
        assignments: data.assignments,
        preAllocations: data.preAllocations,
        operationalCadastros: data.operationalCadastros,
        shifts: data.shifts,
      });
      this.exportService.prepareExportPayload(grid);
    }
  }

  private manualEditRangeRequest(
    monthId: string,
    payload: Parameters<ScheduleService['manualEditRange']>[1],
  ) {
    return this.isExecutedView()
      ? this.scheduleService.executedManualEditRange(monthId, payload)
      : this.scheduleService.manualEditRange(monthId, payload);
  }

  private manualMoveRequest(
    monthId: string,
    payload: Parameters<ScheduleService['manualMove']>[1],
  ) {
    return this.isExecutedView()
      ? this.scheduleService.executedManualMove(monthId, payload)
      : this.scheduleService.manualMove(monthId, payload);
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

  onPendingCellClicked(event: GridCellClickEvent): void {
    // Troca de turno: aprovação só na escala realizada.
    if (this.isExecutedView()) {
      const swap = event.cell.shiftSwap;
      if (!swap) return;
      const y = this.yearSig();
      const m = this.monthSig();
      const dateIso = `${y}-${String(m).padStart(2, '0')}-${String(event.day).padStart(2, '0')}`;
      const mode =
        swap.status === 'AWAITING_ADMIN' ? 'admin_approve' : 'awaiting_peer';
      this.swapDialogContext.set({
        mode,
        kind: swap.counterpartName === 'sua escala' ? 'SELF' : 'PEER',
        day: event.day,
        dateIso: swap.sourceDate || dateIso,
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

    const pendingType = portalPendingTypeFromCell(event.cell);
    if (!pendingType) return;

    const y = this.yearSig();
    const m = this.monthSig();
    const dateIso = `${y}-${String(m).padStart(2, '0')}-${String(event.day).padStart(2, '0')}`;

    this.approvalDialogContext.set({
      day: event.day,
      dateIso,
      employeeId: event.employeeId,
      employeeName: event.employeeName,
      type: pendingType,
      typeLabel: portalPendingRequestLabel(pendingType),
    });
    this.approvalDialogVisible.set(true);
  }

  onSwapDialogVisibleChange(visible: boolean): void {
    this.swapDialogVisible.set(visible);
    if (!visible) this.swapDialogContext.set(null);
  }

  approveShiftSwap(): void {
    const id = this.swapDialogContext()?.swapId;
    if (!id) return;
    this.processingSwap.set(true);
    this.shiftSwapService.approve(id).subscribe({
      next: () => {
        this.processingSwap.set(false);
        this.swapDialogVisible.set(false);
        this.swapDialogContext.set(null);
        this.messages.add({
          severity: 'success',
          summary: 'Troca aprovada',
          detail: 'Os turnos foram trocados na escala.',
        });
        this.loadScheduleView();
      },
      error: (err: { error?: { error?: string } }) => {
        this.processingSwap.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível aprovar a troca.',
        });
      },
    });
  }

  rejectShiftSwap(): void {
    const id = this.swapDialogContext()?.swapId;
    if (!id) return;
    this.processingSwap.set(true);
    this.shiftSwapService.rejectByAdmin(id).subscribe({
      next: () => {
        this.processingSwap.set(false);
        this.swapDialogVisible.set(false);
        this.swapDialogContext.set(null);
        this.messages.add({ severity: 'info', summary: 'Troca rejeitada' });
        this.loadScheduleView();
      },
      error: (err: { error?: { error?: string } }) => {
        this.processingSwap.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível rejeitar a troca.',
        });
      },
    });
  }

  onApprovalDialogVisibleChange(visible: boolean): void {
    this.approvalDialogVisible.set(visible);
    if (!visible) this.approvalDialogContext.set(null);
  }

  approvePendingRequest(): void {
    const ctx = this.approvalDialogContext();
    if (!ctx) return;

    this.processingApproval.set(true);
    this.portalService
      .approveRequest({
        employeeId: ctx.employeeId,
        year: this.yearSig(),
        month: this.monthSig(),
        date: ctx.dateIso,
        type: ctx.type,
      })
      .subscribe({
        next: () => {
          this.processingApproval.set(false);
          this.approvalDialogVisible.set(false);
          this.approvalDialogContext.set(null);
          this.messages.add({
            severity: 'success',
            summary: 'Solicitação aprovada',
            detail: `${ctx.typeLabel} registrada para ${ctx.employeeName}.`,
          });
          this.loadScheduleView();
          this.scheduleRefresh.notify();
        },
        error: (err: { error?: { error?: string } }) => {
          this.processingApproval.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Não foi possível aprovar a solicitação.',
          });
        },
      });
  }

  rejectPendingRequest(): void {
    const ctx = this.approvalDialogContext();
    if (!ctx) return;

    this.processingApproval.set(true);
    this.portalService
      .rejectRequest({
        employeeId: ctx.employeeId,
        year: this.yearSig(),
        month: this.monthSig(),
        date: ctx.dateIso,
        type: ctx.type,
      })
      .subscribe({
        next: () => {
          this.processingApproval.set(false);
          this.approvalDialogVisible.set(false);
          this.approvalDialogContext.set(null);
          this.messages.add({
            severity: 'info',
            summary: 'Solicitação rejeitada',
            detail: `A solicitação de ${ctx.employeeName} foi removida.`,
          });
          this.loadScheduleView();
          this.scheduleRefresh.notify();
        },
        error: (err: { error?: { error?: string } }) => {
          this.processingApproval.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Erro',
            detail: err.error?.error ?? 'Não foi possível rejeitar a solicitação.',
          });
        },
      });
  }
}
