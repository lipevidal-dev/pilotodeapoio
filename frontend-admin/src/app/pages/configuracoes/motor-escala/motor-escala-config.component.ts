import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';

import { RouterLink } from '@angular/router';

import { CardModule } from 'primeng/card';

import { ButtonModule } from 'primeng/button';

import { CheckboxModule } from 'primeng/checkbox';

import { InputNumberModule } from 'primeng/inputnumber';

import { SelectModule } from 'primeng/select';

import { TagModule } from 'primeng/tag';

import { MessageModule } from 'primeng/message';

import { MessageService } from 'primeng/api';

import { NextMotorConfigService } from '../../../services/next-motor-config.service';

import { EmployeeService } from '../../../services/employee.service';

import { ScheduleService } from '../../../services/schedule.service';

import { ScheduleWorkspaceService } from '../../../services/schedule-workspace.service';

import { ShiftService } from '../../../services/shift.service';

import type {
  Employee,
  EmployeeMotorPref,
  NextMotorParamRow,
  NextMotorRuleCategory,
  NextMotorRuleRow,
  PaoShiftParamFieldRow,
  PaoShiftParamsRow,
  PaoShiftRuleFieldRow,
  ScheduleMonthResponse,
  Shift,
} from '../../../models/api.models';
import {
  isRateioShiftCode,
  RATEIO_SHIFT_ORDER,
  type RateioShiftCode,
} from '../../../utils/shift-code.util';
import {
  buildScopeProjectionSummary,
  formatEmployeeProjection,
  formatScopeSummary,
  projectEmployeeMotor,
  type EmployeeMotorProjection,
} from '../../../utils/next-motor-projection.util';
import {
  PAO_SHIFT_PARAM_KINDS,
  paoShiftParamId,
  shiftParamDefaultValue,
  type PaoShiftParamKind,
} from '../../../utils/pao-shift-params.util';
import {
  computePaoDayBudget,
  toPaoDayBudgetCompact,
  type PaoDayBudget,
  type PaoDayBudgetCompact,
} from '../../../utils/pao-day-budget.util';

/** Regras PAO exibidas na matriz por turno — não repetir no bloco global. */
const PAO_RULES_IN_SHIFT_CARDS = new Set([
  'pao_meta_turnos',
  'pao_espacamento_turnos',
  'pao_meta_dias_trabalhados',
  'pao_10_folgas',
  'pao_1_folga_social',
  't8_t8_nd',
]);

/** Linhas de toggle na matriz PAO (colunas = turnos). */
const PAO_SHIFT_RULE_MATRIX: Array<{ id: string; label: string; shiftCodes?: RateioShiftCode[] }> = [
  { id: 'pao_meta_turnos', label: 'Meta de turnos' },
  { id: 'pao_espacamento_turnos', label: 'Espaçamento entre turnos' },
  { id: 'pao_meta_dias_trabalhados', label: 'Meta de dias trabalhados' },
  { id: 'pao_10_folgas', label: '10 folgas' },
  { id: 'pao_1_folga_social', label: '1 folga social' },
  { id: 't8_t8_nd', label: 'T8, T8, ND', shiftCodes: ['T8'] },
];

const FCF_WEEKDAY_OPTIONS = [
  { label: 'Segunda', value: 1 },
  { label: 'Terça', value: 2 },
  { label: 'Quarta', value: 3 },
  { label: 'Quinta', value: 4 },
  { label: 'Sexta', value: 5 },
  { label: 'Sábado', value: 6 },
  { label: 'Domingo', value: 0 },
];



@Component({

  selector: 'app-motor-escala-config',

  standalone: true,

  imports: [

    CommonModule,

    FormsModule,

    RouterLink,

    CardModule,

    ButtonModule,

    CheckboxModule,

    InputNumberModule,

    SelectModule,

    TagModule,

    MessageModule,

  ],

  templateUrl: './motor-escala-config.component.html',

  styleUrl: './motor-escala-config.component.scss',

})

export class MotorEscalaConfigComponent implements OnInit {

  private readonly configService = inject(NextMotorConfigService);

  private readonly employeeService = inject(EmployeeService);

  private readonly scheduleService = inject(ScheduleService);

  private readonly scheduleWorkspace = inject(ScheduleWorkspaceService);

