import { forkJoin, of, type Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface BatchItemResult {
  ok: boolean;
  date: string;
  error?: unknown;
}

/** Executa várias criações em paralelo; ignora falhas individuais (ex.: duplicado). */
export function runBatchCreates(
  dates: string[],
  createOne: (date: string) => Observable<unknown>,
): Observable<{ created: number; skipped: number; results: BatchItemResult[] }> {
  if (dates.length === 0) {
    return of({ created: 0, skipped: 0, results: [] });
  }

  const calls = dates.map((date) =>
    createOne(date).pipe(
      map(() => ({ ok: true as const, date })),
      catchError((error) => of({ ok: false as const, date, error })),
    ),
  );

  return forkJoin(calls).pipe(
    map((results) => ({
      created: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => !r.ok).length,
      results,
    })),
  );
}
