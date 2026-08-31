import { ScheduleExportService } from './schedule-export.service';
import type { ScheduleGridData } from '../models/schedule-grid.models';

describe('ScheduleExportService', () => {
  it('gera e inicia o download do XLSX no bundle do navegador', async () => {
    const service = new ScheduleExportService();
    const grid = {
      year: 2026,
      month: 8,
      daysInMonth: 2,
      dayNumbers: [1, 2],
      weekdayLabels: ['Sáb', 'Dom'],
      groups: [
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            {
              name: 'César Rocha',
              cells: [
                { display: 'T4', kind: 'shift' },
                { display: 'FA', kind: 'fa' },
              ],
            },
          ],
        },
      ],
    } as ScheduleGridData;
    const payload = service.prepareExportPayload(grid);
    const objectUrl = 'blob:escala-excel-test';
    const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue(objectUrl);
    const revokeObjectUrl = spyOn(URL, 'revokeObjectURL');
    const click = spyOn(HTMLAnchorElement.prototype, 'click');

    const exported = await service.exportExcel(payload, 'all');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exported).toBeTrue();
    expect(createObjectUrl).toHaveBeenCalledWith(jasmine.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith(objectUrl);
  });
});
