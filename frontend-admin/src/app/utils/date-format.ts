/** Formata yyyy-mm-dd ou ISO sem deslocar por timezone local. */
export function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  try {
    const d = new Date(value);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${day}/${mo}/${y}`;
  } catch {
    return value;
  }
}
export function toInputDate(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

/** Converte Date local para ISO yyyy-mm-dd (sem timezone shift). */
export function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function sortDatesAsc(dates: Date[]): Date[] {
  return [...dates].sort((a, b) => a.getTime() - b.getTime());
}

export function formatDateChip(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function formatDatesSummaryPt(dates: Date[]): string {
  if (dates.length === 0) return '';
  return sortDatesAsc(dates).map(formatDateChip).join(', ');
}

export function datesToIsoList(dates: Date[]): string[] {
  return sortDatesAsc(dates).map(dateToIso);
}
