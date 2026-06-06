import { Component } from '@angular/core';

interface LegendItem {
  label: string;
  cssClass: string;
}

@Component({
  selector: 'app-schedule-legend',
  standalone: true,
  templateUrl: './schedule-legend.component.html',
  styleUrl: './schedule-legend.component.scss',
})
export class ScheduleLegendComponent {
  readonly items: LegendItem[] = [
    { label: 'Turnos', cssClass: 'cell-shift' },
    { label: 'ND', cssClass: 'cell-nd' },
    { label: 'F', cssClass: 'cell-folga' },
    { label: 'FS', cssClass: 'cell-fs' },
    { label: 'FA', cssClass: 'cell-fa' },
    { label: 'FANI', cssClass: 'cell-fani' },
    { label: 'FP', cssClass: 'cell-fp' },
    { label: 'Férias', cssClass: 'cell-ferias' },
    { label: 'Voo', cssClass: 'cell-voo' },
    { label: 'Sim', cssClass: 'cell-simulador' },
    { label: 'Curso', cssClass: 'cell-curso' },
    { label: 'CMA', cssClass: 'cell-cma' },
    { label: 'Outro', cssClass: 'cell-outro' },
  ];
}
