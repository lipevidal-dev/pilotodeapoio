import {
  formatGenerationPersistenceIssueLine,
  generationRuleLabel,
} from './generation-validation.util';

describe('generation-validation.util', () => {
  it('traduz código T8_WITHOUT_ND', () => {
    expect(generationRuleLabel('T8_WITHOUT_ND')).toContain('T8/T8/ND');
  });

  it('formata linha legível com data e funcionário', () => {
    const line = formatGenerationPersistenceIssueLine({
      level: 'CRITICAL',
      ruleCode: 'T8_WITHOUT_ND',
      message: 'par T8/T8',
      date: '2026-07-10',
      employee: 'Vinicius Palombino',
      detail: 'par T8/T8 em 2026-07-08–2026-07-09 sem ND em 2026-07-10',
    });
    expect(line).toContain('Palombino');
    expect(line).toContain('10/07/2026');
  });
});
