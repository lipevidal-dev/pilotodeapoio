import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export const SCHEDULE_EXPORT_AREA_ID = 'schedule-grid-export-area';

const CAPTURE_CLASS = 'schedule-grid-export-area--capturing';
const CAPTURE_STAGE_ATTR = 'data-schedule-pdf-capture-stage';
const A4_MARGIN_MM = 8;
const TITLE_HEIGHT_MM = 10;

export interface SchedulePdfExportOptions {
  year: number;
  month: number;
  rootId?: string;
  /** Sufixo no título/arquivo (ex.: PAOs, Meu usuário). */
  scopeLabel?: string;
}

function resolveExportElement(rootId: string): HTMLElement | null {
  const root = document.getElementById(rootId);
  if (!root) return null;

  return (
    root.querySelector<HTMLElement>(`#${SCHEDULE_EXPORT_AREA_ID}`) ??
    root.querySelector<HTMLElement>(`.${SCHEDULE_EXPORT_AREA_ID}`) ??
    null
  );
}

function prepareAreaForCapture(area: HTMLElement): void {

  area.classList.add(CAPTURE_CLASS);

  // O controle continua disponível na escala, mas não deve ser impresso no PDF.
  area.querySelectorAll<HTMLElement>('.summary-toolbar, .legend-summary-toggle').forEach((el) => {
    el.style.display = 'none';
  });

  // Estas regras são aplicadas somente à cópia usada pelo PDF, nunca à tela.
  area.querySelectorAll<HTMLElement>('.grid-legend-row, .schedule-legend').forEach((el) => {
    el.style.display = 'flex';
    el.style.width = 'max-content';
    el.style.minWidth = '100%';
    el.style.flexWrap = 'nowrap';
    el.style.gap = '0.35rem';
    el.style.padding = '0.35rem 0.55rem';
  });
  area.querySelectorAll<HTMLElement>('.legend-items').forEach((el) => {
    el.style.flexWrap = 'nowrap';
    el.style.gap = '0.2rem';
  });
  area.querySelectorAll<HTMLElement>('.legend-chip').forEach((el) => {
    el.style.fontSize = '0.58rem';
    el.style.padding = '0.16rem 0.35rem';
  });

  area.querySelectorAll<HTMLElement>('.sticky-col, .sticky-summary-block').forEach((el) => {
    el.style.position = 'static';
    el.style.left = 'auto';
    el.style.zIndex = 'auto';
  });

  area.querySelectorAll<HTMLElement>('.schedule-grid-wrap, .schedule-grid-scroller').forEach((el) => {
    el.style.overflow = 'visible';
    el.style.maxWidth = 'none';
    el.style.maxHeight = 'none';
    el.style.height = 'auto';
    el.style.width = `${el.scrollWidth}px`;
  });

  // A grade pode ultrapassar a altura visível do contêiner. Na cópia, a área
  // precisa assumir a altura real da tabela para não cortar o último colaborador.
  const table = area.querySelector<HTMLElement>('.schedule-grid');
  if (table) {
    table.style.height = 'auto';
    const areaTop = area.getBoundingClientRect().top;
    const tableTop = table.getBoundingClientRect().top;
    const fullHeight = Math.ceil(tableTop - areaTop + table.scrollHeight);
    area.style.height = 'auto';
    area.style.minHeight = `${fullHeight}px`;
  }

  area.querySelectorAll<HTMLElement>('.col-crosshair, .col-crosshair-focus').forEach((el) => {
    el.classList.remove('col-crosshair', 'col-crosshair-focus');
  });
}

function prepareCloneForCapture(doc: Document): void {
  const area = doc.querySelector<HTMLElement>(`[${CAPTURE_STAGE_ATTR}]`);
  if (area) prepareAreaForCapture(area);
}

function createCaptureStage(element: HTMLElement): HTMLElement {
  const stage = element.cloneNode(true) as HTMLElement;
  const sourceTable = element.querySelector<HTMLElement>('.schedule-grid');
  const sourceWidth = Math.ceil(Math.max(element.scrollWidth, sourceTable?.scrollWidth ?? 0));

  stage.removeAttribute('id');
  stage.setAttribute(CAPTURE_STAGE_ATTR, 'true');
  stage.style.position = 'fixed';
  stage.style.top = '0';
  stage.style.left = '0';
  stage.style.zIndex = '-1';
  stage.style.pointerEvents = 'none';
  stage.style.width = `${sourceWidth}px`;
  stage.style.maxWidth = 'none';
  stage.style.height = 'auto';
  stage.style.overflow = 'visible';
  document.body.appendChild(stage);
  prepareAreaForCapture(stage);
  return stage;
}

async function captureFullElement(element: HTMLElement): Promise<HTMLCanvasElement> {
  const stage = createCaptureStage(element);

  try {
    const table = stage.querySelector<HTMLElement>('.schedule-grid');
    const width = Math.ceil(Math.max(stage.scrollWidth, table?.scrollWidth ?? 0));
    const height = Math.ceil(Math.max(stage.scrollHeight, table?.scrollHeight ?? 0));

    return await html2canvas(stage, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
      onclone: prepareCloneForCapture,
    });
  } finally {
    stage.remove();
  }
}

function slugifyScope(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildPdfFilename(year: number, month: number, scopeLabel?: string): string {
  const monthLabel = String(month).padStart(2, '0');
  const scope = scopeLabel ? `-${slugifyScope(scopeLabel)}` : '';
  return `escala-${monthLabel}-${year}${scope}.pdf`;
}

function buildPdfTitle(year: number, month: number, scopeLabel?: string): string {
  const monthLabel = String(month).padStart(2, '0');
  const scope = scopeLabel ? ` — ${scopeLabel}` : '';
  return `Escala ${monthLabel}/${year}${scope}`;
}

/**
 * Captura a área completa da grade (legenda + tabela/resumo) e gera PDF A4
 * com a imagem inteira escalada para caber em uma única página.
 */
export async function exportScheduleToPdfA4(options: SchedulePdfExportOptions): Promise<void> {
  const rootId = options.rootId ?? 'escala-print-root';
  const element = resolveExportElement(rootId);
  if (!element) {
    throw new Error('Área de exportação não encontrada.');
  }

  const canvas = await captureFullElement(element);
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  const landscape = canvas.width >= canvas.height;
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentTop = A4_MARGIN_MM + TITLE_HEIGHT_MM;
  const maxWidth = pageWidth - A4_MARGIN_MM * 2;
  const maxHeight = pageHeight - contentTop - A4_MARGIN_MM;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(
    buildPdfTitle(options.year, options.month, options.scopeLabel),
    A4_MARGIN_MM,
    A4_MARGIN_MM + 4,
  );

  const imgProps = pdf.getImageProperties(imgData);
  const scale = Math.min(maxWidth / imgProps.width, maxHeight / imgProps.height);
  const renderWidth = imgProps.width * scale;
  const renderHeight = imgProps.height * scale;
  const offsetX = A4_MARGIN_MM + (maxWidth - renderWidth) / 2;

  pdf.addImage(imgData, 'JPEG', offsetX, contentTop, renderWidth, renderHeight);
  pdf.save(buildPdfFilename(options.year, options.month, options.scopeLabel));
}

