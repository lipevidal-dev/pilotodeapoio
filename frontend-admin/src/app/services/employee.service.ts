import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { CreateEmployeePayload, Employee, UpdateEmployeePayload } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  list(): Observable<Employee[]> {
    return this.http.get<Employee[]>(`${this.base}/employees`);
  }

  get(id: string): Observable<Employee> {
    return this.http.get<Employee>(`${this.base}/employees/${id}`);
  }

  create(payload: CreateEmployeePayload): Observable<Employee> {
    return this.http.post<Employee>(`${this.base}/employees`, payload);
  }

  update(id: string, payload: UpdateEmployeePayload): Observable<Employee> {
    return this.http.put<Employee>(`${this.base}/employees/${id}`, payload);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/employees/${id}`);
  }
}
