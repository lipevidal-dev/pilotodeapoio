"""
Validação estilo planilha Excel — COUNTIF por dia/turno.

Espelha as linhas de contagem da planilha manual (T6/T7/T8, APAO 1-4,
e resumo de bloqueios/produtivos por dia).
"""
from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

import pandas as pd

from core.rules import month_range, iter_days
from database.repositories import schedule_df, allocations_df, employees_df, shifts_df

# Folgas que entram na meta inviolável de 10 (estilo FR/FP/FS da planilha)
REST_COUNT_TYPES = {
    "FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL",
    "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO",
}

PRODUCTIVE_ALLOC_TYPES = {
    "VOO", "CURSO ONLINE", "SIMULADOR", "CMA",
}

PAO_COVERAGE_SHIFTS = ("T6", "T7", "T8")


def _shift_aliases(code: str) -> set:
    c = str(code).strip().upper()
    aliases = {c}
    if c.startswith("T") and c[1:].isdigit():
        aliases.add(c[1:])
    elif c.isdigit():
        aliases.add(f"T{c}")
    return aliases


def count_assignments_on_day(sched: pd.DataFrame, day: date, shift_code: str, cargo: Optional[str] = None) -> int:
    if sched.empty:
        return 0
    aliases = _shift_aliases(shift_code)
    sub = sched[
        (pd.to_datetime(sched["data"]).dt.date == day)
        & (sched["turno"].astype(str).str.upper().isin(aliases))
    ]
    if cargo:
        sub = sub[sub["cargo"].astype(str).str.upper() == cargo.upper()]
    return len(sub)


def count_alloc_on_day(alloc: pd.DataFrame, day: date, tipo: str, cargo: Optional[str] = None) -> int:
    if alloc.empty:
        return 0
    sub = alloc[
        (pd.to_datetime(alloc["data"]).dt.date == day)
        & (alloc["tipo"].astype(str).str.upper() == tipo.upper())
    ]
    if cargo:
        sub = sub[sub["cargo"].astype(str).str.upper() == cargo.upper()]
    return len(sub)


def daily_pao_coverage_matrix(year: int, month: int) -> pd.DataFrame:
    """Linhas estilo planilha: por dia, contagem T6/T7/T8 e status OK/FURO."""
    start_date, end_date = month_range(year, month)
    sched = schedule_df(start_date, end_date)
    rows: List[Dict] = []
    for d in iter_days(year, month):
        for sh in PAO_COVERAGE_SHIFTS:
            have = count_assignments_on_day(sched, d, sh, cargo="PAO")
            need = 1
            rows.append({
                "data": str(d),
                "dia": d.day,
                "turno": sh,
                "tem": have,
                "precisa": need,
                "status": "OK" if have >= need else "FURO",
                "tipo_linha": "COBERTURA PAO",
            })
    return pd.DataFrame(rows)


def daily_apao_coverage_matrix(year: int, month: int) -> pd.DataFrame:
    """Contagem APAO por turno/dia (equivalente COUNTIF turnos 1-4)."""
    start_date, end_date = month_range(year, month)
    sched = schedule_df(start_date, end_date)
    apao_shifts = shifts_df("APAO")
    codes = apao_shifts["codigo"].astype(str).tolist() if not apao_shifts.empty else ["T1", "T2", "T3", "T4"]

    rows: List[Dict] = []
    for d in iter_days(year, month):
        for sh in codes:
            have = count_assignments_on_day(sched, d, sh, cargo="APAO")
            need = int(apao_shifts[apao_shifts["codigo"] == sh]["maximo"].iloc[0]) if not apao_shifts.empty and sh in apao_shifts["codigo"].values else 1
            rows.append({
                "data": str(d),
                "dia": d.day,
                "turno": sh,
                "tem": have,
                "precisa": need,
                "status": "OK" if have >= need else "FURO",
                "tipo_linha": "COBERTURA APAO",
            })
    return pd.DataFrame(rows)


def daily_summary_row(year: int, month: int) -> pd.DataFrame:
    """Resumo por dia: folgas (FR), VOO, curso, CMA, ND — estilo contadores da planilha."""
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    sched = schedule_df(start_date, end_date)
    rows = []
    for d in iter_days(year, month):
        folgas = 0
        if not alloc.empty:
            sub = alloc[pd.to_datetime(alloc["data"]).dt.date == d]
            folgas = len(sub[sub["tipo"].isin(list(REST_COUNT_TYPES))])
        rows.append({
            "data": str(d),
            "dia": d.day,
            "folgas": folgas,
            "voo": count_alloc_on_day(alloc, d, "VOO"),
            "curso": count_alloc_on_day(alloc, d, "CURSO ONLINE"),
            "cma": count_alloc_on_day(alloc, d, "CMA"),
            "simulador": count_alloc_on_day(alloc, d, "SIMULADOR"),
            "nd": count_alloc_on_day(alloc, d, "ND"),
            "pao_t6": count_assignments_on_day(sched, d, "T6", "PAO"),
            "pao_t7": count_assignments_on_day(sched, d, "T7", "PAO"),
            "pao_t8": count_assignments_on_day(sched, d, "T8", "PAO"),
        })
    return pd.DataFrame(rows)


def list_spreadsheet_gaps(year: int, month: int) -> pd.DataFrame:
    """Todos os furos detectados pelo modelo planilha (PAO + APAO)."""
    parts = []
    pao = daily_pao_coverage_matrix(year, month)
    if not pao.empty:
        parts.append(pao[pao["status"] == "FURO"])
    apao = daily_apao_coverage_matrix(year, month)
    if not apao.empty:
        parts.append(apao[apao["status"] == "FURO"])
    if not parts:
        return pd.DataFrame()
    return pd.concat(parts, ignore_index=True)


def coverage_health(year: int, month: int) -> Dict:
    gaps = list_spreadsheet_gaps(year, month)
    pao_gaps = len(gaps[gaps["tipo_linha"] == "COBERTURA PAO"]) if not gaps.empty else 0
    apao_gaps = len(gaps[gaps["tipo_linha"] == "COBERTURA APAO"]) if not gaps.empty and "tipo_linha" in gaps.columns else 0
    total = len(gaps)
    return {
        "total_gaps": total,
        "pao_gaps": pao_gaps,
        "apao_gaps": apao_gaps,
        "ok": total == 0,
        "message": "Cobertura estilo planilha: 100% OK." if total == 0 else f"{total} furo(s) detectado(s) (PAO: {pao_gaps}, APAO: {apao_gaps}).",
    }


def employee_rest_count(year: int, month: int, employee_id: int) -> int:
    start_date, end_date = month_range(year, month)
    alloc = allocations_df(start_date, end_date)
    if alloc.empty:
        return 0
    sub = alloc[
        (alloc["funcionario_id"] == int(employee_id))
        & (alloc["tipo"].isin(list(REST_COUNT_TYPES)))
    ]
    return len(sub)
