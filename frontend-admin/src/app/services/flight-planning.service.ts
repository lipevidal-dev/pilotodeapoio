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

export interface FlightPlanningRosterEntry {
  employeeId: string;
  name: string;
  requested: boolean;
}

export interface FlightPlanningPeriod {
  id: string;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'scheduled' | 'closed';
}

export interface FlightPlanningPackage {
  id: string;
  year: number;
  month: number;
  label: string;
  requestCount: number;
}

export interface FlightPlanningAdminView {
  enabled: boolean;
  period: FlightPlanningPeriod | null;
  packages: FlightPlanningPackage[];
  selectedPackageId: string | null;
  requests: FlightPlanningRequest[];
  emailText: string;
  roster: FlightPlanningRosterEntry[];
  requestedCount: number;
  pendingCount: number;
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

  adminView(packageId?: string | null): Observable<FlightPlanningAdminView> {
    const params = packageId ? { packageId } : undefined;
    return this.http.get<FlightPlanningAdminView>(`${this.base}/flight-planning`, { params });
  }

  setEnabled(
    enabled: boolean,
    range?: { startsOn: string; endsOn: string },
  ): Observable<{ enabled: boolean; period: FlightPlanningPeriod | null }> {
    return this.http.put<{ enabled: boolean; period: FlightPlanningPeriod | null }>(
      `${this.base}/flight-planning/settings`,
      { enabled, startsOn: range?.startsOn, endsOn: range?.endsOn },
    );
  }
}
