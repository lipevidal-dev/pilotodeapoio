import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { PendingRequestsBadgeService } from './pending-requests-badge.service';
import type {
  CreatePortalRequestPayload,
  PendingPortalRequest,
  PortalScheduleResponse,
  PortalShiftPreferencesResponse,
  RegisteredApaoPortalFolga,
  SetPortalShiftPreferencePayload,
} from '../models/api.models';

export interface AdminPortalDecisionPayload extends Omit<CreatePortalRequestPayload, 'notes'> {
  employeeId: string;
}

export interface PortalProfileResponse {
  user: { id: string; name: string; email: string; role: string; employeeId?: string | null };
  employeeId: string;
}

@Injectable({ providedIn: 'root' })
export class PortalService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;
  private readonly pendingBadges = inject(PendingRequestsBadgeService);

  getProfile(): Observable<PortalProfileResponse> {
    return this.http.get<PortalProfileResponse>(`${this.base}/portal/profile`);
  }

  getSchedule(year: number, month: number): Observable<PortalScheduleResponse> {
    return this.http.get<PortalScheduleResponse>(`${this.base}/portal/schedules/${year}/${month}`, {
      params: { _ts: Date.now() },
    });
  }

  getExecutedSchedule(year: number, month: number): Observable<PortalScheduleResponse> {
    return this.http.get<PortalScheduleResponse>(
      `${this.base}/portal/schedules/${year}/${month}/executed`,
      { params: { _ts: Date.now() } },
    );
  }

  createRequest(payload: CreatePortalRequestPayload): Observable<unknown> {
    return this.http.post(`${this.base}/portal/requests`, payload);
  }

  cancelRequest(payload: Omit<CreatePortalRequestPayload, 'notes'> & { requestId?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/portal/requests/cancel`, payload);
  }

  listPendingRequests(): Observable<PendingPortalRequest[]> {
    return this.http.get<PendingPortalRequest[]>(`${this.base}/portal/requests/pending`);
  }

  listRegisteredApaoPortalFolgas(): Observable<RegisteredApaoPortalFolga[]> {
    return this.http.get<RegisteredApaoPortalFolga[]>(`${this.base}/portal/requests/registered-apao-folgas`);
  }

  deleteRegisteredApaoFolga(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/pre-allocations/${id}`);
  }

  approveRequest(payload: AdminPortalDecisionPayload): Observable<unknown> {
    return this.http
      .post(`${this.base}/portal/requests/approve`, payload)
      .pipe(tap(() => this.pendingBadges.refresh()));
  }

  rejectRequest(payload: AdminPortalDecisionPayload): Observable<unknown> {
    return this.http
      .post(`${this.base}/portal/requests/reject`, payload)
      .pipe(tap(() => this.pendingBadges.refresh()));
  }

  getShiftPreferences(year: number): Observable<PortalShiftPreferencesResponse> {
    return this.http.get<PortalShiftPreferencesResponse>(`${this.base}/portal/shift-preferences/${year}`);
  }

  setShiftPreference(payload: SetPortalShiftPreferencePayload): Observable<unknown> {
    return this.http.put(`${this.base}/portal/shift-preferences`, payload);
  }
}
