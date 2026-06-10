import { Component } from '@angular/core';

interface LegendItem {
  id: string;
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
    { id: 'shift', label: 'Turnos', cssClass: 'cell-shift' },
    { id: 'nd', label: 'ND', cssClass: 'cell-nd' },
    { id: 'folga', label: 'F', cssClass: 'cell-folga' },
    { id: 'fs', label: 'FS', cssClass: 'cell-fs' },
    { id: 'fa', label: 'FA', cssClass: 'cell-fa' },
    { id: 'fani', label: 'FANI', cssClass: 'cell-fani' },
    { id: 'fp', label: 'FP', cssClass: 'cell-fp' },
    { id: 'fp-weekend', label: 'FP', cssClass: 'cell-fp-weekend' },
    { id: 'ferias', label: 'FÉRIAS', cssClass: 'cell-ferias' },
    { id: 'voo', label: 'Voo', cssClass: 'cell-voo' },
    { id: 'sim', label: 'Sim', cssClass: 'cell-simulador' },
    { id: 'curso', label: 'Curso', cssClass: 'cell-curso' },
    { id: 'cma', label: 'CMA', cssClass: 'cell-cma' },
    { id: 'outro', label: 'Outro', cssClass: 'cell-outro' },
  ];
}
