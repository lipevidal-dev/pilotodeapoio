export type PaoShiftParamKind =
  | 'meta_turnos'
  | 'espacamento'
  | 'meta_dias_trabalhados'
  | 'meta_folgas'
  | 'meta_folga_social'
  | 'max_consecutivos';

const PAO_SHIFT_PARAM_PREFIX = 'pao_shift_';

export const PAO_SHIFT_PARAM_KINDS: PaoShiftParamKind[] = [
  'meta_turnos',
  'espacamento',
  'meta_dias_trabalhados',
  'meta_folgas',
  'meta_folga_social',
  'max_consecutivos',
];

export function paoShiftParamId(kind: PaoShiftParamKind, shiftCode: string): string {
  return `${PAO_SHIFT_PARAM_PREFIX}${kind}__${shiftCode.toUpperCase()}`;
}

export function paoShiftMetaTurnosId(shiftCode: string): string {
  return paoShiftParamId('meta_turnos', shiftCode);
}

export function paoShiftEspacamentoId(shiftCode: string): string {
  return paoShiftParamId('espacamento', shiftCode);
}

export function isPaoShiftParamId(id: string): boolean {
  return id.startsWith(PAO_SHIFT_PARAM_PREFIX) && id.includes('__');
}

export function sumPaoShiftMetaTurnos(
  params: Record<string, number>,
  shiftCodes: string[],
  enabled: boolean,
): number {
  if (!enabled) return 0;
  return shiftCodes.reduce((sum, code) => sum + (params[paoShiftMetaTurnosId(code)] ?? 0), 0);
}

export function resolveEmployeeTurnoMeta(
  params: Record<string, number>,
  enabled: Record<string, boolean>,
  shiftCodes: string[],
  preferredShiftCode: string | null,
): number {
  if (!enabled['pao_meta_turnos']) return 0;
  if (preferredShiftCode) {
    return params[paoShiftMetaTurnosId(preferredShiftCode)] ?? 0;
  }
  return sumPaoShiftMetaTurnos(params, shiftCodes, true);
}

export function resolveEmployeeEspacamento(
  params: Record<string, number>,
  enabled: Record<string, boolean>,
  preferredShiftCode: string | null,
): number | null {
  if (!enabled['pao_espacamento_turnos']) return null;
  if (!preferredShiftCode) return null;
  const value = params[paoShiftEspacamentoId(preferredShiftCode)] ?? 0;
  return value > 0 ? value : null;
}

export function resolveEmployeeDiasTrabalhados(
  params: Record<string, number>,
  enabled: Record<string, boolean>,
  preferredShiftCode: string | null,
): number | null {
  if (!enabled['pao_meta_dias_trabalhados']) return null;
  if (!preferredShiftCode) return null;
  return params[paoShiftParamId('meta_dias_trabalhados', preferredShiftCode)] ?? null;
}

export function resolveEmployeeFolgas(
  params: Record<string, number>,
  enabled: Record<string, boolean>,
  preferredShiftCode: string | null,
): number | null {
  if (!enabled['pao_10_folgas']) return null;
  if (!preferredShiftCode) return null;
  return params[paoShiftParamId('meta_folgas', preferredShiftCode)] ?? null;
}

export function resolveEmployeeFolgaSocial(
  params: Record<string, number>,
  enabled: Record<string, boolean>,
  preferredShiftCode: string | null,
): number | null {
  if (!enabled['pao_1_folga_social']) return null;
  if (!preferredShiftCode) return null;
  return params[paoShiftParamId('meta_folga_social', preferredShiftCode)] ?? null;
}

export function computeEmployeeMetaPlannedTotal(
  params: Record<string, number>,
  enabled: Record<string, boolean>,
  shiftCodes: string[],
  preferredShiftCode: string | null,
): { turnos: number; folgas: number; folgaSocial: number; total: number } {
  const turnos = resolveEmployeeTurnoMeta(params, enabled, shiftCodes, preferredShiftCode);
  const folgas = preferredShiftCode
    ? (resolveEmployeeFolgas(params, enabled, preferredShiftCode) ?? 0)
    : shiftCodes.reduce(
        (sum, code) => sum + (enabled['pao_10_folgas'] ? (params[paoShiftParamId('meta_folgas', code)] ?? 0) : 0),
        0,
      );
  const folgaSocial = preferredShiftCode
    ? (resolveEmployeeFolgaSocial(params, enabled, preferredShiftCode) ?? 0)
    : shiftCodes.reduce(
        (sum, code) =>
          sum + (enabled['pao_1_folga_social'] ? (params[paoShiftParamId('meta_folga_social', code)] ?? 0) : 0),
        0,
      );
  return { turnos, folgas, folgaSocial, total: turnos + folgas + folgaSocial };
}
