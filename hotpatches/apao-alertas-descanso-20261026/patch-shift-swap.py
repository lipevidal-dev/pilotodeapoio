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


def patch_shift_swap(text: str) -> str:
    if MARKER not in text:
        text = _insert_after_imports(text, HELPERS)

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

    if not _balanced(text):
        raise SystemExit("patch shift-swap gerou JS desbalanceado")
    if MARKER not in text or "async function __readExecutedDayRaw(" not in text:
        raise SystemExit("patch shift-swap incompleto")
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
