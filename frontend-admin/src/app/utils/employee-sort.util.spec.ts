import { compareEmployeesBySeniority, formatSeniorityLabel, sortEmployeesBySeniority } from './employee-sort.util';
import type { Employee } from '../models/api.models';

function emp(partial: Partial<Employee> & Pick<Employee, 'id' | 'name'>): Employee {
  return {
    type: 'PAO',
    roleId: null,
    cargoCode: 'PAO',
    cargoName: 'PAO',
    active: true,
    seniorityNumber: 1,
    seniorityLabel: '1',
    ...partial,
  };
}

describe('employee-sort.util', () => {
  it('formata PAO como número simples', () => {
    expect(formatSeniorityLabel(emp({ id: '1', name: 'A', cargoCode: 'PAO', seniorityNumber: 2 }))).toBe('2');
  });

  it('formata APAO com sufixo A', () => {
    expect(
      formatSeniorityLabel(emp({ id: '1', name: 'A', cargoCode: 'APAO', type: 'APAO', seniorityNumber: 3 })),
    ).toBe('3A');
  });

  it('ordena por senioridade crescente dentro do grupo', () => {
    const sorted = sortEmployeesBySeniority([
      emp({ id: '2', name: 'B', seniorityNumber: 2 }),
      emp({ id: '1', name: 'A', seniorityNumber: 1 }),
      emp({ id: '3', name: 'C', seniorityNumber: 3 }),
    ]);
    expect(sorted.map((e) => e.seniorityNumber)).toEqual([1, 2, 3]);
  });

  it('mantém PAO antes de APAO', () => {
    const sorted = [
      emp({ id: 'a1', name: 'APAO', cargoCode: 'APAO', type: 'APAO', seniorityNumber: 1 }),
      emp({ id: 'p1', name: 'PAO', cargoCode: 'PAO', seniorityNumber: 1 }),
    ].sort(compareEmployeesBySeniority);
    expect(sorted[0].cargoCode).toBe('PAO');
  });
});
