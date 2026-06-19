import type { CleanAuditEntry, CleanDecisionKind } from "./clean-types.js";

export class CleanAuditLog {
  private readonly entries: CleanAuditEntry[] = [];

  record(
    kind: CleanDecisionKind,
    phase: string,
    reason: string,
    fields: Partial<Omit<CleanAuditEntry, "kind" | "phase" | "reason">> = {},
  ): void {
    this.entries.push({
      kind,
      phase,
      reason,
      date: fields.date ?? "",
      shiftCode: fields.shiftCode,
      employeeUuid: fields.employeeUuid,
      employeeName: fields.employeeName,
    });
  }

  all(): CleanAuditEntry[] {
    return [...this.entries];
  }

  countByKind(kind: CleanDecisionKind): number {
    return this.entries.filter((e) => e.kind === kind).length;
  }

  coverageFailures(): CleanAuditEntry[] {
    return this.entries.filter((e) => e.kind === "COVERAGE_FAILED");
  }
}
