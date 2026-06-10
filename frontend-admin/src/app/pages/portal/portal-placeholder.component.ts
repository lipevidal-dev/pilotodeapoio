import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-portal-placeholder',
  standalone: true,
  imports: [CardModule, MessageModule],
  template: `
    <h1 class="page-title">{{ title }}</h1>
    <p class="page-subtitle">{{ subtitle }}</p>
    <p-card styleClass="gol-card-accent">
      <p-message severity="info" [text]="message" />
    </p-card>
  `,
})
export class PortalPlaceholderComponent {
  private readonly route = inject(ActivatedRoute);

  readonly title = this.route.snapshot.data['title'] as string;
  readonly subtitle =
    (this.route.snapshot.data['subtitle'] as string) ??
    'Funcionalidade prevista para próximas entregas.';
  readonly message =
    (this.route.snapshot.data['message'] as string) ??
    'Em breve você poderá acessar esta área pelo portal do colaborador.';
}