  private readonly shiftService = inject(ShiftService);

  private readonly messages = inject(MessageService);



  readonly loading = signal(true);

  readonly saving = signal(false);

  readonly motorLabel = signal('Motor automático');

  readonly ready = signal(false);

  readonly enabledCount = signal(0);

  readonly totalCount = signal(0);

  readonly rules = signal<NextMotorRuleRow[]>([]);

  readonly params = signal<NextMotorParamRow[]>([]);

  readonly paoShiftParams = signal<PaoShiftParamsRow[]>([]);

  readonly categoryLabels = signal<Record<string, string>>({});

  readonly employees = signal<Employee[]>([]);

  readonly scheduleMonthData = signal<ScheduleMonthResponse | null>(null);

  readonly scheduleMonthLoading = signal(false);

  readonly shifts = signal<Shift[]>([]);

  private readonly enabledDraft = signal<Record<string, boolean>>({});

  private readonly paramsDraft = signal<Record<string, number>>({});

  private readonly employeePrefsDraft = signal<Record<string, EmployeeMotorPref>>({});

  readonly scopeAllDraft = signal(true);

  private readonly scopeSelectedDraft = signal<Set<string>>(new Set());

  private savedScopeAll = true;

  private savedScopeSelected = new Set<string>();

  private savedEmployeePrefs: Record<string, EmployeeMotorPref> = {};

  private savedAllowedShiftCodes = new Set<string>();

  readonly allowedShiftsDraft = signal<Set<string>>(new Set());

  readonly groupedRules = computed(() => {

    const labels = this.categoryLabels();

    const groups = new Map<NextMotorRuleCategory, NextMotorRuleRow[]>();

    for (const rule of this.rules()) {
      if (rule.category === 'pao' && PAO_RULES_IN_SHIFT_CARDS.has(rule.id)) continue;
      const list = groups.get(rule.category) ?? [];

      list.push(rule);

      groups.set(rule.category, list);

    }

    return [...groups.entries()]
      .filter(([, items]) => items.length > 0)
      .map(([category, items]) => ({

      category,

      label: labels[category] ?? category,

      items,

    }));

  });



  readonly groupedParams = computed(() => {

    const labels = this.categoryLabels();

    const groups = new Map<NextMotorRuleCategory, NextMotorParamRow[]>();

    for (const param of this.params()) {

      const list = groups.get(param.category) ?? [];

      list.push(param);

      groups.set(param.category, list);

    }

    return [...groups.entries()].map(([category, items]) => ({

      category,

      label: labels[category] ?? category,

      items,

    }));

  });

  readonly effectivePaoShiftParams = computed((): PaoShiftParamsRow[] => {
    const fromApi = this.paoShiftParams();
    if (fromApi.length > 0) return fromApi;
    return this.rateioShiftOptions().map((shift) => ({
      shiftCode: shift.code,
      shiftName: shift.label,
      fields: PAO_SHIFT_PARAM_KINDS.map((kind) => this.buildLocalShiftField(kind, shift.code)),
      rules: [],
    }));
  });

  readonly paoShiftColumns = computed(() =>
    this.effectivePaoShiftParams().map((group) => ({
      code: group.shiftCode,
      name: group.shiftName,
    })),
  );

  readonly paoParamMatrixRows = computed(() =>
    PAO_SHIFT_PARAM_KINDS.map((kind) => {
      const sample =
        this.effectivePaoShiftParams()
          .flatMap((group) => group.fields)
          .find((field) => field.kind === kind) ?? this.buildLocalShiftField(kind, 'T6');
      return { kind, label: sample.label };
    }),
  );

  readonly paoRuleMatrixRows = computed(() => PAO_SHIFT_RULE_MATRIX);

  readonly scopeSummary = computed(() => {
    if (this.scopeAllDraft()) return 'Todos os funcionários ativos';
    const n = this.scopeSelectedDraft().size;
    return n === 0 ? 'Nenhum funcionário selecionado' : `${n} funcionário(s) selecionado(s)`;
  });

  readonly previewMonth = computed(() => ({
    year: this.scheduleWorkspace.year(),
    month: this.scheduleWorkspace.month(),
  }));

