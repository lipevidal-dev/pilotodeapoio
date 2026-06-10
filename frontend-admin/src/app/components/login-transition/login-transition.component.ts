import { Component, OnDestroy, OnInit, signal, output } from '@angular/core';

/** Duração total — sequência visível até glow; sem fade-out (navega com overlay opaco). */
export const LOGIN_TRANSITION_TOTAL_MS = 2800;

const LOADING_MESSAGES = [
  'Preparando ambiente operacional',
  'Carregando informações',
] as const;

@Component({
  selector: 'app-login-transition',
  standalone: true,
  templateUrl: './login-transition.component.html',
  styleUrl: './login-transition.component.scss',
})
export class LoginTransitionComponent implements OnInit, OnDestroy {
  readonly completed = output<void>();
  readonly loadingMessage = signal<string>(LOADING_MESSAGES[0]);

  private completeTimer?: ReturnType<typeof setTimeout>;
  private messageTimer?: ReturnType<typeof setInterval>;
  private messageIndex = 0;

  ngOnInit(): void {
    this.messageTimer = setInterval(() => {
      this.messageIndex = (this.messageIndex + 1) % LOADING_MESSAGES.length;
      this.loadingMessage.set(LOADING_MESSAGES[this.messageIndex]);
    }, 1200);

    this.completeTimer = setTimeout(() => this.completed.emit(), LOGIN_TRANSITION_TOTAL_MS);
  }

  ngOnDestroy(): void {
    if (this.completeTimer) clearTimeout(this.completeTimer);
    if (this.messageTimer) clearInterval(this.messageTimer);
  }
}
