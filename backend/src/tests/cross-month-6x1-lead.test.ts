import { describe, expect, it } from "vitest";
import { CROSS_MONTH_LOOKBACK_DAYS, lookbackStartDate } from "../domain/schedule/cross-month-history.js";
import { filterStaleCrossMonthPreAllocations } from "../infrastructure/mappers/generation-input.mapper.js";
import {
  enforceMonthStartSixByOneFromPrevious,
} from "../domain/schedule/clean-engine/clean-cross-month-continuity.js";
import { CleanWorkspace } from "../domain/schedule/clean-engine/clean-workspace.js";
import { MOTOR_VERSION_NEXT } from "../domain/schedule/engine-metadata.js";
import type { GenerationInput } from "../domain/schedule/generation-types.js";
import { realisticGenerationInput } from "./realistic-fixtures.js";

describe("cross-month 6x1 alinhado ao espelho (−6) da realizada", () => {
  it("lookback de continuidade é 6 dias (igual ao espelho visual)", () => {
    expect(CROSS_MONTH_LOOKBACK_DAYS).toBe(6);
    expect(lookbackStartDate(2026, 11)).toBe("2026-10-26");
  });

  it("remove FOLGA cross-month obsoleta quando não há 6 turnos na realizada", () => {
    const rows = [
      {
        employeeId: "outro",
        date: new Date(Date.UTC(2026, 10, 1)),
        label: "FOLGA",
        notes: "cross-month:2026-10",
      },
      {
        employeeId: "felipe",
        date: new Date(Date.UTC(2026, 10, 1)),
        label: "FOLGA",
        notes: "cross-month:2026-10",
      },
    ];
    const filtered = filterStaleCrossMonthPreAllocations(rows, {
      assignments: [
        { employeeUuid: "felipe", date: "2026-10-26", shiftCode: "T7" },
        { employeeUuid: "felipe", date: "2026-10-27", shiftCode: "T7" },
        { employeeUuid: "felipe", date: "2026-10-28", shiftCode: "T7" },
        { employeeUuid: "felipe", date: "2026-10-29", shiftCode: "T7" },
        { employeeUuid: "felipe", date: "2026-10-30", shiftCode: "T7" },
        { employeeUuid: "felipe", date: "2026-10-31", shiftCode: "T7" },
      ],
      // ND sozinho não sustenta FOLGA 6x1 no dia 1.
      allocations: [
        { employeeUuid: "outro", date: "2026-10-26", label: "ND" },
        { employeeUuid: "outro", date: "2026-10-27", label: "ND" },
        { employeeUuid: "outro", date: "2026-10-28", label: "ND" },
        { employeeUuid: "outro", date: "2026-10-29", label: "ND" },
        { employeeUuid: "outro", date: "2026-10-30", label: "ND" },
        { employeeUuid: "outro", date: "2026-10-31", label: "ND" },
      ],
    });
    expect(filtered.map((r) => r.employeeId)).toEqual(["felipe"]);
  });

  it("novembro: 6 T7 na realizada (−6) impõe FOLGA no dia 1; ND puro não", () => {
    const input: GenerationInput = realisticGenerationInput({
      year: 2026,
      month: 11,
      crossMonthHistory: {
        assignments: [
          { employeeUuid: "real-1", date: "2026-10-26", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-27", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-28", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-29", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-30", shiftCode: "T7" },
          { employeeUuid: "real-1", date: "2026-10-31", shiftCode: "T7" },
        ],
        allocations: [
          { employeeUuid: "real-2", date: "2026-10-26", label: "ND" },
          { employeeUuid: "real-2", date: "2026-10-27", label: "ND" },
          { employeeUuid: "real-2", date: "2026-10-28", label: "ND" },
          { employeeUuid: "real-2", date: "2026-10-29", label: "ND" },
          { employeeUuid: "real-2", date: "2026-10-30", label: "ND" },
          { employeeUuid: "real-2", date: "2026-10-31", label: "ND" },
        ],
      },
    });
    const options = {
      motorVersion: MOTOR_VERSION_NEXT,
      enabledRules: { max_6_consecutive: true },
      motorParams: { pao_max_consecutivos: 6 },
    };
    const ws = new CleanWorkspace(input, options);
    enforceMonthStartSixByOneFromPrevious(ws);
    const domainByUuid = new Map(input.employees.map((e) => [e.uuid, e.domainId]));
    const felipeKey = `${domainByUuid.get("real-1")}|2026-11-01`;
    const ndOnlyKey = `${domainByUuid.get("real-2")}|2026-11-01`;
    expect(ws.blocked.get(felipeKey)?.toUpperCase()).toBe("FOLGA");
    expect(ws.blocked.get(ndOnlyKey)).toBeUndefined();
  });
});
