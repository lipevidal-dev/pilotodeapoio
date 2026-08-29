import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { PortalService } from '../../services/portal.service';

@Component({
  selector: 'app-portal-vacation-request',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, MessageModule, TextareaModule],
  templateUrl: './portal-vacation-request.component.html',
  styleUrl: './portal-vacation-request.component.scss',
})
export class PortalVacationRequestComponent {
  private readonly portalService = inject(PortalService);

  startDate = '';
  endDate = '';
  notes = '';
  sellTenDays: boolean | null = null;
  thirteenthAdvance: boolean | null = null;
  readonly minDate = new Date().toISOString().slice(0, 10);
  readonly submitting = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  submit(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    if (!this.startDate || !this.endDate) {
      this.errorMessage.set('Informe as datas de início e término das férias.');
      return;
    }
    if (this.endDate < this.startDate) {
      this.errorMessage.set('A data final não pode ser anterior à data inicial.');
      return;
    }
    if (this.sellTenDays === null || this.thirteenthAdvance === null) {
      this.errorMessage.set('Responda às duas opções adicionais antes de enviar.');
      return;
    }

    const [year, month] = this.startDate.split('-').map(Number);
    this.submitting.set(true);
    this.portalService.createRequest({
      year: year!,
      month: month!,
      date: this.startDate,
      endDate: this.endDate,
      type: 'FERIAS',
      notes: this.notes.trim() || undefined,
      sellTenDaysRequested: this.sellTenDays,
      thirteenthAdvanceRequested: this.thirteenthAdvance,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.successMessage.set('Solicitação de férias enviada. Aguarde a aprovação do administrador.');
        this.startDate = '';
        this.endDate = '';
        this.notes = '';
        this.sellTenDays = null;
        this.thirteenthAdvance = null;
      },
      error: (err: { error?: { error?: string } }) => {
        this.submitting.set(false);
        this.errorMessage.set(err.error?.error ?? 'Não foi possível enviar a solicitação de férias.');
      },
    });
  }
}
