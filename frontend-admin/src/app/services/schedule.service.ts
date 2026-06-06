import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  GenerateFlightsResponse,
  GenerateScheduleResponse,
  PublishScheduleResponse,
  ScheduleMonthResponse,
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  generateSchedule(year: number, month: number): Observable<GenerateScheduleResponse> {
    return this.http.post<GenerateScheduleResponse>(`${this.base}/schedules/generate`, {
      year,
      month,
    });
  }

  generateFlights(scheduleMonthId: string): Observable<GenerateFlightsResponse> {
    return this.http.post<GenerateFlightsResponse>(
      `${this.base}/schedules/${scheduleMonthId}/generate-flights`,
      {},
    );
  }

  publishSchedule(scheduleMonthId: string): Observable<PublishScheduleResponse> {
    return this.http.post<PublishScheduleResponse>(
      `${this.base}/schedules/${scheduleMonthId}/publish`,
      {},
    );
  }

  getSchedule(year: number, month: number): Observable<ScheduleMonthResponse> {
    return this.http.get<ScheduleMonthResponse>(`${this.base}/schedules/${year}/${month}`);
  }

  getPublishedSchedule(year: number, month: number): Observable<ScheduleMonthResponse> {
    return this.http.get<ScheduleMonthResponse>(
      `${this.base}/schedules/published/${year}/${month}`,
    );
  }

  clearGeneratedData(scheduleMonthId: string): Observable<{
    scheduleMonthId: string;
    year: number;
    month: number;
    status: string;
  }> {
    return this.http.delete<{
      scheduleMonthId: string;
      year: number;
      month: number;
      status: string;
    }>(`${this.base}/schedules/${scheduleMonthId}/generated-data`);
  }
}
