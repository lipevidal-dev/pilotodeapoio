import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, PasswordModule, MessageModule, InputTextModule],
  templateUrl: './admin-profile.component.html',
  styleUrl: './admin-profile.component.scss',
})
export class AdminProfileComponent implements OnInit {
  private readonly auth = inject(AuthService);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  mfaCode = '';
  notificationEmail = '';
  readonly mfaEnabled = signal(false);
  readonly mfaQrCode = signal<string | null>(null);
  readonly mfaManualKey = signal<string | null>(null);
  readonly mfaLoading = signal(false);

  readonly saving = signal(false);
  readonly savingEmail = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly userName = () => this.auth.user()?.name ?? 'Administrador';
  readonly userLogin = () => this.auth.user()?.email ?? '';

  ngOnInit(): void {
    this.notificationEmail = this.auth.user()?.notificationEmail ?? '';
    this.auth.restoreSession().subscribe({
      next: (user) => {
        if (user) this.notificationEmail = user.notificationEmail ?? '';
      },
    });
    this.auth.mfaStatus().subscribe({ next: (res) => this.mfaEnabled.set(res.enabled) });
  }

  beginMfaSetup(): void {
    this.mfaLoading.set(true); this.errorMessage.set(null);
    this.auth.setupMfa().subscribe({
      next: (res) => { this.mfaLoading.set(false); this.mfaQrCode.set(res.qrCodeDataUrl); this.mfaManualKey.set(res.manualKey); },
      error: () => { this.mfaLoading.set(false); this.errorMessage.set('Não foi possível iniciar a configuração do autenticador.'); },
    });
  }

  confirmMfa(): void {
    if (!/^\d{6}$/.test(this.mfaCode)) { this.errorMessage.set('Informe um código de 6 dígitos.'); return; }
    this.mfaLoading.set(true);
    this.auth.enableMfa(this.mfaCode).subscribe({
      next: () => { this.mfaLoading.set(false); this.mfaEnabled.set(true); this.mfaQrCode.set(null); this.mfaManualKey.set(null); this.mfaCode = ''; this.successMessage.set('Microsoft Authenticator ativado.'); },
      error: (err: { error?: { error?: string } }) => { this.mfaLoading.set(false); this.errorMessage.set(err.error?.error ?? 'Código inválido.'); },
    });
  }

  disableMfa(): void {
    if (!/^\d{6}$/.test(this.mfaCode)) { this.errorMessage.set('Informe o código atual de 6 dígitos.'); return; }
    this.mfaLoading.set(true);
    this.auth.disableMfa(this.mfaCode).subscribe({
      next: () => { this.mfaLoading.set(false); this.mfaEnabled.set(false); this.mfaCode = ''; this.successMessage.set('Autenticação em duas etapas desativada.'); },
      error: (err: { error?: { error?: string } }) => { this.mfaLoading.set(false); this.errorMessage.set(err.error?.error ?? 'Código inválido.'); },
    });
  }

  saveNotificationEmail(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    const value = this.notificationEmail.trim();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      this.errorMessage.set('Informe um e-mail válido ou deixe o campo em branco.');
      return;
    }
    this.savingEmail.set(true);
    this.auth.updateNotificationEmail(value || null).subscribe({
      next: () => {
        this.savingEmail.set(false);
        this.successMessage.set('E-mail de notificação salvo.');
      },
      error: (err: { error?: { error?: string } }) => {
        this.savingEmail.set(false);
        this.errorMessage.set(err.error?.error ?? 'Não foi possível salvar o e-mail.');
      },
    });
  }

  submit(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);

    if (this.newPassword.length < 6) {
      this.errorMessage.set('A nova senha deve ter ao menos 6 caracteres.');
      return;
    }
    if (this.newPassword.length > 20) {
      this.errorMessage.set('A nova senha deve ter no máximo 20 caracteres.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage.set('A confirmação não coincide com a nova senha.');
      return;
    }

    this.saving.set(true);
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.saving.set(false);
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.successMessage.set('Senha alterada com sucesso.');
      },
      error: (err: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.errorMessage.set(err.error?.error ?? 'Não foi possível alterar a senha.');
      },
    });
  }
}
