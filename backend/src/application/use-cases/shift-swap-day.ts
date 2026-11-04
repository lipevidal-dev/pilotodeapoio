/** Snapshots de um dia na escala realizada — usado pela troca de turnos. */

export type DaySnapshot = {
  assignment: {
    shiftCode: string;
    label: string | null;
  } | null;
  preAllocation: {
    label: string;
    notes: string | null;
    startTime: string | null;
    endTime: string | null;
  } | null;
};

const PRE_LABEL: Record<string, string> = {
  FA: "FOLGA AGRUPADA",
  F: "FOLGA",
  FS: "FOLGA SOCIAL",
  FP: "FOLGA PEDIDA",
  FANI: "FOLGA ANIVERSARIO",
  VOO: "VOO",
  SIM: "SIMULADOR",
  CRS: "CURSO",
  CMA: "CMA",
  FER: "FERIAS",
  ND: "ND",
};

export function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

const BLANK_PARTS = new Set(["", "-", "—", "–", "−", "·", "em branco"]);

export function isBlankDisplayToken(code: string | null | undefined): boolean {
  const raw = (code ?? "").trim();
  if (!raw) return true;
  return raw.split("+").every((part) => BLANK_PARTS.has(part.trim().toLowerCase()));
}

/** T8/T7/… — um código desses não pode ir para um dia em que outro colaborador já o tem. */
export function isExclusiveShiftCode(token: string | null | undefined): boolean {
  const code = isBlankDisplayToken(token) ? "" : String(token).trim().toUpperCase();
  return /^T[A-Z0-9]+$/.test(code);
}

/** Converte label operacional no token curto da grade (FA, VOO, T1…). */
export function shortFromLabel(label: string): string | null {
  const n = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
  if (!n) return null;
  if (n.includes("VOO")) return "VOO";
  if (n === "ND" || n.includes("NAO DISPONIVEL") || n.includes("NAO-DISPONIVEL")) return "ND";
  if (n.includes("FOLGA PEDIDA") || n === "FP") return "FP";
  if (n === "FOLGA SOCIAL" || n === "FS") return "FS";
  if (n.includes("FOLGA AGRUPADA") || n === "FA") return "FA";
  if (n.includes("FOLGA ANIVERS") || n === "FANI") return "FANI";
  if (n === "FOLGA" || n === "F") return "F";
  if (n.includes("SIMULADOR")) return "SIM";
  if (n.includes("CURSO")) return "CRS";
  if (n === "CMA") return "CMA";
  if (n.includes("FERIAS")) return "FER";
  if (/^T[A-Z0-9]+$/.test(n) || /^TI[A-Z0-9]+$/.test(n)) return n;
  return n.length > 6 ? `${n.slice(0, 5)}…` : n;
}

/**
 * Token do que a grade mostra no dia.
 * Prioridade: pré-alocação (FA/VOO/…) → código de turno → label do assignment.
 */
export function displayTokenFromDay(day: DaySnapshot): string {
  if (day.preAllocation?.label) {
    const fromPre = shortFromLabel(day.preAllocation.label);
    if (fromPre && !isBlankDisplayToken(fromPre)) return fromPre;
  }

  const shift = normalizeCode(day.assignment?.shiftCode);
  if (shift && !isBlankDisplayToken(shift)) return shift;

  if (day.assignment?.label) {
    const fromAssignLabel = shortFromLabel(day.assignment.label);
    if (fromAssignLabel && !isBlankDisplayToken(fromAssignLabel)) return fromAssignLabel;
  }

  return "";
}

export function isEmptyDay(day: DaySnapshot): boolean {
  return !displayTokenFromDay(day);
}

