#!/usr/bin/env python3
"""Corrige persistência da troca na escala realizada, sem rebuild do backend."""
from __future__ import annotations

from pathlib import Path
import re
import sys

MARKER_V8 = "/* SWAP_HYDRATE_V8 */"
MARKER_V9 = "/* SWAP_HYDRATE_V9 */"
APPLY_MARKER = "/* SWAP_APPLY_V9 */"

HELPERS = r'''
/* SWAP_HYDRATE_V9 */
function __swapIsBlank(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return true;
  return raw.split("+").every((part) => {
    const p = part.trim().toLowerCase();
    return !p || p === "em branco" || p === "-" || p === "—" || p === "–" || p === "−" || p === "·";
  });
}
function __swapShort(label) {
  const n = String(label ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if (!n) return null;
  if (n.includes("VOO")) return "VOO";
  if (n === "ND" || n.includes("NAO DISPONIVEL") || n.includes("NAO-DISPONIVEL")) return "ND";
  if (n.includes("FOLGA PEDIDA") || n === "FP") return "FP";
  if (n === "FOLGA SOCIAL" || n === "FS") return "FS";
  if (n.includes("FOLGA AGRUPADA") || n === "FA") return "FA";
  if (n.includes("FOLGA ANIVERS") || n === "FANI") return "FANI";
  if (n === "FOLGA" || n === "F") return "F";
  if (n.includes("SIMULADOR")) return "SIM";
  if (n.includes("CURSO")) return "CRS";
  if (n === "CMA") return "CMA";
  if (n.includes("FERIAS")) return "FER";
  return n;
}
function __swapToken(day) {
  if (!day) return "";
  if (day.preAllocation?.label) {
    const fromPre = __swapShort(day.preAllocation.label);
    if (fromPre && !__swapIsBlank(fromPre)) return fromPre;
  }
  const shift = String(day.assignment?.shiftCode ?? "").trim().toUpperCase();
  if (shift && !__swapIsBlank(shift)) return shift;
  if (day.assignment?.label) {
    const fromLabel = __swapShort(day.assignment.label);
    if (fromLabel && !__swapIsBlank(fromLabel)) return fromLabel;
  }
  return "";
}
function __swapSnapshot(token) {
  const code = String(token ?? "").trim().toUpperCase();
  if (!code || __swapIsBlank(code)) return { assignment: null, preAllocation: null };
  const PRE = {
    FA: "FOLGA AGRUPADA", F: "FOLGA", FS: "FOLGA SOCIAL", FP: "FOLGA PEDIDA",
    FANI: "FOLGA ANIVERSARIO", VOO: "VOO", SIM: "SIMULADOR", CRS: "CURSO",
    CMA: "CMA", FER: "FERIAS", ND: "ND",
  };
  if (PRE[code]) {
    return { assignment: null, preAllocation: { label: PRE[code], notes: null, startTime: null, endTime: null } };
  }
  return { assignment: { shiftCode: code, label: null }, preAllocation: null };
}
function __swapOrigPart(joined, index) {
  const parts = String(joined ?? "").split("+").map((p) => p.trim());
  if (parts.length <= 1) return parts[0] ?? "";
  return parts[index] ?? "";
}
async function __swapOrigToken(tx, scheduleMonthId, employeeId, iso, stored) {
  if (!__swapIsBlank(stored)) return String(stored).trim();
  const planned = await __swapReadPlanned(tx, scheduleMonthId, employeeId, iso);
  return __swapToken(planned);
}
async function __swapReadPlanned(tx, scheduleMonthId, employeeId, date) {
  const dbDate = toDbDate(isoDateKey(date));
  const [assignment, preAllocation] = await Promise.all([
    tx.scheduleAssignment.findUnique({ where: { scheduleMonthId_employeeId_date: { scheduleMonthId, employeeId, date: dbDate } } }),
    tx.preAllocation.findUnique({ where: { scheduleMonthId_employeeId_date: { scheduleMonthId, employeeId, date: dbDate } } }),
  ]);
  return {
    assignment: assignment ? { shiftCode: assignment.shiftCode, label: assignment.label } : null,
    preAllocation: preAllocation ? { label: preAllocation.label, notes: preAllocation.notes, startTime: preAllocation.startTime, endTime: preAllocation.endTime } : null,
  };
}
'''

WRAPPER = """
async function readExecutedDay(tx, scheduleMonthId, employeeId, date) {
  const pack = await __readExecutedDayRaw(tx, scheduleMonthId, employeeId, date);
  if (__swapToken(pack && pack.day)) return pack;
  const planned = await __swapReadPlanned(tx, scheduleMonthId, employeeId, date);
  if (__swapToken(planned)) return { dbDate: pack.dbDate, day: planned };
  return pack;
}
"""

