import type { ScheduleGridData } from '../models/schedule-grid.models';
import {
  buildApaoRevezamentoExcelWorkbook,
  mapApaoRevezamentoCell,
} from './schedule-apao-revezamento-export.util';

describe('schedule-apao-revezamento-export.util', () => {
  it('mapeia códigos no padrão Escala de Revezamento', () => {
    expect(mapApaoRevezamentoCell({ display: 'T4', kind: 'shift' })).toEqual(
      jasmine.objectContaining({ text: '4' }),
    );
    expect(mapApaoRevezamentoCell({ display: 'T2', kind: 'shift' }).text).toBe('2');
    expect(mapApaoRevezamentoCell({ display: 'F', kind: 'folga' })).toEqual(
      jasmine.objectContaining({ text: 'FR', bg: [255, 0, 0] }),
    );
    expect(mapApaoRevezamentoCell({ display: 'FA', kind: 'fa' })).toEqual(
      jasmine.objectContaining({ text: 'FA', bg: [146, 208, 80] }),
    );
    expect(mapApaoRevezamentoCell({ display: 'FS', kind: 'fs' })).toEqual(
      jasmine.objectContaining({ text: 'FS', bg: [146, 208, 80] }),
    );
    expect(mapApaoRevezamentoCell({ display: 'FER', kind: 'ferias' })).toEqual(
      jasmine.objectContaining({ text: 'L', bg: [0, 176, 240] }),
    );
    expect(mapApaoRevezamentoCell({ display: 'FANI', kind: 'fani' }).text).toBe('FB');
    expect(mapApaoRevezamentoCell({ display: 'VOO', kind: 'voo' }).text).toBe('V');
    expect(mapApaoRevezamentoCell({ display: 'CRS', kind: 'curso' }).text).toBe('K');
    expect(mapApaoRevezamentoCell({ display: 'ND', kind: 'nd' }).bg).toEqual([229, 231, 235]);
    expect(mapApaoRevezamentoCell({ display: '', kind: 'empty' }).text).toBe('');
  });

  it('monta Excel só com APAOs no layout Escala de Revezamento', async () => {
    const grid = {
      year: 2026,
      month: 9,
      daysInMonth: 3,
      dayNumbers: [1, 2, 3],
      weekdayLabels: ['Ter', 'Qua', 'Qui'],
      groups: [
        {
          type: 'PAO',
          label: 'PAO',
          rows: [
            {
              employeeId: 'pao-1',
              name: 'PAO Ignorado',
              type: 'PAO',
              cells: [{ display: 'T6', kind: 'shift' }],
              summary: {},
            },
          ],
        },
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            {
              employeeId: 'apao-1',
              name: 'Cesar Rocha',
              type: 'APAO',
              cif: '44511',
              cells: [
                { display: 'T4', kind: 'shift' },
                { display: 'F', kind: 'folga' },
                { display: 'FA', kind: 'fa' },
              ],
              summary: {},
            },
          ],
        },
      ],
    } as ScheduleGridData;

    const workbook = await buildApaoRevezamentoExcelWorkbook(grid);
    const sheet = workbook.worksheets[0]!;

    expect(sheet.name).toBe('Escala de Revezamento');
    expect(sheet.getCell('B1').value).toBe('Escala de Revezamento');
    expect(sheet.getCell('B2').value).toBe('Mês: set/2026');
    expect(sheet.getColumn(1).width).toBeCloseTo(35.14, 1);
    expect(sheet.getColumn(4).width).toBe(4);
    expect(sheet.getCell('A3').value).toBe('NOME');
    expect(sheet.getCell('C3').value).toBe('CIF');
    expect(sheet.getCell('D3').value).toBe(1);
    expect(sheet.getCell('D4').value).toBe('ter');
    expect(sheet.getRow(1).height).toBe(20.25);
    expect(sheet.getRow(2).height).toBe(28.5);
    expect(sheet.getRow(4).height).toBe(30.75);
    expect(sheet.getRow(5).height).toBe(19.35);
    expect(sheet.getCell('A6').value).toBe('LEGENDA AEROVIÁRIO');
    expect(sheet.getCell('R6').value).toBe('TURNOS');
    expect(sheet.getCell('Z6').value).toBe('HORÁRIOS');
    expect(sheet.getCell('A7').value).toBe('FR');
    expect(sheet.getCell('R8').value).toBe('Turno 1');
    expect(sheet.getCell('Z8').value).toBe('00:00 - 06:00');
    expect(sheet.getCell('A12').value).toBe('V');
    expect(sheet.getCell('D12').value).toBe('VOO');
    expect(sheet.getCell('A5').value).toBe('CESAR ROCHA');
    expect(sheet.getCell('C5').value).toBe('44511');
    expect(sheet.getCell('D5').value).toBe('4');
    expect(sheet.getCell('E5').value).toBe('FR');
    expect(sheet.getCell('E5').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FFFF0000' }) }),
    );
    expect(sheet.getCell('F5').value).toBe('FA');
    expect(sheet.getCell('F5').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FF92D050' }) }),
    );

    const texts: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') texts.push(cell.value);
      });
    });
    expect(texts).toContain('LEGENDA AEROVIÁRIO');
    expect(texts).toContain('FOLGA REGULAMENTAR');
    expect(texts).toContain('FÉRIAS');
    expect(texts).toContain('TURNOS');
    expect(texts).toContain('HORÁRIOS');
    expect(texts).toContain('Turno 1');
    expect(texts).toContain('00:00 - 06:00');
    expect(texts).not.toContain('PAO IGNORADO');
  });
});
