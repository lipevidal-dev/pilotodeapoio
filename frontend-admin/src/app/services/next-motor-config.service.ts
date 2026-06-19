import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { NextMotorConfigResponse, UpdateNextMotorRulesPayload } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class NextMotorConfigService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/config/next-motor`;

  getConfig(): Observable<NextMotorConfigResponse> {
    return this.http.get<NextMotorConfigResponse>(this.base);
  }

  updateRules(payload: UpdateNextMotorRulesPayload): Observable<NextMotorConfigResponse> {
    return this.http.put<NextMotorConfigResponse>(this.base, payload);
  }
}
