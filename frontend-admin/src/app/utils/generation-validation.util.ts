/** Issue retornado em HTTP 422 (PERSISTENCE_VALIDATION_FAILED). */
export interface GenerationPersistenceIssue {
  level: string;
  ruleCode: string;
  message: string;
  date: string;
  employee: string;
  detail: string;
}

export interface GenerationPersistenceValidation {
  stage: string;
  criticalCount: number;
  issues: GenerationPersistenceIssue[];
}

const RULE_LABELS: Record<string, string> = {
  T8_WITHOUT_ND: 'T8/T8/ND — falta ND após dois T8 (verifique folga pedida ou pré-alocação no dia seguinte)',
  COVERAGE_GAP: 'Furo de cobertura PAO',
  DUPLICATE_ASSIGNMENT: 'Turno duplicado no mesmo dia',
  PREALLOC_SHIFT_MISSING: 'Pré-alocação de turno não respeitada',
  PREALLOC_ALLOC_MISSING: 'Pré-alocação operacional não respeitada',
  ND_AS_SHIFT: 'ND incorreto (deve ser alocação, não turno)',
};

export function generationRuleLabel(ruleCode: string): string {
  return RULE_LABELS[ruleCode] ?? ruleCode;
}

export function formatGenerationIssueDate(iso: string): string {
  if (!iso || iso.length < 10) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function summarizeGenerationPersistenceIssues(
  issues: GenerationPersistenceIssue[],
): string {
  if (issues.length === 0) return 'Nenhum detalhe disponível.';
  return issues
    .slice(0, 5)
    .map((issue) => formatGenerationPersistenceIssueLine(issue))
    .join(' · ');
}

export function formatGenerationPersistenceIssueLine(issue: GenerationPersistenceIssue): string {
  const label = generationRuleLabel(issue.ruleCode);
  const when = issue.date ? ` ${formatGenerationIssueDate(issue.date)}` : '';
  const who = issue.employee && issue.employee !== '—' ? ` — ${issue.employee}` : '';
  const detail = issue.detail && issue.detail !== issue.message ? `: ${issue.detail}` : '';
  return `${label}${when}${who}${detail}`;
}