APPLY_METHODS = r'''    async applyPeerSwap(tx, row) {
        /* SWAP_APPLY_V9 */
        if (typeof isAdminExecutedAuditNotes === "function" && isAdminExecutedAuditNotes(row.notes)) return;
        const datePairs = resolveSwapDatePairs(row);
        const writes = [];
        for (let i = 0; i < datePairs.length; i++) {
            const pair = datePairs[i];
            let origReq = await __swapOrigToken(tx, row.scheduleMonthId, row.requesterEmployeeId, pair.sourceIso, __swapOrigPart(row.requesterShiftCode, i));
            let origTgt = await __swapOrigToken(tx, row.scheduleMonthId, row.targetEmployeeId, pair.targetIso, __swapOrigPart(row.targetShiftCode, i));
            origReq = __swapIsBlank(origReq) ? "" : String(origReq).trim();
            origTgt = __swapIsBlank(origTgt) ? "" : String(origTgt).trim();
            if (!origReq && !origTgt) continue;
            if (origReq && origTgt && origReq.toUpperCase() === origTgt.toUpperCase()) continue;
            const [requesterPack, targetPack] = await Promise.all([
                readExecutedDay(tx, row.scheduleMonthId, row.requesterEmployeeId, pair.sourceIso),
                readExecutedDay(tx, row.scheduleMonthId, row.targetEmployeeId, pair.targetIso),
            ]);
            writes.push({
                requesterDate: requesterPack.dbDate,
                targetDate: targetPack.dbDate,
                requesterDay: __swapSnapshot(origTgt),
                targetDay: __swapSnapshot(origReq),
            });
        }
        for (const p of writes) {
            await clearExecutedDay(tx, row.scheduleMonthId, row.requesterEmployeeId, p.requesterDate);
            await clearExecutedDay(tx, row.scheduleMonthId, row.targetEmployeeId, p.targetDate);
        }
        for (const p of writes) {
            await writeExecutedDay(tx, row.scheduleMonthId, row.requesterEmployeeId, p.requesterDate, p.requesterDay);
            await writeExecutedDay(tx, row.scheduleMonthId, row.targetEmployeeId, p.targetDate, p.targetDay);
        }
    }
    async applySelfSwap(tx, row) {
        /* SWAP_APPLY_V9 */
        if (typeof isAdminExecutedAuditNotes === "function" && isAdminExecutedAuditNotes(row.notes)) return;
        const datePairs = resolveSwapDatePairs(row);
        if (datePairs.length < 1) {
            throw new ShiftSwapNotAllowedError("Troca interna sem dias de destino.");
        }
        const employeeId = row.requesterEmployeeId;
        const writes = [];
        for (let i = 0; i < datePairs.length; i++) {
            const pair = datePairs[i];
            let origSrc = await __swapOrigToken(tx, row.scheduleMonthId, employeeId, pair.sourceIso, __swapOrigPart(row.requesterShiftCode, i));
            let origDst = await __swapOrigToken(tx, row.scheduleMonthId, employeeId, pair.targetIso, __swapOrigPart(row.targetShiftCode, i));
            origSrc = __swapIsBlank(origSrc) ? "" : String(origSrc).trim();
            origDst = __swapIsBlank(origDst) ? "" : String(origDst).trim();
            if (!origSrc && !origDst) continue;
            if (origSrc && origDst && origSrc.toUpperCase() === origDst.toUpperCase()) continue;
            const [sPack, tPack] = await Promise.all([
                readExecutedDay(tx, row.scheduleMonthId, employeeId, pair.sourceIso),
                readExecutedDay(tx, row.scheduleMonthId, employeeId, pair.targetIso),
            ]);
            writes.push({
                sourceDate: sPack.dbDate,
                targetDate: tPack.dbDate,
                source: __swapSnapshot(origDst),
                target: __swapSnapshot(origSrc),
            });
        }
        for (const p of writes) {
            await clearExecutedDay(tx, row.scheduleMonthId, employeeId, p.sourceDate);
            await clearExecutedDay(tx, row.scheduleMonthId, employeeId, p.targetDate);
        }
        for (const p of writes) {
            await writeExecutedDay(tx, row.scheduleMonthId, employeeId, p.sourceDate, p.source);
            await writeExecutedDay(tx, row.scheduleMonthId, employeeId, p.targetDate, p.target);
        }
    }
'''


def _insert_after_imports(text: str, chunk: str) -> str:
    last = None
    for match in re.finditer(r"^import\s.+?;\s*$", text, re.M):
        last = match
    if not last:
        raise SystemExit("imports não encontrados no use-case compilado")
    at = last.end()
    return text[:at] + "\n" + chunk + text[at:]


