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

  email = '';
  password = '';
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly showTransition = signal(false);
  private pendingRoute = '/dashboard';

  ngOnInit(): void {
    preloadTransitionAssets();
  }

  submit(): void {
    if (this.loading() || this.showTransition()) return;
    this.errorMessage.set(null);
    this.loading.set(true);
    this.auth.login(this.email.trim(), this.password).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.pendingRoute = homeRouteForRole(res.user.role);
        this.showTransition.set(true);
      },
      error: (err: { error?: { error?: string } }) => {
        this.loading.set(false);
        this.errorMessage.set(err.error?.error ?? 'Não foi possível entrar. Verifique e-mail e senha.');
      },
    });
  }

  onTransitionComplete(): void {
    void this.router.navigateByUrl(this.pendingRoute);
  }
}
