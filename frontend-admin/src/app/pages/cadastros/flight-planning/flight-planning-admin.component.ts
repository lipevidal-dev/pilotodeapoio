import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import {
  FlightPlanningPackage,
  FlightPlanningPeriod,
  FlightPlanningRequest,
  FlightPlanningRosterEntry,
  FlightPlanningService,
} from '../../../services/flight-planning.service';

@Component({
  selector: 'app-flight-planning-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, ToastModule],
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
  readonly period = signal<FlightPlanningPeriod | null>(null);
  readonly packages = signal<FlightPlanningPackage[]>([]);
  readonly selectedPackageId = signal<string | null>(null);
  readonly periodForm = signal(false);
  periodStart = '';
  periodEnd = '';
  readonly requests = signal<FlightPlanningRequest[]>([]);
  readonly roster = signal<FlightPlanningRosterEntry[]>([]);
  readonly requestedCount = signal(0);
  readonly pendingCount = signal(0);
  readonly selectedEmployeeId = signal<string | null>(null);
  readonly emailText = signal('');

  ngOnInit(): void {
    this.reload();
  }

  reload(packageId = this.selectedPackageId()): void {
    this.loading.set(true);
    this.flightPlanning.adminView(packageId).subscribe({
      next: (view) => {
        this.enabled.set(view.enabled);
        this.period.set(view.period ?? null);
        this.packages.set(view.packages ?? []);
        this.selectedPackageId.set(view.selectedPackageId ?? null);
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

  get canClosePeriod(): boolean {
    const status = this.period()?.status;
    return status === 'open' || status === 'scheduled';
  }

  periodText(): string {
    const period = this.period();
    if (!period) return 'Menu bloqueado para o colaborador.';
    const range = `${this.formatDate(period.startsOn)} até ${this.formatDate(period.endsOn)}`;
    if (period.status === 'open') return `Portal aberto de ${range}.`;
    if (period.status === 'scheduled') return `Período agendado de ${range}. O portal abre na data inicial.`;
    return `Período encerrado: ${range}.`;
  }

  askEnable(): void {
    this.periodForm.set(true);
  }

  confirmPeriod(): void {
    this.saving.set(true);
    this.flightPlanning.setEnabled(true, { startsOn: this.periodStart, endsOn: this.periodEnd }).subscribe({
      next: (result) => {
        this.enabled.set(result.enabled);
        this.periodForm.set(false);
        this.saving.set(false);
        this.selectedPackageId.set(null);
        this.messages.add({
          severity: 'success',
          summary: 'Período habilitado',
          detail: result.period?.status === 'scheduled'
            ? 'O portal abre na data inicial. Cada mês vira um pacote.'
            : 'As solicitações de cada mês ficam num pacote para consulta.',
        });
        this.reload(null);
      },
      error: (err: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível habilitar o período.',
        });
      },
    });
  }

  disable(): void {
    this.saving.set(true);
    this.flightPlanning.setEnabled(false).subscribe({
      next: (result) => {
        this.enabled.set(result.enabled);
        this.saving.set(false);
        this.messages.add({
          severity: 'success',
          summary: 'Desabilitado',
          detail: 'O menu do colaborador ficou bloqueado. Os pacotes mensais continuam disponíveis.',
        });
        this.reload(null);
      },
      error: () => {
        this.saving.set(false);
        this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Não foi possível alterar a habilitação.' });
      },
    });
  }

  openPackage(packageId: string): void {
    this.selectedEmployeeId.set(null);
    this.reload(packageId);
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
