import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import {
  FlightPlanningPackage,
  FlightPlanningPeriod,
  FlightPlanningRecord,
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
export class FlightPlanningAdminComponent implements OnInit, OnDestroy {
  private readonly flightPlanning = inject(FlightPlanningService);
  private readonly messages = inject(MessageService);
  private pollId: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot = '';

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly copying = signal(false);
  readonly enabled = signal(false);
  readonly period = signal<FlightPlanningPeriod | null>(null);
  readonly packages = signal<FlightPlanningPackage[]>([]);
  readonly selectedPackageId = signal<string | null>(null);
  readonly periodForm = signal(false);
  readonly editingDates = signal(false);
  periodStart = '';
  periodEnd = '';
  readonly requests = signal<FlightPlanningRequest[]>([]);
  readonly records = signal<FlightPlanningRecord[]>([]);
  readonly roster = signal<FlightPlanningRosterEntry[]>([]);
  readonly requestedCount = signal(0);
  readonly pendingCount = signal(0);
  readonly selectedEmployeeId = signal<string | null>(null);
  readonly emailText = signal('');

  ngOnInit(): void {
    this.reload();
    this.pollId = setInterval(() => this.reload(this.selectedPackageId(), true), 4000);
  }

  ngOnDestroy(): void {
    if (this.pollId) clearInterval(this.pollId);
  }

  reload(packageId = this.selectedPackageId(), quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.flightPlanning.adminView(packageId).subscribe({
      next: (view) => {
        const snapshot = JSON.stringify({
          enabled: view.enabled,
          period: view.period,
          packages: view.packages,
          selectedPackageId: view.selectedPackageId,
          requests: view.requests,
          records: view.records,
          roster: view.roster,
          emailText: view.emailText,
        });
        if (quiet && snapshot === this.lastSnapshot) {
          this.loading.set(false);
          return;
        }
        this.lastSnapshot = snapshot;
        this.enabled.set(view.enabled);
        this.period.set(view.period ?? null);
        this.packages.set(view.packages ?? []);
        this.selectedPackageId.set(view.selectedPackageId ?? null);
        this.requests.set(view.requests);
        this.records.set(view.records ?? []);
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
        if (!quiet) {
          this.messages.add({ severity: 'error', summary: 'Erro', detail: 'Não foi possível carregar as solicitações.' });
        }
      },
    });
  }

  get canClosePeriod(): boolean {
    return this.period() != null;
  }

  periodText(): string {
    const period = this.period();
    if (!period) return 'Menu bloqueado para o colaborador.';
    const range = `${this.formatDate(period.startsOn)} até ${this.formatDate(period.endsOn)}`;
    if (period.status === 'open') return `Portal aberto de ${range}.`;
    if (period.status === 'scheduled') return `Período agendado de ${range}. O portal abre na data inicial.`;
    return `Janela de datas encerrada: ${range}. Altere as datas para reabrir sem desabilitar.`;
  }

  askEnable(): void {
    this.editingDates.set(false);
    this.periodStart = '';
    this.periodEnd = '';
    this.periodForm.set(true);
  }

  askEditDates(): void {
    const period = this.period();
    this.editingDates.set(true);
    this.periodStart = period?.startsOn ?? '';
    this.periodEnd = period?.endsOn ?? '';
    this.periodForm.set(true);
  }

  cancelPeriod(): void {
    this.periodForm.set(false);
    this.editingDates.set(false);
  }

  confirmPeriod(): void {
    this.saving.set(true);
    const editing = this.editingDates();
    this.flightPlanning.setEnabled(true, { startsOn: this.periodStart, endsOn: this.periodEnd }).subscribe({
      next: (result) => {
        this.enabled.set(result.enabled);
        this.periodForm.set(false);
        this.editingDates.set(false);
        this.saving.set(false);
        this.selectedPackageId.set(null);
        this.messages.add({
          severity: 'success',
          summary: editing ? 'Datas atualizadas' : 'Período habilitado',
          detail: editing
            ? 'O período foi alterado sem desabilitar o menu. As solicitações já enviadas continuam no pacote.'
            : result.period?.status === 'scheduled'
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

  selectedRecords(): FlightPlanningRecord[] {
    const id = this.selectedEmployeeId();
    if (!id) return [];
    return this.records().filter((record) => record.employeeId === id);
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
