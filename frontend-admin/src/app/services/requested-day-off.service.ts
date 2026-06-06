import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  BatchDeleteResult,
  CreateRequestedDayOffBatchPayload,
  CreateRequestedDayOffPayload,
  RequestedDayOff,
  RequestedDayOffBatchResult,
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class RequestedDayOffService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(): Observable<RequestedDayOff[]> {
    return this.http.get<RequestedDayOff[]>(`${this.base}/requested-day-offs`);
  }

  create(payload: CreateRequestedDayOffPayload): Observable<RequestedDayOff> {
    return this.http.post<RequestedDayOff>(`${this.base}/requested-day-offs`, payload);
  }

  createBatch(payload: CreateRequestedDayOffBatchPayload): Observable<RequestedDayOffBatchResult> {
    return this.http.post<RequestedDayOffBatchResult>(`${this.base}/requested-day-offs/batch`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/requested-day-offs/${id}`);
  }

  deleteBatch(ids: string[]): Observable<BatchDeleteResult> {
    return this.http.delete<BatchDeleteResult>(`${this.base}/requested-day-offs/batch`, {
      body: { ids },
    });
  }
}
