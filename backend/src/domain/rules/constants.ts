export const BLOCK_TYPES = new Set([
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA PEDIDA",
  "FOLGA ESCOLHIDA",
  "DISPENSA MÉDICA",
  "FÉRIAS",
  "FERIAS",
  "CURSO",
  "CURSO ONLINE",
  "SIMULADOR",
  "VOO",
  "ND",
  "CMA",
  "OUTRO",
  "FOLGA AGRUPADA",
  "FOLGA ANIVERSÁRIO",
]);

export const VACATION_TYPES = new Set([
  "FÉRIAS",
  "FERIAS",
  "FER",
  "FÉRIA",
  "FERIA",
]);

export const PAO_REST_TYPES = [
  "FOLGA",
  "FOLGA SOCIAL",
  "FOLGA PEDIDA",
  "FOLGA ESCOLHIDA",
  "FOLGA AGRUPADA",
  "FOLGA ANIVERSÁRIO",
] as const;

export const MONOFOLGA_REST_TYPES = new Set<string>([
  ...PAO_REST_TYPES,
]);

export const PROTECTED_PREALLOC_TYPES = new Set([
  "FÉRIAS",
  "FERIAS",
  "FOLGA PEDIDA",
  "FOLGA ESCOLHIDA",
  "FOLGA ANIVERSÁRIO",
  "FANI",
  "DISPENSA MÉDICA",
  "CURSO",
  "CURSO ONLINE",
  "SIMULADOR",
  "CMA",
  "VOO",
  "OUTRO",
]);

export const PAO_COVERAGE_SHIFTS = ["T6", "T7", "T8"] as const;

/** Folgas PAO ideais por mês. */
export const IDEAL_PAO_REST_COUNT = 10;
/** @deprecated Use IDEAL_PAO_REST_COUNT */
export const EXACT_PAO_REST_COUNT = IDEAL_PAO_REST_COUNT;
/** Máximo permitido por ajuste operacional (11 gera WARNING/INFO). */
export const MAX_PAO_REST_COUNT = 11;
export const MIN_PAO_REST_COUNT = 10;
export const MAX_REQUESTED_OFF_PER_MONTH = 3;
export const MAX_CONSECUTIVE_WORK_DAYS = 6;
export const MAX_SIMULTANEOUS_STATIONS = 2;
export const MIN_REST_HOURS = 12;
