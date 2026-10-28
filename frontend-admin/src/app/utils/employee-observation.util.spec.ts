import { EMPLOYEE_OBSERVATION_MAX, normalizeEmployeeObservation } from './employee-observation.util';

describe('employee-observation.util', () => {
  it('ignora vazio e espaços', () => {
    expect(normalizeEmployeeObservation(null)).toBeNull();
    expect(normalizeEmployeeObservation(undefined)).toBeNull();
    expect(normalizeEmployeeObservation('   ')).toBeNull();
  });

  it('mantém o texto informado', () => {
    expect(normalizeEmployeeObservation('  Prefere T2  ')).toBe('Prefere T2');
  });

  it('corta no máximo permitido', () => {
    const long = 'x'.repeat(EMPLOYEE_OBSERVATION_MAX + 20);
    expect(normalizeEmployeeObservation(long)?.length).toBe(EMPLOYEE_OBSERVATION_MAX);
  });
});
