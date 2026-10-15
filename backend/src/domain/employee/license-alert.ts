/** Janela em que uma licença ou habilitação passa a gerar alerta. */
export const LICENSE_ALERT_DAYS = 60;

export function saoPauloDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Vencida ou com vencimento em até 60 dias, contando o dia de hoje. */
export function isLicenseDueSoon(dueOn: string, today: string, days = LICENSE_ALERT_DAYS): boolean {
  return dueOn <= addIsoDays(today, days);
}
