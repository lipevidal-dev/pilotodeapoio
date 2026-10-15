import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CreateEmployeePayload,
  Employee,
  EmployeeMonthlyShiftPreferencesResponse,
  UpdateEmployeePayload,
} from '../models/api.models';

export interface EmployeeLicenseItem {
  id: string;
  dueOn: string;
  description: string;
  alert: boolean;
}

export interface EmployeeLicensesResponse {
  today: string;
  alertUntil: string;
  items: EmployeeLicenseItem[];
}

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

  listLicenseAlerts(): Observable<{ alerts: Array<{ employeeId: string; name: string }> }> {
    return this.http.get<{ alerts: Array<{ employeeId: string; name: string }> }>(
      `${this.base}/employees/license-alerts`,
    );
  }

  getLicenses(id: string): Observable<EmployeeLicensesResponse> {
    return this.http.get<EmployeeLicensesResponse>(`${this.base}/employees/${id}/licenses`);
  }

  replaceLicenses(id: string, items: Array<{ dueOn: string; description: string }>): Observable<EmployeeLicensesResponse> {
    return this.http.put<EmployeeLicensesResponse>(`${this.base}/employees/${id}/licenses`, { items });
  }

  /** Login e senha visíveis do portal. Só administrador. Senha vazia quando ainda não foi gravada para consulta. */
  getPortalAccess(id: string): Observable<{ portalLogin: string | null; portalPassword: string | null }> {
    return this.http.get<{ portalLogin: string | null; portalPassword: string | null }>(
      `${this.base}/employees/${id}/portal-access`,
    );
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

  /** Preferências de turno do portal no mês (admin — exibe código ao lado do nome). */
  listMonthlyShiftPreferences(
    year: number,
    month: number,
  ): Observable<EmployeeMonthlyShiftPreferencesResponse> {
    return this.http.get<EmployeeMonthlyShiftPreferencesResponse>(
      `${this.base}/employees/monthly-shift-preferences/${year}/${month}`,
    );
  }
}
