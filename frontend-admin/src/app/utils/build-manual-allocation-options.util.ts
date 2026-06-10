import type { ManualAllocationType, Shift } from '../models/api.models';

export interface AllocationSelectOption {
  key: ManualAllocationType;
  label: string;
}

const OPERATIONAL_OPTIONS: AllocationSelectOption[] = [
  { key: 'FOLGA', label: 'Folga' },
  { key: 'FP', label: 'Folga Pedida' },
  { key: 'VOO', label: 'VOO' },
  { key: 'CURSO', label: 'Curso' },
  { key: 'SIMULADOR', label: 'Simulador' },
  { key: 'CMA', label: 'CMA' },
  { key: 'OUTRO', label: 'Outro' },
  { key: 'ND', label: 'ND' },
];

const FALLBACK_SHIFT_OPTIONS: AllocationSelectOption[] = [
  { key: 'T6', label: 'T6' },
  { key: 'T7', label: 'T7' },
  { key: 'T8', label: 'T8' },
  { key: 'T8_BLOCK', label: 'T8 (bloco T8/T8/ND)' },
  { key: 'T9', label: 'T9 (paralelo)' },
];

function isPaoScheduleShift(shift: Shift): boolean {
  return shift.roleType === 'PAO' || shift.roleType === 'BOTH';
}

function sortShifts(a: Shift, b: Shift): number {
  return a.displayOrder - b.displayOrder || a.code.localeCompare(b.code);
}

function shiftCodeToOption(shift: Shift): AllocationSelectOption {
  const code = shift.code.toUpperCase();
  const label =
    shift.coverageType === 'PARALLEL' ? `${code} (paralelo)` : code;
  return { key: code as ManualAllocationType, label };
}

/** Monta opções do popup manual conforme turnos PAO/BOTH ativos + cadastros operacionais. */
export function buildManualAllocationOptions(shifts: Shift[]): AllocationSelectOption[] {
  const activePaoShifts = shifts.filter((s) => s.active && isPaoScheduleShift(s)).sort(sortShifts);

  const shiftOptions: AllocationSelectOption[] = [];

  if (activePaoShifts.length === 0) {
    shiftOptions.push(...FALLBACK_SHIFT_OPTIONS);
  } else {
    for (const shift of activePaoShifts) {
      shiftOptions.push(shiftCodeToOption(shift));
      if (shift.code.toUpperCase() === 'T8' && shift.requiresT8PairNd) {
        shiftOptions.push({ key: 'T8_BLOCK', label: 'T8 (bloco T8/T8/ND)' });
      }
    }
  }

  return [
    ...shiftOptions,
    ...OPERATIONAL_OPTIONS,
    { key: 'CLEAR', label: 'Limpar período' },
  ];
}
