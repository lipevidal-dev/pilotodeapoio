import { buildSchedulePdfHtml, PDF_DAYS_PER_PAGE } from './schedule-pdf-html.util';
import type { ScheduleGridData } from '../models/schedule-grid.models';

function emptySummary() {
  return {
    t6: 0,
    t7: 0,
    t8: 0,
    nd: 0,
    turnos: 0,
    diasTrabalhados: 0,
    folgas: 0,
    folgaSocial: 0,
    folgaSocialOk: false,
    fa: 0,
    fani: 0,
    fp: 0,
    ferias: 0,
    vooDisp: 0,
    disponivel: 0,
    maxConsec: 0,
    status: 'OK' as const,
    statusReason: null,
    voos: 0,
    simuladores: 0,
    cursos: 0,
    cma: 0,
    outros: 0,
  };
}

describe('schedule-pdf-html.util', () => {
  it('gera HTML com todos os funcionários e fatia dias em páginas', () => {
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    const grid: ScheduleGridData = {
      year: 2026,
      month: 8,
      daysInMonth: 31,
      dayNumbers: days,
      weekdayLabels: days.map(() => 'Seg'),
      groups: [
        {
          type: 'PAO',
          label: 'PAO',
          rows: [
            {
              employeeId: 'p1',
              name: 'Felipe Vidal',
              type: 'PAO',
              cells: days.map((d) =>
                d === 1
                  ? { display: 'T8', kind: 't8' as const }
                  : { display: '', kind: 'empty' as const },
              ),
              summary: emptySummary(),
            },
          ],
        },
        {
          type: 'APAO',
          label: 'APAO',
          rows: [
            {
              employeeId: 'a1',
              name: 'Cesar Rocha',
              type: 'APAO',
              cells: days.map((d) =>
                d === 5
                  ? { display: 'F', kind: 'folga' as const }
                  : { display: 'T4', kind: 'shift' as const },
              ),
              summary: emptySummary(),
            },
          ],
        },
      ],
    };

    const html = buildSchedulePdfHtml(grid);
    expect(html).toContain('Felipe Vidal');
    expect(html).toContain('Cesar Rocha');
    expect(html).toContain('APAO');
    expect(html).toContain('T8');
    expect(html).toContain('T4');
    // 31 dias => 2 páginas com PDF_DAYS_PER_PAGE=16
    const expectedPages = Math.ceil(31 / PDF_DAYS_PER_PAGE);
    expect((html.match(/class="page"/g) ?? []).length).toBe(expectedPages);
    expect(html).toContain('@page');
    expect(html).toContain('landscape');
  });
});
