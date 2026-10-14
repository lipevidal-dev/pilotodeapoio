import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import {
  FlightPlanningRequest,
  FlightPlanningRosterEntry,
  FlightPlanningService,
} from '../../../services/flight-planning.service';

@Component({
  selector: 'app-flight-planning-admin',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, ToastModule],
  providers: [MessageService],
  templateUrl: './flight-planning-admin.component.html',
  styleUrls: ['../cadastros-shared.scss', './flight-planning-admin.component.scss'],
})
export class FlightPlanningAdminComponent implements OnInit {
  private readonly flightPlanning = inject(FlightPlanningService);
  private readonly messages = inject(MessageService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly copying = signal(false);
  readonly enabled = signal(false);
  readonly requests = signal<FlightPlanningRequest[]>([]);
  readonly roster = signal<FlightPlanningRosterEntry[]>([]);
  readonly requestedCount = signal(0);
  readonly pendingCount = signal(0);
  readonly selectedEmployeeId = signal<string | null>(null);
  readonly emailText = signal('');

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.flightPlanning.adminView().subscribe({
      next: (view) => {
        this.enabled.set(view.enabled);
        this.requests.set(view.requests);
        this.roster.set(view.roster ?? []);
        this.requestedCount.set(view.requestedCount ?? 0);
        this.pendingCount.set(view.pendingCount ?? 0);
        if (!this.roster().some((row) => row.employeeId === this.selectedEmployeeId())) {
          this.selectedEmployeeId.set(null);
        }
        this.emailText.set(view.emailText);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Não foi possível carregar as solicitações.' });
      },
    });
  }

  toggle(): void {
    const next = !this.enabled();
    this.saving.set(true);
    this.flightPlanning.setEnabled(next).subscribe({
      next: (result) => {
        this.enabled.set(result.enabled);
        this.saving.set(false);
        this.messages.add({
          severity: 'success',
          summary: result.enabled ? 'Habilitado' : 'Desabilitado',
          detail: result.enabled
            ? 'Os colaboradores já podem abrir Voos Planejamento.'
            : 'O menu do colaborador ficou bloqueado.',
        });
      },
      error: () => {
        this.saving.set(false);
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Não foi possível alterar a habilitação.' });
      },
    });
  }

  async copyRequests(): Promise<void> {
    const text = this.emailText().trim();
    if (!text) return;
    this.copying.set(true);
    try {
      await navigator.clipboard.writeText(text);
      this.messages.add({
        severity: 'success',
        summary: 'Copiado',
        detail: 'O texto das solicitações está na área de transferência.',
      });
    } catch {
      this.messages.add({
        severity: 'error',
        summary: 'Não copiou',
        detail: 'O navegador bloqueou a cópia. Selecione o texto abaixo e copie manualmente.',
      });
    } finally {
      this.copying.set(false);
    }
  }

  selectEmployee(employeeId: string): void {
    this.selectedEmployeeId.set(this.selectedEmployeeId() === employeeId ? null : employeeId);
  }

  selectedRequests(): FlightPlanningRequest[] {
    const id = this.selectedEmployeeId();
    if (!id) return [];
    return this.requests().filter((request) => request.employeeId === id);
  }

  selectedName(): string {
    return this.roster().find((row) => row.employeeId === this.selectedEmployeeId())?.name ?? '';
  }

  formatDate(iso: string): string {
    const [year, month, day] = iso.slice(0, 10).split('-');
    if (!year || !month || !day) return iso;
    return `${day}/${month}/${year}`;
  }

  formatSentAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
