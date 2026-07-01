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
    { id: 't6', label: 'T6', cssClass: 'cell-t6' },
    { id: 't7', label: 'T7', cssClass: 'cell-t7' },
    { id: 't8', label: 'T8', cssClass: 'cell-t8' },
    { id: 't9', label: 'T9', cssClass: 'cell-t9' },
    { id: 'instruction', label: 'Instrução', cssClass: 'cell-instruction' },
    { id: 'nd', label: 'ND', cssClass: 'cell-nd' },
    { id: 'folga', label: 'F', cssClass: 'cell-folga' },
    { id: 'fs', label: 'FS', cssClass: 'cell-fs' },
    { id: 'fa', label: 'FA', cssClass: 'cell-fa' },
    { id: 'fani', label: 'FANI', cssClass: 'cell-fani' },
    { id: 'fp', label: 'FP', cssClass: 'cell-fp' },
    { id: 'folga-weekend', label: 'Sáb+Dom', cssClass: 'cell-folga-weekend' },
    { id: 'ferias', label: 'FÉRIAS', cssClass: 'cell-ferias' },
    { id: 'voo', label: 'Voo', cssClass: 'cell-voo' },
    { id: 'sim', label: 'Sim', cssClass: 'cell-simulador' },
    { id: 'curso', label: 'Curso', cssClass: 'cell-curso' },
    { id: 'cma', label: 'CMA', cssClass: 'cell-cma' },
    { id: 'outro', label: 'Outro', cssClass: 'cell-outro' },
  ];
}
