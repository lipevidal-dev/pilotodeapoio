import { describe, expect, it } from 'vitest';
import {
  applyInstructionShiftIfNeeded,
  baseShiftCode,
  isInstructionShiftCode,
  toInstructionShiftCode,
} from '../domain/schedule/instruction-shift.js';

describe('instruction-shift.util', () => {
  it('converte T6 em TI6', () => {
    expect(toInstructionShiftCode('T6')).toBe('TI6');
    expect(toInstructionShiftCode('T10')).toBe('TI10');
  });

  it('extrai turno base de TI8', () => {
    expect(baseShiftCode('TI8')).toBe('T8');
    expect(isInstructionShiftCode('TI8')).toBe(true);
  });

  it('aplica prefixo quando funcionário está em instrução', () => {
    expect(applyInstructionShiftIfNeeded('T7', true)).toBe('TI7');
    expect(applyInstructionShiftIfNeeded('T7', false)).toBe('T7');
    expect(applyInstructionShiftIfNeeded('ND', true)).toBe('ND');
  });
});