  private readonly projectionInput = computed(() => ({
    enabled: this.enabledDraft(),
    params: this.paramsDraft(),
    rateioShiftCodes: this.rateioShiftOptions().map((s) => s.code),
    ...this.previewMonth(),
  }));

  readonly scopedEmployees = computed(() => {
    const emps = this.employees();
    if (this.scopeAllDraft()) return emps;
    const sel = this.scopeSelectedDraft();
    return emps.filter((e) => sel.has(e.id));
  });

  private preferredShiftCodeFor(emp: Employee): string | null {
    const pref = this.effectiveEmployeePref(emp);
    if (!pref.preferredShiftId) return null;
    return this.shifts().find((s) => s.id === pref.preferredShiftId)?.code?.toUpperCase() ?? null;
  }

  readonly scopeProjectionSummaryText = computed(() => {
    const rows = this.scopedEmployees().map((emp) => ({
      role: this.employeeRoleKind(emp),
      projection: projectEmployeeMotor(emp, this.projectionInput(), this.preferredShiftCodeFor(emp)),
    }));
    const summary = buildScopeProjectionSummary(rows, this.previewMonth().year, this.previewMonth().month);
    return summary ? formatScopeSummary(summary) : null;
  });

  readonly rateioShiftOptions = computed(() =>
    this.shifts()
      .filter((s) => s.active && isRateioShiftCode(s.code))
      .map((s) => ({
        label: s.code.toUpperCase(),
        value: s.id,
        code: s.code.toUpperCase() as RateioShiftCode,
      }))
      .sort((a, b) => (RATEIO_SHIFT_ORDER.get(a.code) ?? 99) - (RATEIO_SHIFT_ORDER.get(b.code) ?? 99)),
  );

  readonly fcfWeekdayOptions = FCF_WEEKDAY_OPTIONS;

  readonly allowedShiftsSummary = computed(() => {
    const selected = [...this.allowedShiftsDraft()].sort();
    if (selected.length === 0) return 'Nenhum turno selecionado';
    return selected.join(', ');
  });

  readonly canSave = computed(() => this.dirty() && this.allowedShiftsDraft().size > 0);

  readonly dirty = computed(() => {

    const draft = this.enabledDraft();

    const paramsDraft = this.paramsDraft();

    if (this.rules().some((r) => draft[r.id] !== r.enabled)) return true;

    if (this.params().some((p) => paramsDraft[p.id] !== p.value)) return true;

    if (this.paoShiftParams().some((group) => {
      for (const field of group.fields) {
        const draft = paramsDraft[field.id] ?? field.value;
        if (draft !== field.value) return true;
      }
      return false;
    })) return true;

    if (this.scopeAllDraft() !== this.savedScopeAll) return true;

    if (!this.scopeAllDraft()) {

      const saved = this.savedScopeSelected;

      const current = this.scopeSelectedDraft();

      if (saved.size !== current.size) return true;

      for (const id of saved) {

        if (!current.has(id)) return true;

      }

    }

    if (this.employeePrefsDirty()) return true;

    if (!this.allowedShiftsDraftEqual(this.allowedShiftsDraft(), this.savedAllowedShiftCodes)) return true;

    return false;

  });



  ngOnInit(): void {

    this.load();

    this.loadScheduleMonth();

    this.loadShifts();

  }



  loadShifts(): void {

    this.shiftService.list(true).subscribe({

      next: (rows) => this.shifts.set(rows),

      error: () => this.shifts.set([]),

    });

  }



  load(): void {

    this.loading.set(true);

    this.employeeService.list().subscribe({

      next: (emps) => {
        this.employees.set(emps.filter((e) => e.active));
      },

      error: () => this.employees.set([]),

    });

    this.configService.getConfig().subscribe({

      next: (data) => {

        this.motorLabel.set(data.motorLabel);

        this.ready.set(data.ready);

        this.enabledCount.set(data.enabledCount);

        this.totalCount.set(data.totalCount);

        this.rules.set(data.rules);

        this.params.set(data.params);

        this.paoShiftParams.set(data.paoShiftParams ?? []);

        const labels: Record<string, string> = {};

        for (const c of data.categories) labels[c.id] = c.label;

        this.categoryLabels.set(labels);

        this.syncDraft(data);

        this.loading.set(false);

      },

      error: () => {

        this.loading.set(false);

        this.messages.add({

          severity: 'error',

          summary: 'Motor',

          detail: 'Não foi possível carregar as regras do motor.',

        });

      },

    });

  }



