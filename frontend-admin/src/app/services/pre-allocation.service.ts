import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CreatePreAllocationBatchPayload,
  CreatePreAllocationPayload,
  PreAllocation,
  PreAllocationBatchResult,
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class PreAllocationService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(params?: { year?: number; month?: number; scheduleMonthId?: string }): Observable<PreAllocation[]> {
    const q = new URLSearchParams();
    if (params?.year) q.set('year', String(params.year));
    if (params?.month) q.set('month', String(params.month));
    if (params?.scheduleMonthId) q.set('scheduleMonthId', params.scheduleMonthId);
    const qs = q.toString();
    return this.http.get<PreAllocation[]>(`${this.base}/preallocations${qs ? `?${qs}` : ''}`);
  }

  create(payload: CreatePreAllocationPayload): Observable<PreAllocation> {
    return this.http.post<PreAllocation>(`${this.base}/preallocations`, payload);
  }

  createBatch(payload: CreatePreAllocationBatchPayload): Observable<PreAllocationBatchResult> {
    return this.http.post<PreAllocationBatchResult>(`${this.base}/preallocations/batch`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/preallocations/${id}`);
  }
}
