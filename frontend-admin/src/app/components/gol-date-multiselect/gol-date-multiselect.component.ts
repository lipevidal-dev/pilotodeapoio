import { Component, input, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonModule } from 'primeng/button';
import { formatDatesSummaryPt } from '../../utils/date-format';

@Component({
  selector: 'app-gol-date-multiselect',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerModule, ButtonModule],
  templateUrl: './gol-date-multiselect.component.html',
  styleUrl: './gol-date-multiselect.component.scss',
})
export class GolDateMultiselectComponent {
  readonly selectedDates = model<Date[]>([]);
  readonly hint = input('Selecione uma ou mais datas');
  readonly inline = input(false);

  datesSummary(): string {
    return formatDatesSummaryPt(this.selectedDates());
  }

  clearSelection(): void {
    this.selectedDates.set([]);
  }
}
