import type { ScheduleContext, ValidationIssue } from "../schedule/types.js";

export interface Rule {
  readonly name: string;
  validate(ctx: ScheduleContext): ValidationIssue[];
}
