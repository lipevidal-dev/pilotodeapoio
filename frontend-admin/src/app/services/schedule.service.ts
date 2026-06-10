import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  GenerateByStepsResponse,
  GenerateApaoScheduleResponse,
  GenerateFlightsResponse,
  GenerateScheduleResponse,
  ManualAllocationType,
  ManualEditResponse,
  PublishScheduleResponse,
  ScheduleMonthResponse,
  StepGenerationOptions,
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

  generateBySteps(
    year: number,
    month: number,
    steps: StepGenerationOptions,
  ): Observable<GenerateByStepsResponse> {
    return this.http.post<GenerateByStepsResponse>(`${this.base}/schedules/generate-by-steps`, {
      year,
      month,
      steps,
    });
  }

  generateFlights(scheduleMonthId: string): Observable<GenerateFlightsResponse> {
    return this.http.post<GenerateFlightsResponse>(
      `${this.base}/schedules/${scheduleMonthId}/generate-flights`,
      {},
    );
  }

  generateApaoSchedule(scheduleMonthId: string): Observable<GenerateApaoScheduleResponse> {
    return this.http.post<GenerateApaoScheduleResponse>(
      `${this.base}/schedules/${scheduleMonthId}/generate-apao`,
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

  manualEditRange(
    scheduleMonthId: string,
    payload: {
      employeeId: string;
      startDate: string;
      endDate: string;
      type: ManualAllocationType;
      mode: 'set' | 'clear';
      force?: boolean;
    },
  ): Observable<ManualEditResponse> {
    return this.http.patch<ManualEditResponse>(
      `${this.base}/schedules/${scheduleMonthId}/manual-range`,
      payload,
    );
  }

  manualMove(
    scheduleMonthId: string,
    payload: {
      source: { employeeId: string; date: string };
      target: { employeeId: string; date: string };
      mode: 'move';
      force?: boolean;
    },
  ): Observable<ManualEditResponse> {
    return this.http.patch<ManualEditResponse>(
      `${this.base}/schedules/${scheduleMonthId}/manual-move`,
      payload,
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