  isEnabled(ruleId: string): boolean {

    return this.enabledDraft()[ruleId] ?? false;

  }



  isRuleEnabledForParam(ruleId: string): boolean {

    return this.enabledDraft()[ruleId] ?? false;

  }

  isShiftRuleEnabled(shiftCode: string, ruleId: string): boolean {
    const perShiftId = `pao_shift_rule__${ruleId}__${shiftCode.toUpperCase()}`;
    const draft = this.enabledDraft();
    if (typeof draft[perShiftId] === 'boolean') return draft[perShiftId];
    return draft[ruleId] ?? false;
  }

  onToggleShiftRule(rule: PaoShiftRuleFieldRow, checked: boolean): void {
    if (rule.locked) return;
    this.enabledDraft.update((d) => ({ ...d, [rule.id]: checked }));
  }

  shiftParamField(shiftCode: string, kind: PaoShiftParamKind): PaoShiftParamFieldRow | null {
    const group = this.effectivePaoShiftParams().find((row) => row.shiftCode === shiftCode);
    return group?.fields.find((field) => field.kind === kind) ?? null;
  }

  shiftRuleField(shiftCode: string, globalRuleId: string): PaoShiftRuleFieldRow | null {
    const group = this.effectivePaoShiftParams().find((row) => row.shiftCode === shiftCode);
    return group?.rules.find((rule) => rule.globalRuleId === globalRuleId) ?? null;
  }

  ruleVisibleForShift(ruleId: string, shiftCode: string, onlyShifts?: RateioShiftCode[]): boolean {
    if (!onlyShifts || onlyShifts.length === 0) return true;
    return onlyShifts.includes(shiftCode.toUpperCase() as RateioShiftCode);
  }



  paramValue(paramId: string): number {

    return this.paramsDraft()[paramId] ?? 0;

  }



  onToggle(rule: NextMotorRuleRow, checked: boolean): void {

    if (rule.locked) return;

    this.enabledDraft.update((d) => ({ ...d, [rule.id]: checked }));

  }



  onShiftParamChange(field: PaoShiftParamFieldRow, value: number | null): void {

    if (value == null || !Number.isFinite(value)) return;

    const clamped = Math.min(field.max, Math.max(field.min, Math.round(value)));

    this.paramsDraft.update((d) => ({ ...d, [field.id]: clamped }));

  }



  onParamChange(param: NextMotorParamRow, value: number | null): void {

    if (value == null || !Number.isFinite(value)) return;

    const clamped = Math.min(param.max, Math.max(param.min, Math.round(value)));

    this.paramsDraft.update((d) => ({ ...d, [param.id]: clamped }));

  }



  isEmployeeInScope(employeeId: string): boolean {

    if (this.scopeAllDraft()) return true;

    return this.scopeSelectedDraft().has(employeeId);

  }



  onScopeAllChange(all: boolean): void {

    this.scopeAllDraft.set(all);

    if (all) return;

    if (this.scopeSelectedDraft().size === 0) {

      this.scopeSelectedDraft.set(new Set(this.employees().map((e) => e.id)));

    }

  }



  onEmployeeScopeToggle(employeeId: string, checked: boolean): void {

    this.scopeAllDraft.set(false);

    this.scopeSelectedDraft.update((set) => {

      const next = new Set(set);

      if (checked) next.add(employeeId);

      else next.delete(employeeId);

      return next;

    });

  }



  selectAllEmployees(): void {

    this.scopeAllDraft.set(false);

    this.scopeSelectedDraft.set(new Set(this.employees().map((e) => e.id)));

  }



  clearEmployeeSelection(): void {

    this.scopeAllDraft.set(false);

    this.scopeSelectedDraft.set(new Set());

  }

  isAllowedShiftSelected(code: string): boolean {
    return this.allowedShiftsDraft().has(code.toUpperCase());
  }

  toggleAllowedShift(code: string, checked: boolean): void {
    const normalized = code.toUpperCase();
    this.allowedShiftsDraft.update((current) => {
      const next = new Set(current);
      if (checked) next.add(normalized);
      else next.delete(normalized);
      return next;
    });
  }

