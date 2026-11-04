#!/usr/bin/env python3
"""Corrige persistência da troca na escala realizada, sem rebuild do backend."""
from __future__ import annotations

from pathlib import Path
import re
import sys

MARKER = "/* SWAP_HYDRATE_V8 */"

HELPERS = r'''
/* SWAP_HYDRATE_V8 */
function __swapIsBlank(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return true;
  return raw.split("+").every((part) => {
    const p = part.trim().toLowerCase();
    return !p || p === "em branco" || p === "-";
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
function __swapFromToken(token) {
  const code = String(token ?? "").trim().toUpperCase();
  if (!code || __swapIsBlank(code)) return { assignment: null, preAllocation: null };
  const pre = { FA: "FOLGA AGRUPADA", F: "FOLGA", FS: "FOLGA SOCIAL", FP: "FOLGA PEDIDA", FANI: "FOLGA ANIVERSARIO", VOO: "VOO", SIM: "SIMULADOR", CRS: "CURSO", CMA: "CMA", FER: "FERIAS", ND: "ND" };
  if (pre[code]) return { assignment: null, preAllocation: { label: pre[code], notes: null, startTime: null, endTime: null } };
  return { assignment: { shiftCode: code, label: null }, preAllocation: null };
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


def patch_shift_swap(text: str) -> str:
    if MARKER not in text:
        insert_at = text.find("async function readExecutedDay")
        if insert_at < 0:
            insert_at = text.find("function readExecutedDay")
        if insert_at < 0:
            raise SystemExit("readExecutedDay não encontrado no use-case compilado")
        text = text[:insert_at] + HELPERS + "\n" + text[insert_at:]

    text = text.replace(
        'const shiftCode = (day.assignment?.shiftCode ?? "").trim();',
        'const shiftCode = ((day.assignment?.shiftCode ?? "").trim() || __swapShort(day.assignment?.label ?? "") || "").trim();',
    )
    text = text.replace(
        'if (day.assignment && shiftCode)',
        'if (shiftCode && !__swapIsBlank(shiftCode))',
    )

    if "async function __readExecutedDayRaw(" not in text:
        if "async function readExecutedDay(" not in text:
            raise SystemExit("readExecutedDay não encontrado para hidratar")
        text = text.replace(
            "async function readExecutedDay(",
            "async function __readExecutedDayRaw(",
            1,
        )
        wrapper = """
async function readExecutedDay(tx, scheduleMonthId, employeeId, date) {
  const pack = await __readExecutedDayRaw(tx, scheduleMonthId, employeeId, date);
  if (__swapToken(pack.day)) return pack;
  const planned = await __swapReadPlanned(tx, scheduleMonthId, employeeId, date);
  if (__swapToken(planned)) return { dbDate: pack.dbDate, day: planned };
  return pack;
}
"""
        idx = text.find("async function __readExecutedDayRaw(")
        text = text[:idx] + wrapper + "\n" + text[idx:]

    # Aceite do colega aplica a troca PEER (PAO e APAO) — não deixa em branco aguardando admin.
    needs_admin = re.search(
        r"const needsAdmin\s*=\s*isApaoEmployee\(row\.requester\)\s*\|\|\s*isApaoEmployee\(row\.target\);\s*"
        r"if \(needsAdmin\) \{[\s\S]*?return mapSwap\(updated\);\s*\}",
        text,
    )
    if needs_admin:
        text = text[: needs_admin.start()] + text[needs_admin.end() :]

    return text


def patch_executed_get(text: str) -> str:
    if "reapplyApprovedForMonth(year, month)" in text and "await this.ensureInitialized(year, month)" in text:
        if "await this.ensureInitialized(year, month);\n        await shiftSwapUseCase.reapplyApprovedForMonth" in text.replace("\r\n", "\n"):
            return text
    old = "const record = await this.ensureInitialized(year, month);"
    new = (
        "await this.ensureInitialized(year, month);\n"
        "        await shiftSwapUseCase.reapplyApprovedForMonth(year, month);\n"
        "        const record = await this.executedRepo.findMonth(year, month);"
    )
    if old not in text:
        old2 = "const record = await this.ensureInitialized(year, month)"
        if old2 in text and "reapplyApprovedForMonth" not in text.split("async getMonth", 1)[-1][:600]:
            text = text.replace(old2, new.rstrip(";"), 1)
            return text
        if "reapplyApprovedForMonth" in text:
            return text
        raise SystemExit("ensureInitialized em getMonth não encontrado")
    if "reapplyApprovedForMonth" in text.split("async getMonth", 1)[-1][:800]:
        return text
    return text.replace(old, new, 1)


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
