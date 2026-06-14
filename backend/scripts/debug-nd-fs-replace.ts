import { GenerationWorkspace } from "../src/domain/schedule/generation-workspace.js";
import {
  finalizeT8NdBlocks,
  hasNdOnGrid,
  isNdPlacementBlocked,
} from "../src/domain/schedule/schedule-grid-source.js";
import { minimalPaoInput } from "../src/tests/generation-fixtures.js";
import { assignmentKey } from "../src/domain/schedule/types.js";

const ws = new GenerationWorkspace(minimalPaoInput(4));
ws.applyHardBlocks();
const uuid = "uuid-2";
const did = ws.uuidToDomain.get(uuid)!;
ws.planned.set(assignmentKey(did, "2026-06-18"), "T8");
ws.planned.set(assignmentKey(did, "2026-06-19"), "T8");
ws.lockDay(uuid, "2026-06-20", "FOLGA SOCIAL");
console.log("blocked", isNdPlacementBlocked(ws, uuid, "2026-06-20"));
ws.ensureNdForT8Pairs();
console.log("after ensureNd", ws.blocked.get(assignmentKey(did, "2026-06-20")));
console.log("hasNd", hasNdOnGrid(ws, uuid, "2026-06-20"));