  selectAllAllowedShifts(): void {
    this.allowedShiftsDraft.set(new Set(this.rateioShiftOptions().map((s) => s.code)));
  }

  private allowedShiftsDraftEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const code of a) {
      if (!b.has(code)) return false;
    }
    return true;
  }



  save(): void {

    this.saving.set(true);

    const payload: {

      enabled: Record<string, boolean>;

      params: Record<string, number>;

      scopeEmployeeIds: string[] | null;

      employeePrefs?: Record<string, EmployeeMotorPref>;

      allowedShiftCodes?: string[] | null;

    } = {

      enabled: { ...this.enabledDraft() },

      params: { ...this.paramsDraft() },

      scopeEmployeeIds: this.scopeAllDraft() ? null : [...this.scopeSelectedDraft()],

      employeePrefs: { ...this.employeePrefsDraft() },

      allowedShiftCodes: [...this.allowedShiftsDraft()].sort(),

    };

    this.configService.updateRules(payload).subscribe({

      next: (data) => {

        this.rules.set(data.rules);

        this.params.set(data.params);

        this.paoShiftParams.set(data.paoShiftParams ?? []);

        this.enabledCount.set(data.enabledCount);

        this.totalCount.set(data.totalCount);

        this.syncDraft(data);

        this.saving.set(false);

        this.messages.add({

          severity: 'success',

          summary: 'Configuração salva',

          detail: `${data.enabledCount} regras ativas · ${this.scopeSummary()}`,

        });

      },

      error: () => {

        this.saving.set(false);

        this.messages.add({

          severity: 'error',

          summary: 'Salvar',

          detail: 'Falha ao salvar configuração do motor.',

        });

      },

    });

  }



  resetDraft(): void {

    this.syncDraft({

      rules: this.rules(),

      params: this.params(),

      paoShiftParams: this.paoShiftParams(),

      scopeEmployeeIds: this.savedScopeAll ? null : [...this.savedScopeSelected],

      employeePrefs: { ...this.savedEmployeePrefs },

      allowedShiftCodes: [...this.savedAllowedShiftCodes],

    });

  }



  employeeTypeLabel(type: string): string {
    return type?.toUpperCase() === 'APAO' ? 'APAO' : 'PAO';
  }

  employeeProjection(emp: Employee): EmployeeMotorProjection {
    return projectEmployeeMotor(emp, this.projectionInput(), this.preferredShiftCodeFor(emp));
  }

  employeeProjectionLabel(emp: Employee): string {
    return formatEmployeeProjection(this.employeeProjection(emp));
  }

  employeeDayBudget(emp: Employee): PaoDayBudget | null {
    if (!this.isEmployeeInScope(emp.id) || this.employeeRoleKind(emp) !== 'PAO') return null;
    return computePaoDayBudget(
      emp,
      this.projectionInput(),
      this.scheduleMonthData(),
      this.preferredShiftCodeFor(emp),
    );
  }

  employeeDayBudgetCompact(emp: Employee): PaoDayBudgetCompact | null {
    const budget = this.employeeDayBudget(emp);
    return budget ? toPaoDayBudgetCompact(budget) : null;
  }

  employeeRoleKind(emp: Employee): 'PAO' | 'APAO' | 'OTHER' {
    const code = (emp.cargoCode ?? emp.type ?? '').toUpperCase();
    if (code === 'APAO') return 'APAO';
    if (code === 'PAO' || code === 'PAO FCF' || code.startsWith('PAO')) return 'PAO';
    return 'OTHER';
  }

  isEmployeePreferredShift(emp: Employee, shiftId: string): boolean {
    return this.effectiveEmployeePref(emp).preferredShiftId === shiftId;
  }

  onEmployeePreferredShiftChange(emp: Employee, shiftId: string, checked: boolean): void {
    const current = this.effectiveEmployeePref(emp);
    const preferredShiftId = checked ? shiftId : current.preferredShiftId === shiftId ? null : current.preferredShiftId;
    this.patchEmployeePref(emp.id, {
      preferredShiftId,
      restrictedShiftIds: preferredShiftId
        ? current.restrictedShiftIds.filter((id) => id !== preferredShiftId)
        : current.restrictedShiftIds,
      fcfPriorityShiftId: current.fcfPriorityShiftId,
      fcfWeekday: current.fcfWeekday,
    });
  }

  isEmployeeShiftAvoided(emp: Employee, shiftId: string): boolean {
    return this.effectiveEmployeePref(emp).restrictedShiftIds.includes(shiftId);
  }

  onEmployeeShiftAvoidedChange(emp: Employee, shiftId: string, checked: boolean): void {
    const current = this.effectiveEmployeePref(emp);
    const restricted = new Set(current.restrictedShiftIds);
    if (checked) restricted.add(shiftId);
    else restricted.delete(shiftId);
    let preferredShiftId = current.preferredShiftId;
    if (preferredShiftId && restricted.has(preferredShiftId)) preferredShiftId = null;
    this.patchEmployeePref(emp.id, {
      preferredShiftId,
      restrictedShiftIds: [...restricted],
      fcfPriorityShiftId: current.fcfPriorityShiftId,
      fcfWeekday: current.fcfWeekday,
    });
  }

  employeeFcfPriorityShiftId(emp: Employee): string | null {
    return this.effectiveEmployeePref(emp).fcfPriorityShiftId ?? this.defaultT9ShiftId();
  }

  employeeFcfWeekday(emp: Employee): number | null {
    return this.effectiveEmployeePref(emp).fcfWeekday ?? null;
  }

  onEmployeeFcfPriorityShiftChange(emp: Employee, shiftId: string | null): void {
    const current = this.effectiveEmployeePref(emp);
    this.patchEmployeePref(emp.id, {
      ...current,
      fcfPriorityShiftId: shiftId,
    });
  }

  onEmployeeFcfWeekdayChange(emp: Employee, weekday: number | null): void {
    const current = this.effectiveEmployeePref(emp);
    this.patchEmployeePref(emp.id, {
      ...current,
      fcfWeekday: weekday,
      fcfPriorityShiftId: current.fcfPriorityShiftId ?? this.defaultT9ShiftId(),
    });
  }

  private defaultT9ShiftId(): string | null {
    return this.rateioShiftOptions().find((s) => s.code === 'T9')?.value ?? null;
  }



  private loadScheduleMonth(): void {
    const { year, month } = this.previewMonth();
    this.scheduleMonthLoading.set(true);
    this.scheduleService.getSchedule(year, month).subscribe({
      next: (data) => {
        this.scheduleMonthData.set(data);
        this.scheduleMonthLoading.set(false);
      },
      error: () => {
        this.scheduleMonthData.set(null);
        this.scheduleMonthLoading.set(false);
      },
    });
  }

  private syncDraft(data: {

    rules: NextMotorRuleRow[];

    params: NextMotorParamRow[];

    paoShiftParams?: PaoShiftParamsRow[];

    scopeEmployeeIds: string[] | null;

    employeePrefs?: Record<string, EmployeeMotorPref>;

    allowedShiftCodes?: string[];

  }): void {

    const enabledDraft: Record<string, boolean> = {};

    for (const r of data.rules) enabledDraft[r.id] = r.enabled;

    for (const group of data.paoShiftParams ?? []) {
      for (const rule of group.rules) {
        enabledDraft[rule.id] = rule.enabled;
      }
    }

    this.enabledDraft.set(enabledDraft);



    const paramsDraft: Record<string, number> = {};

    for (const p of data.params) paramsDraft[p.id] = p.value;

    for (const group of data.paoShiftParams ?? []) {
      for (const field of group.fields) {
        paramsDraft[field.id] = field.value;
      }
    }

    this.paramsDraft.set(paramsDraft);



    const all = data.scopeEmployeeIds === null;

    this.scopeAllDraft.set(all);

    this.savedScopeAll = all;

    const selected = new Set(data.scopeEmployeeIds ?? []);

    this.scopeSelectedDraft.set(selected);

    this.savedScopeSelected = new Set(selected);

    const prefs = data.employeePrefs ?? {};

    this.employeePrefsDraft.set({ ...prefs });

    this.savedEmployeePrefs = { ...prefs };

    const allowed = new Set(
      (data.allowedShiftCodes ?? this.rateioShiftOptions().map((s) => s.code)).map((c) => c.toUpperCase()),
    );
    this.allowedShiftsDraft.set(new Set(allowed));
    this.savedAllowedShiftCodes = new Set(allowed);

  }

  private employeePrefsDirty(): boolean {
    const saved = this.savedEmployeePrefs;
    const draft = this.employeePrefsDraft();
    const keys = new Set([...Object.keys(saved), ...Object.keys(draft)]);
    for (const key of keys) {
      const a = draft[key];
      const b = saved[key];
      if (!a && !b) continue;
      if (!a || !b) return true;
      if (a.preferredShiftId !== b.preferredShiftId) return true;
      if ((a.fcfPriorityShiftId ?? null) !== (b.fcfPriorityShiftId ?? null)) return true;
      if ((a.fcfWeekday ?? null) !== (b.fcfWeekday ?? null)) return true;
      const ra = [...a.restrictedShiftIds].sort().join(',');
      const rb = [...b.restrictedShiftIds].sort().join(',');
      if (ra !== rb) return true;
    }
    return false;
  }

  private effectiveEmployeePref(emp: Employee): EmployeeMotorPref {
    const draft = this.employeePrefsDraft()[emp.id];
    if (draft) {
      return {
        preferredShiftId: draft.preferredShiftId,
        restrictedShiftIds: [...draft.restrictedShiftIds],
        fcfPriorityShiftId: draft.fcfPriorityShiftId ?? this.defaultT9ShiftId(),
        fcfWeekday: draft.fcfWeekday ?? null,
      };
    }
    return {
      preferredShiftId: emp.preferredShiftIds?.[0] ?? null,
      restrictedShiftIds: [...(emp.restrictedShiftIds ?? [])],
      fcfPriorityShiftId: this.defaultT9ShiftId(),
      fcfWeekday: null,
    };
  }

  private buildLocalShiftField(kind: PaoShiftParamKind, shiftCode: string): PaoShiftParamFieldRow {
    const id = paoShiftParamId(kind, shiftCode);
    const code = shiftCode.toUpperCase();
    const defaults: Record<PaoShiftParamKind, { label: string; ruleId: string; min: number; max: number }> = {
      agrupamento_turnos: { label: 'Agrupamento de turnos', ruleId: 'pao_espacamento_turnos', min: 1, max: 6 },
      meta_turnos: { label: 'Meta de turnos', ruleId: 'pao_meta_turnos', min: 0, max: 31 },
      espacamento: { label: 'Espaçamento entre turnos', ruleId: 'pao_espacamento_turnos', min: 0, max: 15 },
      meta_dias_trabalhados: { label: 'Meta de dias trabalhados', ruleId: 'pao_meta_dias_trabalhados', min: 0, max: 31 },
      meta_folgas: { label: 'Meta de folgas', ruleId: 'pao_10_folgas', min: 0, max: 31 },
      meta_folga_social: { label: 'Folgas sociais', ruleId: 'pao_1_folga_social', min: 0, max: 4 },
      max_consecutivos: { label: 'Máx. dias consecutivos', ruleId: 'max_6_consecutive', min: 1, max: 15 },
    };
    const def = defaults[kind];
    const isT8Agrupamento = kind === 'agrupamento_turnos' && code === 'T8';
    return {
      id,
      kind,
      label: def.label,
      description: '',
      ruleId: def.ruleId,
      value: this.paramsDraft()[id] ?? shiftParamDefaultValue(kind, shiftCode),
      min: def.min,
      max: def.max,
      locked: isT8Agrupamento,
      ...(isT8Agrupamento
        ? {
            inputMode: 't8_block_pattern' as const,
            displayHint: 'T8 · T8 · ND (1 bloco)',
          }
        : {}),
    };
  }

  private patchEmployeePref(employeeId: string, pref: EmployeeMotorPref): void {
    this.employeePrefsDraft.update((current) => ({
      ...current,
      [employeeId]: {
        preferredShiftId: pref.preferredShiftId,
        restrictedShiftIds: [...new Set(pref.restrictedShiftIds)],
        fcfPriorityShiftId: pref.fcfPriorityShiftId ?? null,
        fcfWeekday: pref.fcfWeekday ?? null,
      },
    }));
  }

}

