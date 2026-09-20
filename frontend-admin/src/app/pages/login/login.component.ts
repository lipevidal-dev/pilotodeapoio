import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../services/auth.service';
import { homeRouteForRole } from '../../models/auth.models';
import { LoginTransitionComponent } from '../../components/login-transition/login-transition.component';
import { preloadTransitionAssets } from '../../components/login-transition/transition-assets.preload';
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC } from '../../core/brand';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    MessageModule,
    LoginTransitionComponent,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Valor enviado como `login` na API de produção. */
  login = '';
  password = '';
  mfaCode = '';
  mfaChallengeToken = '';

  readonly brandLogoSrc = BRAND_LOGO_SRC;
  readonly brandLogoAlt = BRAND_LOGO_ALT;
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly showTransition = signal(false);
  readonly awaitingMfa = signal(false);
  readonly mfaSetupQrCode = signal<string | null>(null);
  readonly mfaManualKey = signal<string | null>(null);
  private pendingRoute = '/dashboard';

  ngOnInit(): void {
    preloadTransitionAssets();
  }

  sanitizeLogin(): void {
    this.login = this.login.trim();
  }

  submit(): void {
    if (this.loading() || this.showTransition()) return;
    this.errorMessage.set(null);
    this.loading.set(true);

    const req$ = this.awaitingMfa()
      ? this.auth.completeMfaLogin(this.mfaChallengeToken, this.mfaCode)
      : this.auth.login(this.login.trim(), this.password);

    req$.subscribe({
      next: (res) => {
        if ('mfaRequired' in res || 'mfaSetupRequired' in res) {
          this.loading.set(false);
          this.mfaChallengeToken = res.challengeToken;
          this.awaitingMfa.set(true);
          if ('mfaSetupRequired' in res) {
            this.mfaSetupQrCode.set(res.qrCodeDataUrl ?? null);
            this.mfaManualKey.set(res.manualKey ?? null);
          }
          this.password = '';
          return;
        }
        if (!('token' in res) || !res.user) {
          this.loading.set(false);
          this.errorMessage.set('Resposta de login inválida.');
          return;
        }
        this.loading.set(false);
        this.pendingRoute = homeRouteForRole(res.user.role);
        this.showTransition.set(true);
      },
      error: (err: { error?: { error?: string } }) => {
        this.loading.set(false);
        this.errorMessage.set(
          err.error?.error ?? 'Não foi possível entrar. Verifique login e senha.',
        );
      },
    });
  }

  onTransitionComplete(): void {
    void this.router.navigateByUrl(this.pendingRoute);
  }
}
