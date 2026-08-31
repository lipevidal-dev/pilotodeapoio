import type { ScheduleGridData } from '../models/schedule-grid.models';
import { buildScheduleExcelBuffer } from './schedule-excel-download.util';

describe('schedule-excel-download.util', () => {
  it('reproduz o layout visual clássico da escala', async () => {
    const grid = {
      year: 2026,
      month: 8,
      daysInMonth: 3,
      dayNumbers: [1, 2, 3],
      weekdayLabels: ['Sáb', 'Dom', 'Seg'],
      groups: [
        {
          type: 'PAO',
          label: 'PAO',
          rows: [
            {
              employeeId: 'pao-1',
              name: 'Vinicius Palombino',
              type: 'PAO',
              cells: [
                { display: 'T7', kind: 'shift' },
                { display: 'FA', kind: 'fa' },
                { display: 'VOO', kind: 'voo' },
              ],
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
              name: 'César Rocha',
              type: 'APAO',
              cells: [
                { display: 'T4', kind: 'shift' },
                { display: 'F', kind: 'folga' },
                { display: '', kind: 'empty' },
              ],
              summary: {},
            },
          ],
        },
      ],
    } as ScheduleGridData;

    const buffer = await buildScheduleExcelBuffer(
      grid,
      'Escala 08/2026 — Completa',
      '2026-08-31T18:30:00.000Z',
    );
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    expect(sheet.name).toBe('Escala 08 2026 — Completa');
    expect(sheet.getCell('A1').value).toBe('Escala 08/2026 — Completa');
    expect(sheet.getCell('B2').value).toBe('1\nSáb');
    expect(sheet.getCell('B2').alignment?.wrapText).toBeTrue();
    expect(sheet.getCell('A3').value).toBe('PAO');
    expect(sheet.getCell('A3').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FFFF6900' }) }),
    );
    expect(sheet.getCell('A4').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FFF3F4F6' }) }),
    );
    expect(sheet.getCell('B4').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FFE0E7FF' }) }),
    );
    expect(sheet.getCell('C4').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FF14532D' }) }),
    );
    expect(sheet.getCell('C4').font?.color?.argb).toBe('FFFFFFFF');
    expect(sheet.getCell('D4').fill).toEqual(
      jasmine.objectContaining({ fgColor: jasmine.objectContaining({ argb: 'FFF15A22' }) }),
    );
    expect(sheet.getCell('D4').font?.color?.argb).toBe('FFFFFFFF');
    expect(sheet.getCell('A5').value).toBe('APAO');
    expect(sheet.getCell('A8').value).toContain('Escala PAO/APAO');
    expect(sheet.getColumn(1).width).toBe(22);
    expect(sheet.getColumn(2).width).toBe(4.2);
    expect(sheet.getRow(1).height).toBe(22);
    expect(sheet.getRow(2).height).toBe(28);
    expect(sheet.pageSetup.orientation).toBe('landscape');
    expect(sheet.pageSetup.fitToPage).toBeTrue();
    expect(sheet.pageSetup.fitToWidth).toBe(1);
    expect(sheet.pageSetup.fitToHeight).toBe(1);
    expect(sheet.pageSetup.paperSize).toBe(9);
    expect(sheet.views[0]).toEqual(
      jasmine.objectContaining({ state: 'frozen', xSplit: 1, ySplit: 2 }),
    );
  });
});
