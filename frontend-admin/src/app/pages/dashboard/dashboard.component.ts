import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ApiHealthService } from '../../services/api-health.service';
import { ScheduleService } from '../../services/schedule.service';
import type { HealthResponse, ScheduleMonthResponse } from '../../models/api.models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TagModule, MessageModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly healthService = inject(ApiHealthService);
  private readonly scheduleService = inject(ScheduleService);

  readonly health = signal<HealthResponse | null>(null);
  readonly healthError = signal<string | null>(null);
  readonly loadingHealth = signal(false);
  readonly monthSummary = signal<ScheduleMonthResponse | null>(null);
  readonly monthError = signal<string | null>(null);

  readonly currentYear = new Date().getFullYear();
  readonly currentMonth = new Date().getMonth() + 1;

  ngOnInit(): void {
    this.testConnection();
    this.loadCurrentMonth();
  }

  testConnection(): void {
    this.loadingHealth.set(true);
    this.healthError.set(null);
    this.healthService.checkHealth().subscribe({
      next: (h) => {
        this.health.set(h);
        this.loadingHealth.set(false);
      },
      error: (err) => {
        this.health.set(null);
        this.healthError.set(err?.message ?? 'Falha ao conectar com a API');
        this.loadingHealth.set(false);
      },
    });
  }

  loadCurrentMonth(): void {
    this.scheduleService.getSchedule(this.currentYear, this.currentMonth).subscribe({
      next: (data) => {
        this.monthSummary.set(data);
        this.monthError.set(null);
      },
      error: () => {
        this.monthSummary.set(null);
        this.monthError.set('Nenhuma escala encontrada para o mês atual.');
      },
    });
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'PUBLISHED':
        return 'success';
      case 'GENERATED':
        return 'info';
      default:
        return 'secondary';
    }
  }
}
