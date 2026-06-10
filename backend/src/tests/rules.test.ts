import { describe, it, expect } from "vitest";
import { emptyContext, MOCK_EMPLOYEES } from "./fixtures.js";
import { buildShiftMap } from "../domain/shift/default-shifts.js";
import {
  has12hRest,
  maxSimultaneousWorkersIfAdded,
  canWork,
  canWorkInContext,
  validateSchedule,
  runCoverageGate,
  ndDayAfterT8Pair,
} from "../domain/rules/index.js";
import { assignmentKey, type BlockedMap, type PlannedMap } from "../domain/schedule/types.js";
import { PaoOffLimitRule, ApaoRequiresPaoRule, RequestedOffLimitRule } from "../domain/rules/validators.js";

const shiftMap = buildShiftMap();
const roleMap = new Map(MOCK_EMPLOYEES.map((e) => [e.id, e.role]));

function planned(entries: [number, string, string][]): PlannedMap {
  const m: PlannedMap = new Map();
  for (const [eid, day, code] of entries) {
    m.set(assignmentKey(eid, day), code);
  }
  return m;
}

function blocked(entries: [number, string, string][]): BlockedMap {
  const m: BlockedMap = new Map();
  for (const [eid, day, type] of entries) {
    m.set(assignmentKey(eid, day), type);
  }
  return m;
}

describe("PAO turnos T6, T7, T8", () => {
  it("aceita T6, T7, T8 e rejeita T1 para PAO", () => {
    const pao = MOCK_EMPLOYEES[0];
    const plan = planned([]);
    const block = blocked([]);

    for (const code of ["T6", "T7", "T8"]) {
      const r = canWork(pao, "2026-06-10", code, block, plan, { shiftMap, roleByEmployeeId: roleMap });
      expect(r.ok, code).toBe(true);
    }

    const bad = canWork(pao, "2026-06-10", "T1", block, plan, { shiftMap, roleByEmployeeId: roleMap });
    expect(bad.ok).toBe(false);
  });

  it("validação detecta PAO em turno APAO", () => {
    const ctx = emptyContext();
    ctx.assignments.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      workDate: "2026-06-10",
      shiftCode: "T2",
    });
    const issues = validateSchedule(ctx);
    expect(issues.some((i) => i.type === "TURNO APAO COBERTO POR PAO REGULAR")).toBe(true);
  });
});

describe("T8/T8/ND", () => {
  it("calcula dia ND após par", () => {
    expect(ndDayAfterT8Pair("2026-06-05")).toBe("2026-06-07");
  });

  it("exige ND após dois T8 consecutivos", () => {
    const ctx = emptyContext();
    ctx.assignments.push(
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-05", shiftCode: "T8" },
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-06", shiftCode: "T8" },
    );
    const issues = validateSchedule(ctx);
    expect(issues.some((i) => i.type === "T8 SEM ND")).toBe(true);
  });

  it("não exige ND no mês seguinte quando o par termina no fim do mês", () => {
    const ctx = emptyContext();
    ctx.assignments.push(
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-29", shiftCode: "T8" },
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-30", shiftCode: "T8" },
    );
    const t8Issues = validateSchedule(ctx).filter((i) => i.type === "T8 SEM ND");
    expect(t8Issues.length).toBe(0);
  });

  it("passa com ND no terceiro dia", () => {
    const ctx = emptyContext();
    ctx.assignments.push(
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-05", shiftCode: "T8" },
      { employeeId: 1, employeeName: "PAO SILVA", workDate: "2026-06-06", shiftCode: "T8" },
    );
    ctx.allocations.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      allocDate: "2026-06-07",
      allocType: "ND",
    });
    const t8Issues = validateSchedule(ctx).filter((i) => i.type === "T8 SEM ND");
    expect(t8Issues.length).toBe(0);
  });

  it("canWork bloqueia terceiro T8 consecutivo", () => {
    const pao = MOCK_EMPLOYEES[0];
    const plan = planned([
      [1, "2026-06-04", "T8"],
      [1, "2026-06-05", "T8"],
    ]);
    const r = canWork(pao, "2026-06-06", "T8", blocked([]), plan, {
      shiftMap,
      roleByEmployeeId: roleMap,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("2 dias consecutivos");
  });
});

