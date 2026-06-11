import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  BatchDeleteResult,
  CreateVacationBatchPayload,
  CreateVacationPayload,
  UpdateVacationPayload,
  Vacation,
  VacationBatchResult,
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class VacationService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(): Observable<Vacation[]> {
    return this.http.get<Vacation[]>(`${this.base}/vacations`);
  }

  create(payload: CreateVacationPayload): Observable<Vacation> {
    return this.http.post<Vacation>(`${this.base}/vacations`, payload);
  }

  createBatch(payload: CreateVacationBatchPayload): Observable<VacationBatchResult> {
    return this.http.post<VacationBatchResult>(`${this.base}/vacations/batch`, payload);
  }

  update(id: string, payload: UpdateVacationPayload): Observable<Vacation> {
    return this.http.put<Vacation>(`${this.base}/vacations/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/vacations/${id}`);
  }

  deleteBatch(ids: string[]): Observable<BatchDeleteResult> {
    return this.http.delete<BatchDeleteResult>(`${this.base}/vacations/batch`, { body: { ids } });
  }
}
