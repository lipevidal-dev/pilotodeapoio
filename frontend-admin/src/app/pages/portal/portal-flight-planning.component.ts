import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { FlightPlanningService } from '../../services/flight-planning.service';

interface DraftLine {
  date: string;
  description: string;
}

@Component({
  selector: 'app-portal-flight-planning',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, MessageModule],
  templateUrl: './portal-flight-planning.component.html',
  styleUrl: './portal-flight-planning.component.scss',
})
export class PortalFlightPlanningComponent implements OnInit {
  private readonly flightPlanning = inject(FlightPlanningService);

  readonly loading = signal(true);
  readonly enabled = signal(false);
  readonly submitting = signal(false);
  readonly confirmOpen = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  lines: DraftLine[] = [{ date: '', description: '' }];

  ngOnInit(): void {
    this.flightPlanning.status().subscribe({
      next: (status) => {
        this.enabled.set(status.enabled);
        this.loading.set(false);
      },
      error: () => {
        this.enabled.set(false);
        this.loading.set(false);
      },
    });
  }

  addLine(): void {
    this.lines = [...this.lines, { date: '', description: '' }];
  }

  removeLine(index: number): void {
    if (this.lines.length === 1) {
      this.lines = [{ date: '', description: '' }];
      return;
    }
    this.lines = this.lines.filter((_, i) => i !== index);
  }

  askConfirm(): void {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    const invalid = this.lines.findIndex((line) => !line.date || !line.description.trim());
    if (invalid >= 0) {
      this.errorMessage.set(`Preencha a data e a solicitação do voo na linha ${invalid + 1}.`);
      return;
    }
    this.confirmOpen.set(true);
  }

  closeConfirm(): void {
    if (this.submitting()) return;
    this.confirmOpen.set(false);
  }

  confirmSend(): void {
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.flightPlanning
      .submit(this.lines.map((line) => ({ date: line.date, description: line.description.trim() })))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.confirmOpen.set(false);
          this.lines = [{ date: '', description: '' }];
          this.successMessage.set('Solicitação enviada. Ela será avaliada pelo planejamento.');
        },
        error: (err: { error?: { error?: string } }) => {
          this.submitting.set(false);
          this.confirmOpen.set(false);
          this.errorMessage.set(err.error?.error ?? 'Não foi possível enviar a solicitação.');
        },
      });
  }
}