def _balanced(text: str) -> bool:
    braces = 0
    parens = 0
    in_str = None
    escape = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            in_str = ch
        elif ch == "{":
            braces += 1
        elif ch == "}":
            braces -= 1
            if braces < 0:
                return False
        elif ch == "(":
            parens += 1
        elif ch == ")":
            parens -= 1
            if parens < 0:
                return False
        i += 1
    return braces == 0 and parens == 0


def _method_span(text: str, name: str) -> tuple[int, int] | None:
    match = re.search(rf"    async {name}\s*\(", text)
    if not match:
        return None
    brace = text.find("{", match.start())
    if brace < 0:
        return None
    depth = 0
    in_str = None
    escape = False
    i = brace
    while i < len(text):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            in_str = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                if end < len(text) and text[end] == "\n":
                    end += 1
                return match.start(), end
        i += 1
    return None


def _replace_helpers(text: str) -> str:
    if MARKER_V9 in text and "__swapSnapshot(" in text:
        return text
    old = re.search(
        r"\n/\* SWAP_HYDRATE_V8 \*/[\s\S]*?async function __swapReadPlanned\([\s\S]*?\n\}\n",
        text,
    )
    if old:
        return text[: old.start()] + "\n" + HELPERS + text[old.end() :]
    if MARKER_V8 in text or MARKER_V9 in text:
        raise SystemExit("helpers da troca encontrados, mas o bloco não bateu para atualizar")
    return _insert_after_imports(text, HELPERS)


def _replace_apply_methods(text: str) -> str:
    if APPLY_MARKER in text and text.count(APPLY_MARKER) >= 2:
        return text
    peer = _method_span(text, "applyPeerSwap")
    self_fn = _method_span(text, "applySelfSwap")
    if not peer or not self_fn:
        raise SystemExit("applyPeerSwap/applySelfSwap não encontrados para gravar orig")
    start = min(peer[0], self_fn[0])
    end = max(peer[1], self_fn[1])
    return text[:start] + APPLY_METHODS + text[end:]


def patch_shift_swap(text: str) -> str:
    text = _replace_helpers(text)

    text = text.replace(
        'const shiftCode = (day.assignment?.shiftCode ?? "").trim();',
        'const shiftCode = ((day.assignment?.shiftCode ?? "").trim() || __swapShort(day.assignment?.label ?? "") || "").trim();',
    )
    text = text.replace(
        "if (day.assignment && shiftCode)",
        "if (shiftCode && !__swapIsBlank(shiftCode))",
    )

    if "async function __readExecutedDayRaw(" not in text:
        renamed = re.sub(
            r"async function readExecutedDay\s*\(",
            "async function __readExecutedDayRaw(",
            text,
            count=1,
        )
        if renamed == text:
            raise SystemExit("readExecutedDay não encontrado para hidratar")
        text = renamed
        idx = text.find("async function __readExecutedDayRaw(")
        text = text[:idx] + WRAPPER + "\n" + text[idx:]

    needs_admin = re.search(
        r"const needsAdmin\s*=\s*isApaoEmployee\(row\.requester\)\s*\|\|\s*isApaoEmployee\(row\.target\);?\s*"
        r"if\s*\(needsAdmin\)\s*\{[\s\S]*?return mapSwap\(updated\);?\s*\}",
        text,
    )
    if needs_admin:
        text = text[: needs_admin.start()] + text[needs_admin.end() :]

    text = _replace_apply_methods(text)

    if not _balanced(text):
        raise SystemExit("patch shift-swap gerou JS desbalanceado")
    if MARKER_V9 not in text or "async function __readExecutedDayRaw(" not in text:
        raise SystemExit("patch shift-swap incompleto")
    if APPLY_MARKER not in text:
        raise SystemExit("patch apply orig ausente")
    return text


def patch_executed_get(text: str) -> str:
    """Não altera getMonth. Reaplicar troca em todo GET derrubou o backend em produção."""
    return text


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("uso: patch-shift-swap.py <arquivo.js> [shift-swap|executed]")
    path = Path(sys.argv[1])
    kind = sys.argv[2] if len(sys.argv) > 2 else "shift-swap"
    if not path.exists():
        raise SystemExit(f"{path} ausente")
    original = path.read_text(encoding="utf-8")
    updated = patch_shift_swap(original) if kind == "shift-swap" else patch_executed_get(original)
    if updated == original:
        print(f"backend já tinha patch {kind}")
        return
    path.write_text(updated, encoding="utf-8")
    print("backend patched:", path, kind)


if __name__ == "__main__":
    main()
