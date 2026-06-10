import type { ScheduleContext, ValidationIssue } from "../schedule/types.js";
import type { Rule } from "./base-rule.js";
import {
  Apao6x1Rule,
  ApaoAvailabilityRule,
  ApaoFolgaAgrupadaOverlapRule,
  ApaoRequiresPaoRule,
  BlockedDayWorkRule,
  ConsecutiveDaysRule,
  EmptyDayRule,
  MonofolgaRule,
  NdOnlyAfterT8BlockRule,
  PaoAllowedShiftsRule,
  PaoCoveragePerDayRule,
  PaoOffLimitRule,
  RequestedOffLimitRule,
  Rest12hRule,
  SimultaneousStationsRule,
  SocialOffRule,
  T8PairingRule,
  VacationBlocksWorkRule,
} from "./validators.js";

const DEFAULT_RULES: Rule[] = [
  new PaoCoveragePerDayRule(),
  new PaoAllowedShiftsRule(),
  new Rest12hRule(),
  new SimultaneousStationsRule(),
  new ApaoRequiresPaoRule(),
  new ApaoAvailabilityRule(),
  new ApaoFolgaAgrupadaOverlapRule(),
  new T8PairingRule(),
  new NdOnlyAfterT8BlockRule(),
  new ConsecutiveDaysRule(),
  new Apao6x1Rule(),
  new PaoOffLimitRule(),
  new RequestedOffLimitRule(),
  new MonofolgaRule(),
  new BlockedDayWorkRule(),
  new VacationBlocksWorkRule(),
  new SocialOffRule(),
  new EmptyDayRule(),
];

export function validateSchedule(
  ctx: ScheduleContext,
  rules: Rule[] = DEFAULT_RULES,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    issues.push(...rule.validate(ctx));
  }
  return issues;
}

export function filterBySeverity(
  issues: ValidationIssue[],
  severities: ValidationIssue["severity"][],
): ValidationIssue[] {
  const set = new Set(severities);
  return issues.filter((i) => set.has(i.severity));
}

export { DEFAULT_RULES };