/** Monta snapshot a partir do token gravado na troca (T8, FA, VOO…). */
export function snapshotFromToken(token: string | null | undefined): DaySnapshot {
  const code = normalizeCode(token);
  if (!code || isBlankDisplayToken(code)) {
    return { assignment: null, preAllocation: null };
  }
  const preLabel = PRE_LABEL[code];
  if (preLabel) {
    return {
      assignment: null,
      preAllocation: { label: preLabel, notes: null, startTime: null, endTime: null },
    };
  }
  return {
    assignment: { shiftCode: code, label: null },
    preAllocation: null,
  };
}

/**
 * Executado → planejado → token da troca.
 * Evita aplicar troca em dia vazio quando o espelho ainda não tinha o turno.
 */
export function hydrateDaySnapshot(
  executed: DaySnapshot,
  planned: DaySnapshot,
  storedToken?: string | null,
): DaySnapshot {
  if (!isEmptyDay(executed)) return executed;
  if (!isEmptyDay(planned)) return planned;
  const fromToken = snapshotFromToken(storedToken);
  if (!isEmptyDay(fromToken)) return fromToken;
  return executed;
}

/** Prefere token da grade (cliente) quando o banco vier vazio ou genérico. */
export function preferDisplayToken(dbToken: string, clientToken?: string | null): string {
  const db = (dbToken ?? "").trim();
  const client = (clientToken ?? "").trim();
  if (!isBlankDisplayToken(db)) return db;
  if (!isBlankDisplayToken(client)) return client;
  return db || client || "";
}

export function splitClientTokens(joined: string | null | undefined, expected: number): string[] {
  if (!joined?.trim()) return Array.from({ length: expected }, () => "");
  const parts = joined.split("+").map((p) => p.trim());
  if (parts.length === expected) return parts;
  if (parts.length === 1 && expected > 1) {
    return Array.from({ length: expected }, () => parts[0] ?? "");
  }
  while (parts.length < expected) parts.push("");
  return parts.slice(0, expected);
}

export function pairAlreadyApplied(
  left: DaySnapshot,
  right: DaySnapshot,
  origLeft: string,
  origRight: string,
): boolean {
  const origL = isBlankDisplayToken(origLeft) ? "" : normalizeCode(origLeft);
  const origR = isBlankDisplayToken(origRight) ? "" : normalizeCode(origRight);
  if (!origL && !origR) return false;
  const nowL = isBlankDisplayToken(displayTokenFromDay(left))
    ? ""
    : normalizeCode(displayTokenFromDay(left));
  const nowR = isBlankDisplayToken(displayTokenFromDay(right))
    ? ""
    : normalizeCode(displayTokenFromDay(right));
  if (origL === origR) return nowL === origL && nowR === origR;
  return nowL === origR && nowR === origL;
}

/**
 * Resultado da troca a partir dos tokens originais de cada lado.
 * Nunca copia um único turno nos dois: orig vazio vira célula vazia.
 */
export function swapResultFromOrig(
  origLeft: string,
  origRight: string,
): { left: DaySnapshot; right: DaySnapshot } | null {
  const leftTok = isBlankDisplayToken(origLeft) ? "" : normalizeCode(origLeft);
  const rightTok = isBlankDisplayToken(origRight) ? "" : normalizeCode(origRight);
  if (!leftTok && !rightTok) return null;
  if (leftTok && rightTok && leftTok === rightTok) return null;
  return {
    left: snapshotFromToken(rightTok),
    right: snapshotFromToken(leftTok),
  };
}

/** Assignment a persistir: label-only (folga/FA) vira shiftCode para não sumir. */
export function assignmentWriteFromDay(
  day: DaySnapshot,
): { shiftCode: string; label: string | null } | null {
  const fromCode = (day.assignment?.shiftCode ?? "").trim();
  const fromLabel = day.assignment?.label ? shortFromLabel(day.assignment.label) : null;
  const shiftCode = (fromCode || fromLabel || "").trim();
  if (!shiftCode || isBlankDisplayToken(shiftCode)) return null;
  return {
    shiftCode: shiftCode.toUpperCase(),
    label: day.assignment?.label ?? null,
  };
}
