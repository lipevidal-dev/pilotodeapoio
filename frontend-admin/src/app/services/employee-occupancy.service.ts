import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import { ScheduleService } from './schedule.service';
import {
  buildEmployeeOccupancyMap,
  type DayOccupancyMap,
} from '../utils/employee-occupancy.util';

@Injectable({ providedIn: 'root' })
export class EmployeeOccupancyService {
  private readonly schedule = inject(ScheduleService);

  /** Mesma origem consolidada de GET /schedules/:year/:month (operationalCadastros). */
  loadForMonth(employeeId: string, year: number, month: number): Observable<DayOccupancyMap> {
    return this.schedule.getSchedule(year, month).pipe(
      map((data) => buildEmployeeOccupancyMap({ employeeId, year, month, schedule: data })),
      catchError(() => of({})),
    );
  }
}