describe("descanso mínimo 12h", () => {
  it("falha T6 após T7 com menos de 12h", () => {
    const plan = planned([[1, "2026-06-10", "T7"]]);
    const r = has12hRest(1, "2026-06-11", "T6", plan, shiftMap);
    expect(r.ok).toBe(false);
  });

  it("passa T7 após T7 no dia seguinte", () => {
    const plan = planned([[1, "2026-06-10", "T7"]]);
    const r = has12hRest(1, "2026-06-11", "T7", plan, shiftMap);
    expect(r.ok).toBe(true);
  });

  it("simulador com fim 00:00 bloqueia T6 no dia seguinte antes de 12h", () => {
    const plan = planned([]);
    const timed = [{ employeeId: 1, day: "2026-06-10", startTime: "12:00", endTime: "00:00" }];
    const blockedT6 = has12hRest(1, "2026-06-11", "T6", plan, shiftMap, timed);
    const allowedT7 = has12hRest(1, "2026-06-11", "T7", plan, shiftMap, timed);
    expect(blockedT6.ok).toBe(false);
    expect(allowedT7.ok).toBe(true);
  });
});

describe("máximo 2 pessoas simultâneas", () => {
  it("terceiro PAO no mesmo horário excede limite", () => {
    const plan = planned([
      [1, "2026-06-10", "T6"],
      [2, "2026-06-10", "T6"],
    ]);
    const peak = maxSimultaneousWorkersIfAdded(3, "2026-06-10", "T6", plan, shiftMap, roleMap);
    expect(peak).toBeGreaterThan(2);
  });

  it("dois PAO simultâneos ok", () => {
    const plan = planned([[1, "2026-06-10", "T6"]]);
    const peak = maxSimultaneousWorkersIfAdded(2, "2026-06-10", "T6", plan, shiftMap, roleMap);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("APAO nunca sozinho (P-002)", () => {
  it("canWork rejeita APAO sem PAO na janela", () => {
    const apao = MOCK_EMPLOYEES[3];
    const r = canWork(apao, "2026-06-10", "T2", blocked([]), planned([]), {
      shiftMap,
      roleByEmployeeId: roleMap,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("PAO");
  });

  it("canWork aceita APAO com PAO cobrindo T2", () => {
    const apao = MOCK_EMPLOYEES[3];
    const plan = planned([[1, "2026-06-10", "T6"]]);
    const r = canWork(apao, "2026-06-10", "T2", blocked([]), plan, {
      shiftMap,
      roleByEmployeeId: roleMap,
    });
    expect(r.ok).toBe(true);
  });

  it("ApaoRequiresPaoRule detecta escala sem PAO", () => {
    const ctx = emptyContext();
    ctx.assignments.push({
      employeeId: 4,
      employeeName: "APAO LIMA",
      workDate: "2026-06-10",
      shiftCode: "T2",
    });
    const rule = new ApaoRequiresPaoRule();
    const issues = rule.validate(ctx);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].type).toBe("APAO SEM PAO");
  });
});

describe("APAO máximo 6 dias consecutivos", () => {
  it("detecta 7º dia de trabalho", () => {
    const ctx = emptyContext();
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"];
    for (const d of days) {
      ctx.assignments.push({
        employeeId: 4,
        employeeName: "APAO LIMA",
        workDate: d,
        shiftCode: "T2",
      });
      ctx.assignments.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        workDate: d,
        shiftCode: "T6",
      });
    }
    const issues = validateSchedule(ctx).filter((i) => i.type === "APAO SEM FOLGA 6x1");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("canWork bloqueia 7º dia APAO", () => {
    const apao = MOCK_EMPLOYEES[3];
    const plan = planned([
      [4, "2026-06-01", "T2"],
      [4, "2026-06-02", "T2"],
      [4, "2026-06-03", "T2"],
      [4, "2026-06-04", "T2"],
      [4, "2026-06-05", "T2"],
      [4, "2026-06-06", "T2"],
      [1, "2026-06-07", "T6"],
    ]);
    const r = canWork(apao, "2026-06-07", "T2", blocked([]), plan, {
      shiftMap,
      roleByEmployeeId: roleMap,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("6 dias");
  });
});

describe("PAO folgas 10 ideal / 11 permitido", () => {
  it("falha com 9 folgas", () => {
    const ctx = emptyContext();
    for (let d = 1; d <= 9; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA",
      });
    }
    const issues = new PaoOffLimitRule().validate(ctx);
    expect(issues.some((i) => i.type === "FOLGAS PAO")).toBe(true);
  });

  it("passa com 10 folgas", () => {
    const ctx = emptyContext();
    for (let d = 1; d <= 10; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA",
      });
    }
    const issues = new PaoOffLimitRule().validate(ctx).filter((i) => i.employee === "PAO SILVA");
    expect(issues.length).toBe(0);
  });

  it("11 folgas é permitido sem warning", () => {
    const ctx = emptyContext();
    for (let d = 1; d <= 11; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA",
      });
    }
    const issues = new PaoOffLimitRule().validate(ctx).filter((i) => i.employee === "PAO SILVA");
    expect(issues.length).toBe(0);
  });

  it("falha com 12 folgas", () => {
    const ctx = emptyContext();
    for (let d = 1; d <= 12; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA",
      });
    }
    const issues = new PaoOffLimitRule().validate(ctx).filter((i) => i.employee === "PAO SILVA");
    expect(issues.length).toBe(1);
    expect(issues[0].level).toBe("CRITICAL");
  });
});

