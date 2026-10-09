import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ShiftSwapService } from '../../../services/shift-swap.service';
import type { ShiftSwapRequest } from '../../../models/api.models';

@Component({
  selector: 'app-shift-swaps-admin',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TableModule, TagModule, ToastModule],
  providers: [MessageService],
  templateUrl: './shift-swaps-admin.component.html',
  styleUrl: '../cadastros-shared.scss',
})
export class ShiftSwapsAdminComponent implements OnInit {
  private readonly swapService = inject(ShiftSwapService);
  private readonly messages = inject(MessageService);

  readonly pending = signal<ShiftSwapRequest[]>([]);
  readonly accepted = signal<ShiftSwapRequest[]>([]);
  readonly loading = signal(false);
  readonly actingId = signal<string | null>(null);

  ngOnInit(): void {
    this.reload();
  }

  cellLabel(code: string | null | undefined): string {
    const raw = (code ?? '').trim();
    if (!raw || this.isBlankSwapPart(raw)) return '—';
    return raw
      .split('+')
      .map((part) => (this.isBlankSwapPart(part) ? '—' : part.trim()))
      .join('+');
  }

  private isBlankSwapPart(part: string): boolean {
    const p = part.trim().toLowerCase();
    return !p || p === 'em branco' || p === '-' || p === '—' || p === '–' || p === '−';
  }

  dateRangeLabel(row: ShiftSwapRequest): string {
    const pair =
      (row.pairLength ?? 1) > 1 ? ` (+${(row.pairLength ?? 1) - 1})` : '';
    if (row.targetDate && row.targetDate !== row.date) {
      return `${row.date}${pair} ↔ ${row.targetDate}${pair}`;
    }
    return `${row.date}${pair}`;
  }

  isAdminAudit(row: ShiftSwapRequest): boolean {
    return (row.notes ?? '').includes('__ADMIN_EXECUTED_AUDIT__');
  }

  formatResolvedAt(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  reload(): void {
    this.loading.set(true);
    let pendingDone = false;
    let approvedDone = false;
    const finish = () => {
      if (pendingDone && approvedDone) this.loading.set(false);
    };

    this.swapService.listPendingAdmin().subscribe({
      next: (rows) => {
        this.pending.set(rows);
        pendingDone = true;
        finish();
      },
      error: () => {
        pendingDone = true;
        finish();
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: 'Falha ao carregar trocas pendentes de aprovação.',
        });
      },
    });

    this.swapService.listApprovedAdmin().subscribe({
      next: (rows) => {
        this.accepted.set(rows);
        approvedDone = true;
        finish();
      },
      error: () => {
        approvedDone = true;
        finish();
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: 'Falha ao carregar trocas aceitas.',
        });
      },
    });
  }

  approve(row: ShiftSwapRequest): void {
    this.actingId.set(row.id);
    this.swapService.approve(row.id).subscribe({
      next: () => {
        this.actingId.set(null);
        this.messages.add({
          severity: 'success',
          summary: 'Troca aprovada',
          detail: 'A escala realizada foi atualizada.',
        });
        this.reload();
      },
      error: (err: { error?: { error?: string } }) => {
        this.actingId.set(null);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível aprovar.',
        });
      },
    });
  }

  reject(row: ShiftSwapRequest): void {
    this.actingId.set(row.id);
    this.swapService.rejectByAdmin(row.id).subscribe({
      next: () => {
        this.actingId.set(null);
        this.messages.add({ severity: 'info', summary: 'Troca rejeitada' });
        this.reload();
      },
      error: (err: { error?: { error?: string } }) => {
        this.actingId.set(null);
        this.messages.add({
          severity: 'error',
          summary: 'Erro',
          detail: err.error?.error ?? 'Não foi possível rejeitar.',
        });
      },
    });
  }
}
