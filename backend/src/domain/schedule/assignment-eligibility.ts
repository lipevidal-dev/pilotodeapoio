export type ShiftCode = "T6" | "T7" | "T8" | "T9";

export interface AssignmentEligibilityContext {
  monthDays: number;
  day: number;
  shift: ShiftCode;
  employeeId: string;

  currentTurnCounts: Map<string, number>;
  maxTurnCounts: Map<string, number>;
  minTurnCounts?: Map<string, number>;
  targetTurnCounts?: Map<string, number>;

  t6Counts?: Map<string, number>;
  t7Counts?: Map<string, number>;
  t8Counts?: Map<string, number>;
  t9Counts?: Map<string, number>;

  preferredShiftByEmployee?: Map<string, ShiftCode | null>;
  seniorityWeightByEmployee?: Map<string, number>;

  effectiveTurnCount?: number;

  strictMaxTurnCount?: boolean;
  allowEmergencyOverflow?: boolean;
}

export interface AssignmentEligibilityResult {
  allowed: boolean;
  reasons: string[];
  scorePenalty: number;
}

export function canAssignShiftWithRateio(
  context: AssignmentEligibilityContext,
): AssignmentEligibilityResult {
  const reasons: string[] = [];
  let scorePenalty = 0;

  const current =
    context.effectiveTurnCount ??
    context.currentTurnCounts.get(context.employeeId) ??
    0;
  const max = context.maxTurnCounts.get(context.employeeId);

  if (
    context.strictMaxTurnCount !== false &&
    max !== undefined &&
    current >= max
  ) {
    if (!context.allowEmergencyOverflow) {
      return {
        allowed: false,
        reasons: ["RATEIO_TURNOS_ACIMA_MAX"],
        scorePenalty: 9999,
      };
    }

    reasons.push("RATEIO_TURNOS_ACIMA_MAX_EMERGENCY_OVERFLOW");
    scorePenalty += 5000;
  }

  const preferredShift =
    context.preferredShiftByEmployee?.get(context.employeeId) ?? null;
  const seniorityWeight =
    context.seniorityWeightByEmployee?.get(context.employeeId) ?? 1;

  if (preferredShift && preferredShift !== context.shift) {
    scorePenalty += 20;
    reasons.push("FORA_DA_PREFERENCIA_DE_TURNO");
  }

  if (preferredShift && preferredShift === context.shift) {
    scorePenalty -= 30 * seniorityWeight;
  }

  return {
    allowed: true,
    reasons,
    scorePenalty,
  };
}

export function isRateioShiftCode(code: string): code is ShiftCode {
  return code === "T6" || code === "T7" || code === "T8" || code === "T9";
}

export function toShiftCode(code: string): ShiftCode | null {
  const upper = code.toUpperCase();
  return isRateioShiftCode(upper) ? upper : null;
}
