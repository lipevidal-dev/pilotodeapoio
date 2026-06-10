import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import type { Employee } from '../../models/api.models';

@Component({
  selector: 'app-cadastro-employee-filter',
  standalone: true,
  imports: [FormsModule, SelectModule],
  template: `
    <div class="field-group cadastro-employee-filter">
      <label class="field-label">Funcionário</label>
      <p-select
        [options]="options()"
        [ngModel]="employeeId()"
        (ngModelChange)="employeeIdChange.emit($event ?? '')"
        optionLabel="label"
        optionValue="value"
        placeholder="Todos os funcionários"
        [showClear]="true"
        class="w-full"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 220px;
        flex: 1 1 220px;
        max-width: 320px;
      }
    `,
  ],
})
export class CadastroEmployeeFilterComponent {
  readonly employees = input.required<Employee[]>();
  readonly employeeId = input('');
  readonly employeeIdChange = output<string>();

  readonly options = computed(() => [
    { label: 'Todos os funcionários', value: '' },
    ...this.employees().map((e) => ({ label: e.name, value: e.id })),
  ]);
}
