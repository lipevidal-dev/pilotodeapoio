import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface FlightPlanningLine {
  date: string;
  description: string;
}

export interface FlightPlanningRequest {
  employeeId: string;
  employeeName: string;
  createdAt: string;
  lines: FlightPlanningLine[];
}

export interface FlightPlanningAdminView {
  enabled: boolean;
  requests: FlightPlanningRequest[];
  emailText: string;
}

@Injectable({ providedIn: 'root' })
export class FlightPlanningService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  status(): Observable<{ enabled: boolean }> {
    return this.http.get<{ enabled: boolean }>(`${this.base}/portal/flight-planning`);
  }

  submit(lines: FlightPlanningLine[]): Observable<FlightPlanningRequest> {
    return this.http.post<FlightPlanningRequest>(`${this.base}/portal/flight-planning/requests`, { lines });
  }

  adminView(): Observable<FlightPlanningAdminView> {
    return this.http.get<FlightPlanningAdminView>(`${this.base}/flight-planning`);
  }

  setEnabled(enabled: boolean): Observable<{ enabled: boolean }> {
    return this.http.put<{ enabled: boolean }>(`${this.base}/flight-planning/settings`, { enabled });
  }
}
