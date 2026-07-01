import { Component, input, OnDestroy, signal } from '@angular/core';
import { cellKindClass } from '../../utils/schedule-cell.mapper';
import type { ScheduleCellData } from '../../models/schedule-grid.models';

const HOVER_DELAY_MS = 1000;

@Component({
  selector: 'app-schedule-cell',
  standalone: true,
  templateUrl: './schedule-cell.component.html',
  styleUrl: './schedule-cell.component.scss',
})
export class ScheduleCellComponent implements OnDestroy {
  readonly cell = input.required<ScheduleCellData>();

  readonly hoverVisible = signal(false);

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bloqueia popup até o mouse sair da célula (após clique/arraste). */
  private hoverSuppressed = false;

  cssClass(): string {
    const c = this.cell();
    return cellKindClass(c.kind, c.display);
  }

  hasHoverDetail(): boolean {
    const c = this.cell();
    return !!(c.hoverDetail ?? c.title);
  }

  hoverLines(): string[] {
    const text = this.cell().hoverDetail ?? this.cell().title ?? '';
    return text.split('\n').filter(Boolean);
  }

  onMouseEnter(event: MouseEvent): void {
    if (!this.hasHoverDetail()) return;
    if (this.hoverSuppressed || event.buttons !== 0) return;
    this.clearTimer();
    this.hoverTimer = setTimeout(() => {
      if (!this.hoverSuppressed) this.hoverVisible.set(true);
    }, HOVER_DELAY_MS);
  }

  onMouseLeave(): void {
    this.clearTimer();
    this.hoverVisible.set(false);
    this.hoverSuppressed = false;
  }

  onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    this.dismissHover();
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  private dismissHover(): void {
    this.clearTimer();
    this.hoverVisible.set(false);
    this.hoverSuppressed = true;
  }

  private clearTimer(): void {
    if (this.hoverTimer != null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }
}
