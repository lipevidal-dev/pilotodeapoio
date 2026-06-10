import type { EmployeeType, ManualAllocationType, Shift, ShiftRoleType } from '../models/api.models';

export interface AllocationSelectOption {
  key: ManualAllocationType;
  label: string;
}

const APAO_SHIFT_CODES = new Set(['T1', 'T2', 'T3', 'T4']);
const PAO_SHIFT_CODES = new Set(['T6', 'T7', 'T8', 'T9']);

const PAO_OPERATIONAL_OPTIONS: AllocationSelectOption[] = [
  { key: 'FOLGA', label: 'Folga' },
  { key: 'FP', label: 'Folga Pedida' },
  { key: 'VOO', label: 'VOO' },
  { key: 'CURSO', label: 'Curso' },
  { key: 'SIMULADOR', label: 'Simulador' },
  { key: 'CMA', label: 'CMA' },
  { key: 'OUTRO', label: 'Outro' },
  { key: 'ND', label: 'ND' },
];

const APAO_OPERATIONAL_OPTIONS: AllocationSelectOption[] = [
  { key: 'FOLGA', label: 'Folga' },
  { key: 'FP', label: 'Folga Pedida' },
  { key: 'ND', label: 'ND' },
];

const FALLBACK_PAO_SHIFT_OPTIONS: AllocationSelectOption[] = [
  { key: 'T6', label: 'T6' },
  { key: 'T7', label: 'T7' },
  { key: 'T8', label: 'T8' },
  { key: 'T8_BLOCK', label: 'T8 (bloco T8/T8/ND)' },
  { key: 'T9', label: 'Turno 9 PAO' },
];

const FALLBACK_APAO_SHIFT_OPTIONS: AllocationSelectOption[] = [
  { key: 'T1', label: 'Turno 1 APAO' },
  { key: 'T2', label: 'Turno 2 APAO' },
  { key: 'T3', label: 'Turno 3 APAO' },
  { key: 'T4', label: 'Turno 4 APAO' },
];

function sortShifts(a: Shift, b: Shift): number {
  return a.displayOrder - b.displayOrder || a.code.localeCompare(b.code);
}

function normalizeEmployeeType(type: EmployeeType | undefined | null): 'PAO' | 'APAO' | null {
  const upper = String(type ?? '').trim().toUpperCase();
  if (upper === 'PAO') return 'PAO';
  if (upper === 'APAO') return 'APAO';
  return null;
}

/** API legada envia `employeeTypeAllowed`; cadastro de turnos usa `roleType`. */
export function resolveShiftRoleType(shift: Shift): ShiftRoleType | null {
  const legacy = (shift as Shift & { employeeTypeAllowed?: string }).employeeTypeAllowed;
  const raw = shift.roleType ?? legacy;
  if (raw === 'PAO' || raw === 'APAO' || raw === 'BOTH') return raw;

  const code = shift.code.trim().toUpperCase();
  if (APAO_SHIFT_CODES.has(code)) return 'APAO';
  if (PAO_SHIFT_CODES.has(code)) return 'PAO';
  return null;
}

/** Turno disponível para o cargo do funcionário (PAO, APAO ou BOTH). */
export function shiftMatchesEmployeeType(shift: Shift, employeeType: EmployeeType): boolean {
  if (!shift.active) return false;
  const role = resolveShiftRoleType(shift);
  const cargo = normalizeEmployeeType(employeeType);
  if (!role || !cargo) return false;
  if (role === 'BOTH') return true;
  return role === cargo;
}

function shiftCodeToOption(shift: Shift): AllocationSelectOption {
  const code = shift.code.toUpperCase();
  const label = shift.name?.trim() || code;
  return { key: code as ManualAllocationType, label };
}

function operationalOptionsFor(employeeType: EmployeeType): AllocationSelectOption[] {
  return normalizeEmployeeType(employeeType) === 'APAO'
    ? APAO_OPERATIONAL_OPTIONS
    : PAO_OPERATIONAL_OPTIONS;
}

function fallbackShiftOptionsFor(employeeType: EmployeeType): AllocationSelectOption[] {
  return normalizeEmployeeType(employeeType) === 'APAO'
    ? FALLBACK_APAO_SHIFT_OPTIONS
    : FALLBACK_PAO_SHIFT_OPTIONS;
}

/** Monta opções do popup conforme cargo do funcionário + turnos ativos compatíveis. */
export function buildManualAllocationOptions(
  shifts: Shift[],
  employeeType: EmployeeType,
): AllocationSelectOption[] {
  const activeShifts = shifts.filter((s) => shiftMatchesEmployeeType(s, employeeType)).sort(sortShifts);

  const shiftOptions: AllocationSelectOption[] = [];

  if (activeShifts.length === 0) {
    shiftOptions.push(...fallbackShiftOptionsFor(employeeType));
  } else {
    for (const shift of activeShifts) {
      shiftOptions.push(shiftCodeToOption(shift));
      if (
        normalizeEmployeeType(employeeType) === 'PAO' &&
        shift.code.toUpperCase() === 'T8' &&
        shift.requiresT8PairNd
      ) {
        shiftOptions.push({ key: 'T8_BLOCK', label: 'T8 (bloco T8/T8/ND)' });
      }
    }
  }

  return [
    ...shiftOptions,
    ...operationalOptionsFor(employeeType),
    { key: 'CLEAR', label: 'Limpar período' },
  ];
}
