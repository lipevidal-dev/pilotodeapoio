import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { CreateJobRolePayload, JobRole, UpdateJobRolePayload } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(activeOnly = false): Observable<JobRole[]> {
    const q = activeOnly ? '?activeOnly=true' : '';
    return this.http.get<JobRole[]>(`${this.base}/roles${q}`);
  }

  get(id: string): Observable<JobRole> {
    return this.http.get<JobRole>(`${this.base}/roles/${id}`);
  }

  create(payload: CreateJobRolePayload): Observable<JobRole> {
    return this.http.post<JobRole>(`${this.base}/roles`, payload);
  }

  update(id: string, payload: UpdateJobRolePayload): Observable<JobRole> {
    return this.http.put<JobRole>(`${this.base}/roles/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/roles/${id}`);
  }
}
