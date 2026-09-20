import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of, map } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuthUser, LoginResponse, MeResponse } from '../models/auth.models';
import { homeRouteForRole } from '../models/auth.models';

const STORAGE_TOKEN = 'escala_auth_token';
const STORAGE_USER = 'escala_auth_user';

/** Resposta de login com desafio MFA (produção). */
export interface MfaChallengeResponse {
  mfaRequired?: true;
  mfaSetupRequired?: true;
  challengeToken: string;
  qrCodeDataUrl?: string;
  manualKey?: string;
}

export type LoginResult = LoginResponse | MfaChallengeResponse;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly base = environment.apiBaseUrl;

  private readonly userSignal = signal<AuthUser | null>(this.readStoredUser());
  private readonly tokenSignal = signal<string | null>(this.readStoredToken());

  readonly user = this.userSignal.asReadonly();
  readonly token = this.tokenSignal.asReadonly();
  readonly isAuthenticated = computed(() => !!this.tokenSignal() && !!this.userSignal());

  getToken(): string | null {
    return this.tokenSignal();
  }

  /** Produção espera campo `login` (não `email`). */
  login(login: string, password: string): Observable<LoginResult> {
    return this.http.post<LoginResult>(`${this.base}/auth/login`, { login, password }).pipe(
      tap((res) => {
        if (res && 'token' in res && res.token) {
          this.persistSession(res.token, res.user);
        }
      }),
    );
  }

  completeMfaLogin(challengeToken: string, code: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.base}/auth/login/mfa`, { challengeToken, code })
      .pipe(tap((res) => this.persistSession(res.token, res.user)));
  }

  mfaStatus() {
    return this.http.get<{ enabled: boolean }>(`${this.base}/auth/mfa/status`);
  }

  setupMfa() {
    return this.http.post<{ qrCodeDataUrl: string; manualKey: string }>(
      `${this.base}/auth/mfa/setup`,
      {},
    );
  }

  enableMfa(code: string) {
    return this.http.post<void>(`${this.base}/auth/mfa/enable`, { code });
  }

  disableMfa(code: string) {
    return this.http.post<void>(`${this.base}/auth/mfa/disable`, { code });
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post<void>(`${this.base}/auth/change-password`, {
      currentPassword,
      newPassword,
    });
  }

  restoreSession(): Observable<AuthUser | null> {
    const token = this.getToken();
    if (!token) {
      return of(null);
    }
    return this.http.get<MeResponse>(`${this.base}/auth/me`).pipe(
      map((res) => res.user),
      tap((user) => {
        this.userSignal.set(user);
        sessionStorage.setItem(STORAGE_USER, JSON.stringify(user));
      }),
      catchError(() => {
        this.clearSession();
        return of(null);
      }),
    );
  }

  logout(): void {
    this.clearSession();
    void this.router.navigate(['/login']);
  }

  navigateHome(): void {
    const user = this.userSignal();
    if (!user) {
      void this.router.navigate(['/login']);
      return;
    }
    void this.router.navigate([homeRouteForRole(user.role)]);
  }

  private persistSession(token: string, user: AuthUser): void {
    sessionStorage.setItem(STORAGE_TOKEN, token);
    sessionStorage.setItem(STORAGE_USER, JSON.stringify(user));
    this.tokenSignal.set(token);
    this.userSignal.set(user);
  }

  private clearSession(): void {
    sessionStorage.removeItem(STORAGE_TOKEN);
    sessionStorage.removeItem(STORAGE_USER);
    this.tokenSignal.set(null);
    this.userSignal.set(null);
  }

  private readStoredToken(): string | null {
    return sessionStorage.getItem(STORAGE_TOKEN);
  }

  private readStoredUser(): AuthUser | null {
    const raw = sessionStorage.getItem(STORAGE_USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }
}