describe("folga social", () => {
  it("conta FOLGA SOCIAL nas 10 folgas PAO", () => {
    const ctx = emptyContext();
    for (let d = 1; d <= 8; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA",
      });
    }
    ctx.allocations.push(
      { employeeId: 1, employeeName: "PAO SILVA", allocDate: "2026-06-14", allocType: "FOLGA SOCIAL" },
      { employeeId: 1, employeeName: "PAO SILVA", allocDate: "2026-06-15", allocType: "FOLGA SOCIAL" },
    );
    const issues = new PaoOffLimitRule().validate(ctx).filter((i) => i.employee === "PAO SILVA");
    expect(issues.length).toBe(0);
  });
});

describe("monofolga", () => {
  it("alerta folga isolada", () => {
    const ctx = emptyContext();
    ctx.allocations.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      allocDate: "2026-06-15",
      allocType: "FOLGA",
    });
    const issues = validateSchedule(ctx).filter((i) => i.type === "MONOFOLGA");
    expect(issues.length).toBeGreaterThan(0);
  });

  it("APAO não gera alerta de folgas pedidas", () => {
    const ctx = emptyContext();
    const apao = MOCK_EMPLOYEES[3]!;
    for (let d = 10; d <= 14; d++) {
      ctx.allocations.push({
        employeeId: apao.id,
        employeeName: apao.name,
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA PEDIDA",
      });
    }
    const issues = validateSchedule(ctx).filter(
      (i) => i.type === "FOLGAS PEDIDAS" && i.employee === apao.name,
    );
    expect(issues.length).toBe(0);
  });

  it("APAO não gera alerta de monofolga", () => {
    const ctx = emptyContext();
    const apao = MOCK_EMPLOYEES[3]!;
    ctx.allocations.push({
      employeeId: apao.id,
      employeeName: apao.name,
      allocDate: "2026-06-15",
      allocType: "FOLGA",
    });
    const issues = validateSchedule(ctx).filter(
      (i) => i.type === "MONOFOLGA" && i.employee === apao.name,
    );
    expect(issues.length).toBe(0);
  });

  it("FOLGA PEDIDA + FOLGA adjacente não é monofolga", () => {
    const ctx = emptyContext();
    ctx.allocations.push(
      {
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: "2026-06-14",
        allocType: "FOLGA PEDIDA",
      },
      {
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: "2026-06-15",
        allocType: "FOLGA",
      },
    );
    const issues = validateSchedule(ctx).filter((i) => i.type === "MONOFOLGA");
    expect(issues.length).toBe(0);
  });
});

describe("férias", () => {
  it("canWorkInContext bloqueia turno em férias", () => {
    const ctx = emptyContext();
    ctx.allocations.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      allocDate: "2026-06-15",
      allocType: "FÉRIAS",
    });
    const r = canWorkInContext(ctx, MOCK_EMPLOYEES[0], "2026-06-15", "T6", blocked([]));
    expect(r.ok).toBe(false);
  });

  it("validação detecta turno em dia de férias", () => {
    const ctx = emptyContext();
    ctx.allocations.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      allocDate: "2026-06-15",
      allocType: "FÉRIAS",
    });
    ctx.assignments.push({
      employeeId: 1,
      employeeName: "PAO SILVA",
      workDate: "2026-06-15",
      shiftCode: "T6",
    });
    const issues = validateSchedule(ctx).filter((i) => i.type === "TRABALHO EM FÉRIAS");
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("folga pedida FP", () => {
  it("limite de 3 FP por mês", () => {
    const ctx = emptyContext();
    for (let d = 1; d <= 4; d++) {
      ctx.allocations.push({
        employeeId: 1,
        employeeName: "PAO SILVA",
        allocDate: `2026-06-${String(d).padStart(2, "0")}`,
        allocType: "FOLGA PEDIDA",
      });
    }
    const issues = new RequestedOffLimitRule().validate(ctx);
    expect(issues.some((i) => i.type === "FOLGAS PEDIDAS")).toBe(true);
  });

  it("canWork bloqueia turno em dia com FP", () => {
    const ctx = emptyContext();
    const block = blocked([[1, "2026-06-10", "FOLGA PEDIDA"]]);
    const r = canWorkInContext(ctx, MOCK_EMPLOYEES[0], "2026-06-10", "T6", block);
    expect(r.ok).toBe(false);
  });
});

describe("coverage gate", () => {
  it("reporta furos T6/T7/T8", () => {
    const ctx = emptyContext();
    const gate = runCoverageGate(ctx);
    expect(gate.ok).toBe(false);
    expect(gate.gaps).toBeGreaterThan(0);
  });
});
