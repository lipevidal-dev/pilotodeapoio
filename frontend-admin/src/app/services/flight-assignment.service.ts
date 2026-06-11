import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  BatchDeleteResult,
  CreateFlightAssignmentBatchPayload,
  CreateFlightAssignmentPayload,
  FlightAssignment,
  FlightAssignmentBatchResult,
  UpdateFlightAssignmentPayload,
} from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class FlightAssignmentService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(): Observable<FlightAssignment[]> {
    return this.http.get<FlightAssignment[]>(`${this.base}/flight-assignments`);
  }

  create(payload: CreateFlightAssignmentPayload): Observable<FlightAssignment> {
    return this.http.post<FlightAssignment>(`${this.base}/flight-assignments`, payload);
  }

  createBatch(payload: CreateFlightAssignmentBatchPayload): Observable<FlightAssignmentBatchResult> {
    return this.http.post<FlightAssignmentBatchResult>(`${this.base}/flight-assignments/batch`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/flight-assignments/${id}`);
  }

  deleteBatch(ids: string[]): Observable<BatchDeleteResult> {
    return this.http.delete<BatchDeleteResult>(`${this.base}/flight-assignments/batch`, {
      body: { ids },
    });
  }

  update(id: string, payload: UpdateFlightAssignmentPayload): Observable<FlightAssignment> {
    return this.http.put<FlightAssignment>(`${this.base}/flight-assignments/${id}`, payload);
  }
}
