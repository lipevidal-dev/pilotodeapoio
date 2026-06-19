export type ManualAllocationType =
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T6"
  | "T7"
  | "T8"
  | "T9"
  | "T8_BLOCK"
  | "ND"
  | "FOLGA"
  | "FS"
  | "FP"
  | "VOO"
  | "CURSO"
  | "SIMULADOR"
  | "CMA"
  | "OUTRO"
  | "CLEAR";

export type ManualEditMode = "set" | "clear" | "move";

export interface ManualEditConflict {
  code: string;
  message: string;
  requiresConfirmation?: boolean;
}

export interface ManualEditCellRef {
  employeeId: string;
  date: string;
}

export interface ManualEditCellPayload extends ManualEditCellRef {
  type: ManualAllocationType;
  mode: "set" | "clear";
  force?: boolean;
}

export interface ManualEditRangePayload {
  employeeId: string;
  startDate: string;
  endDate: string;
  type: ManualAllocationType;
  mode: "set" | "clear";
  force?: boolean;
}

export interface ManualEditMovePayload {
  source: ManualEditCellRef;
  target: ManualEditCellRef;
  mode: "move";
  force?: boolean;
}

export const SHIFT_ALLOCATION_TYPES = new Set<ManualAllocationType>([
  "T1",
  "T2",
  "T3",
  "T4",
  "T6",
  "T7",
  "T8",
  "T9",
]);

export const PREALLOC_ALLOCATION_TYPES = new Set<ManualAllocationType>([
  "ND",
  "FOLGA",
  "FS",
  "FP",
  "CURSO",
  "SIMULADOR",
  "CMA",
  "OUTRO",
]);

export function manualTypeToPreallocLabel(type: ManualAllocationType): string | null {
  switch (type) {
    case "ND":
      return "ND";
    case "FOLGA":
      return "FOLGA";
    case "FS":
      return "FOLGA SOCIAL";
    case "FP":
      return "FOLGA PEDIDA";
    case "CURSO":
      return "CURSO";
    case "SIMULADOR":
      return "SIMULADOR";
    case "CMA":
      return "CMA";
    case "OUTRO":
      return "OUTRO";
    case "VOO":
      return "VOO";
    default:
      return null;
  }
}

export function iterDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));
  while (cur <= last) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
