import {
  formatEmployeeProjection,
  isFullMonthNoFlight,
  projectEmployeeMotor,
} from './next-motor-projection.util';
import type { Employee } from '../models/api.models';

function pao(partial: Partial<Employee> = {}): Employee {
  return {
    id: '1',
    name: 'PAO Test',
    type: 'PAO',
    roleId: 'r1',
    cargoCode: 'PAO',
    cargoName: 'PAO',
    active: true,
    ...partial,
  };
}

const baseInput = {
  year: 2026,
  month: 6,
  enabled: {
    pao_meta_turnos: true,
    pao_meta_dias_trabalhados: true,
    pao_10_folgas: true,
    pao_1_folga_social: true,
    apao_regime_6x1: true,
    apao_folga_agrupada: true,
  },
  params: {
    pao_shift_meta_turnos__T6: 20,
    pao_shift_meta_dias_trabalhados__T6: 22,
    pao_shift_meta_folgas__T6: 10,
    pao_shift_meta_folga_social__T6: 1,
    pao_shift_meta_turnos__T8: 20,
    pao_shift_meta_dias_trabalhados__T8: 22,
    pao_shift_meta_folgas__T8: 10,
    pao_shift_meta_folga_social__T8: 1,
    apao_dias_trabalhados_ciclo: 6,
    apao_folgas_ciclo: 1,
  },
  rateioShiftCodes: ['T6', 'T8'],
};

describe('next-motor-projection.util', () => {
  it('PAO: projeta turnos, dias, voos e folgas', () => {
    const p = projectEmployeeMotor(pao(), baseInput, 'T6');
    expect(p.turnos).toBe(20);
    expect(p.diasTrabalhados).toBe(22);
    expect(p.voos).toBe(2);
    expect(p.folgas).toBe(10);
    expect(formatEmployeeProjection(p)).toContain('≈ 20 turnos');
    expect(formatEmployeeProjection(p)).toContain('~2 voos');
  });

  it('PAO com preferência T8 usa meta só desse turno', () => {
    const p = projectEmployeeMotor(pao(), baseInput, 'T8');
    expect(p.turnos).toBe(20);
    expect(p.voos).toBe(2);
  });

  it('PAO mês sem voo: zero voos', () => {
    const dim = 30;
    const dates = Array.from({ length: dim }, (_, i) =>
      `2026-06-${String(i + 1).padStart(2, '0')}`,
    );
    expect(isFullMonthNoFlight(pao({ noFlightDates: dates }), 2026, 6)).toBe(true);
    const p = projectEmployeeMotor(pao({ noFlightDates: dates }), baseInput);
    expect(p.voos).toBe(0);
  });

  it('APAO: estima turnos pelo ciclo 6x1', () => {
    const emp = pao({ type: 'APAO', cargoCode: 'APAO', cargoName: 'APAO' });
    const p = projectEmployeeMotor(emp, baseInput);
    expect(p.turnos).toBeGreaterThan(0);
    expect(p.voos).toBeNull();
  });
});
