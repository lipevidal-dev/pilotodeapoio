/** 0=domingo … 6=sábado (Date.getDay()). */

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;



/** Cadastro admin — turno desejado por dia da semana. */

export interface FcfScheduleEntry {

  shiftId: string;

  weekday: WeekdayIndex;

}



/** Regra expandida para o motor — um dia + turno por funcionário. */

export interface EmployeeFcfRule {

  employeeUuid: string;

  shiftCode: string;

  weekday: WeekdayIndex;

}



export function normalizeFcfSchedule(

  raw: readonly { kind?: string; shiftId?: string; weekday?: number }[],

): FcfScheduleEntry[] {

  const seen = new Set<number>();

  const out: FcfScheduleEntry[] = [];

  for (const row of raw) {

    if (row.kind === "folga_social") continue;

    const wd = row.weekday;

    if (!Number.isInteger(wd) || wd! < 0 || wd! > 6) continue;

    if (!row.shiftId) continue;

    if (seen.has(wd!)) continue;

    seen.add(wd!);

    out.push({ shiftId: row.shiftId, weekday: wd as WeekdayIndex });

  }

  return out.sort((a, b) => a.weekday - b.weekday);

}



export function parseFcfScheduleJson(raw: unknown): FcfScheduleEntry[] {

  if (!Array.isArray(raw)) return [];

  return normalizeFcfSchedule(raw as { kind?: string; shiftId?: string; weekday?: number }[]);

}



export function validateFcfConfig(input: {

  isFcf: boolean;

  fcfSchedule?: FcfScheduleEntry[] | undefined;

}): string | null {

  if (!input.isFcf) return null;

  return null;

}


