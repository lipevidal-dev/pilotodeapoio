import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { CreateShiftPayload, Shift, UpdateShiftPayload } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class ShiftService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(activeOnly = false): Observable<Shift[]> {
    const q = activeOnly ? '?activeOnly=true' : '';
    return this.http.get<Shift[]>(`${this.base}/shifts${q}`);
  }

  get(id: string): Observable<Shift> {
    return this.http.get<Shift>(`${this.base}/shifts/${id}`);
  }

  create(payload: CreateShiftPayload): Observable<Shift> {
    return this.http.post<Shift>(`${this.base}/shifts`, payload);
  }

  update(id: string, payload: UpdateShiftPayload): Observable<Shift> {
    return this.http.put<Shift>(`${this.base}/shifts/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/shifts/${id}`);
  }
}
