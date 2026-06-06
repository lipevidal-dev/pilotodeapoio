import { sortPaoByOperationalPriority } from "./pao-operational-priority.js";
import type { GenerationWorkspace } from "./generation-workspace.js";
import { MIN_MONTHLY_FOLGAS } from "./real-schedule-types.js";
import { wouldExceedT6T7BlockMax } from "./t6-t7-block-coverage.js";

function shouldReserveDaysForFolgas(ws: GenerationWorkspace, uuid: string): boolean {
  const rest = ws.countRest(uuid);
  if (rest >= MIN_MONTHLY_FOLGAS) return false;
  const need = MIN_MONTHLY_FOLGAS - rest;
  return ws.emptyDaysForPao(uuid).length <= need + 1;
}



export interface ResidualT6T7Result {

  gapsBefore: number;

  unitCoverageApplied: number;

  gapsAfter: number;

}



/** Cobertura unitária T6/T7 — T8 já foi alocado antes no motor real. */

export function coverResidualT6T7Only(ws: GenerationWorkspace): ResidualT6T7Result {

  const gapsBefore = ws.listCoverageGaps().length;

  let unitCoverageApplied = 0;



  for (let di = 0; di < ws.days.length; di++) {

    const day = ws.days[di]!;

    const candidates = sortPaoByOperationalPriority(ws, di);



    for (const code of ["T6", "T7"] as const) {

      if (ws.hasPaoCoverage(day, code)) continue;



      let placed = false;

      for (const c of candidates) {

        if (shouldReserveDaysForFolgas(ws, c.uuid)) continue;

        if (wouldExceedT6T7BlockMax(ws, c.uuid, day, code)) continue;

        if (ws.tryAssignShift(c.uuid, day, code)) {

          unitCoverageApplied++;

          placed = true;

          break;

        }

      }

      if (!placed) {

        for (const c of candidates) {

          if (shouldReserveDaysForFolgas(ws, c.uuid)) continue;

          const maxWork = ws.maxWorkDaysForPao(c.uuid);

          if (maxWork != null && ws.workCount(c.uuid) >= maxWork) continue;

          if (ws.tryAssignShift(c.uuid, day, code, true)) {

            unitCoverageApplied++;

            break;

          }

        }

      }

    }

  }



  return {

    gapsBefore,

    unitCoverageApplied,

    gapsAfter: ws.listCoverageGaps().length,

  };

}


