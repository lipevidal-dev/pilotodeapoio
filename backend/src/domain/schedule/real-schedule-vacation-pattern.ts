/** Padrão 3 trabalho / 2 folga no período disponível (férias quinzenais). */
export function vacationPatternWorkTarget(availableDays: number): number {
  if (availableDays <= 0) return 0;
  let work = 0;
  let i = 0;
  while (i < availableDays) {
    const w = Math.min(3, availableDays - i);
    work += w;
    i += w;
    if (i >= availableDays) break;
    const f = Math.min(2, availableDays - i);
    i += f;
  }
  return work;
}

/** Sequência W/F para materialização do padrão 3x2 (W=trabalho, F=folga). */
export function vacationPatternSequence(availableDays: number): ("W" | "F")[] {
  const seq: ("W" | "F")[] = [];
  let i = 0;
  while (i < availableDays) {
    const w = Math.min(3, availableDays - i);
    for (let j = 0; j < w; j++) seq.push("W");
    i += w;
    if (i >= availableDays) break;
    const f = Math.min(2, availableDays - i);
    for (let j = 0; j < f; j++) seq.push("F");
    i += f;
  }
  return seq;
}
