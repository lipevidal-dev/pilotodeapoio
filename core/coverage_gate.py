"""Gate de cobertura: 100% T6/T7/T8 antes de VOO/folgas agrupadas."""
from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict, List, Optional

import pandas as pd

from core.rules import month_range, iter_days, consecutive_work_count
from database.repositories import employees_df, schedule_df, allocations_df
from core.spreadsheet_validator import coverage_health, list_spreadsheet_gaps, daily_pao_coverage_matrix


def count_pao_coverage_gaps(year: int, month: int) -> int:
    """Conta furos PAO (T6/T7/T8 vazio) a partir do banco."""
    df = daily_pao_coverage_matrix(year, month)
    if df.empty:
        return len(list(iter_days(year, month))) * 3
    return int((df["status"] == "FURO").sum())


def preload_previous_month_context(planned: dict, start_date, lookback_days: int = 5) -> None:
    """Carrega últimos N dias do mês anterior no planned (base para 6x1)."""
    lookback_start = start_date - timedelta(days=lookback_days)
    prev_end = start_date - timedelta(days=1)
    sched = schedule_df(lookback_start, prev_end)
    if sched.empty:
        return
    for _, r in sched.iterrows():
        key = (int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())
        if r["turno"] and key not in planned:
            planned[key] = r["turno"]


def enforce_month_start_6x1_from_previous(
    year: int, month: int, planned: dict, blocked: dict, log: list,
    roles=("PAO", "APAO"),
) -> None:
    """
    Primeiro passo de alocação: últimos 5 dias do mês anterior.
    Se streak >= 6 → folga obrigatória no dia 1. Caso contrário, registra quantos
    dias ainda pode trabalhar antes de folgar (6 - streak).
    """
    from core.scheduler import _manual_assignment_keys
    from database.repositories import add_allocation

    start_date, end_date = month_range(year, month)
    preload_previous_month_context(planned, start_date, lookback_days=5)
    manual = _manual_assignment_keys(start_date, end_date)

    log.append({
        "tipo": "6X1 INÍCIO MÊS",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": "Verificação carryover 6x1 (últimos 5 dias do mês anterior).",
    })

    for role in roles:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue
        for emp in emp_df.to_dict("records"):
            emp_id = int(emp["id"])
            nome = emp.get("nome", "")
            streak = consecutive_work_count(emp_id, start_date, planned)

            if streak >= 6:
                if (emp_id, start_date) in planned:
                    continue
                if (emp_id, start_date) in manual:
                    continue
                if (emp_id, start_date) not in blocked:
                    add_allocation(
                        emp_id, start_date, "FOLGA",
                        "Gerado automaticamente (6x1 carryover — mês anterior)",
                    )
                    blocked[(emp_id, start_date)] = "FOLGA"
                    log.append({
                        "tipo": "6X1 CARRYOVER",
                        "data": str(start_date),
                        "cargo": role,
                        "turno": "-",
                        "detalhe": (
                            f"{nome}: {streak} dia(s) seguidos no fim do mês anterior "
                            f"→ folga obrigatória no dia 1."
                        ),
                    })
            elif streak > 0:
                remain = 6 - streak
                log.append({
                    "tipo": "6X1 CARRYOVER",
                    "data": str(start_date),
                    "cargo": role,
                    "turno": "-",
                    "detalhe": (
                        f"{nome}: {streak} dia(s) seguidos vindos do mês anterior "
                        f"→ no máximo {remain} dia(s) de turno antes da folga 6x1."
                    ),
                })


def enforce_full_coverage(
    year: int,
    month: int,
    log: list,
    day_order: Optional[List] = None,
    max_attempts: int = 15,
) -> Dict[str, Any]:
    """
    Regra inviolável de cobertura: loop até 0 furos T6/T7/T8 ou esgotar tentativas.
    Não aloca VOO/folgas — só turnos.
    """
    from core.coverage_gate import count_pao_coverage_gaps
    from core.scheduler import (
        force_close_pao_coverage,
        enforce_t8_t8_nd_month,
    )

    attempts = 0
    while attempts < max_attempts:
        gaps = count_pao_coverage_gaps(year, month)
        health = coverage_health(year, month)
        if gaps == 0:
            msg = f"Cobertura PAO T6/T7/T8: 100% ({health.get('message', '')})."
            log.append({
                "tipo": "COBERTURA 100%",
                "data": "-",
                "cargo": "PAO",
                "turno": "-",
                "detalhe": msg,
            })
            return {
                "ok": True,
                "gaps": 0,
                "attempts": attempts,
                "health": health,
                "apao_gaps": health.get("apao_gaps", 0),
            }

        attempts += 1
        log.append({
            "tipo": "COBERTURA GATE",
            "data": "-",
            "cargo": "PAO",
            "turno": "-",
            "detalhe": f"Tentativa {attempts}/{max_attempts}: {gaps} furo(s) — fechando...",
        })

        from core.t8_planner import automated_plan_t8_coverage
        from core.scheduler import _reload_planned_blocked, build_shift_time_map, build_shift_restriction_map

        start_date, end_date = month_range(year, month)
        planned, blocked = _reload_planned_blocked(start_date, end_date)
        shift_map = build_shift_time_map()
        shift_restrictions = build_shift_restriction_map(year, month)
        batch_created, batch_log = [], []
        automated_plan_t8_coverage(
            year, month, planned, blocked, batch_created, batch_log,
            shift_map=shift_map, shift_restrictions=shift_restrictions, max_monthly_work=None,
        )
        from database.repositories import add_assignment
        for wd, sh, eid, note in batch_created:
            add_assignment(wd, sh, eid, note)
        log.extend(batch_log)

        close = force_close_pao_coverage(year, month, day_order=day_order)
        if close.get("log"):
            log.extend(close["log"])
        enforce_t8_t8_nd_month(year, month, log=log)
        close2 = force_close_pao_coverage(year, month, day_order=day_order)
        if close2.get("log"):
            log.extend(close2["log"])
        if close.get("fixed", 0) == 0 and close2.get("fixed", 0) == 0 and attempts > 5:
            break

    gaps_final = count_pao_coverage_gaps(year, month)
    health_final = coverage_health(year, month)
    ok = gaps_final == 0
    if not ok:
        log.append({
            "tipo": "COBERTURA INCOMPLETA",
            "data": "-",
            "cargo": "PAO",
            "turno": "-",
            "detalhe": (
                f"Falha gate cobertura: {gaps_final} furo(s). "
                f"{health_final.get('message', '')} "
                "VOO/folgas agrupadas NÃO serão alocados."
            ),
        })
    return {"ok": ok, "gaps": gaps_final, "attempts": attempts, "health": health_final}


def allocate_post_coverage_rests(
    year: int,
    month: int,
    roles_to_generate: List[str],
    log: list,
) -> None:
    """Após cobertura 100%: folgas (10–11, máx. 12) → VOO no que sobrar."""
    from core.scheduler import (
        auto_add_monthly_rest_allocations,
        auto_add_apao_6x1_rest,
        auto_allocate_rests,
        fill_schedule_blank_cells,
        _enforce_rest_quota,
        _enforce_mandatory_6x1_rests,
        _enforce_max_one_monofolga,
        _compact_rest_runs_for_all,
    )
    from database.repositories import employees_df, heal_apao_agroupada_rules, heal_pao_social_rules

    start_date, end_date = month_range(year, month)
    planned = {}
    sched = schedule_df(start_date, end_date)
    if not sched.empty:
        for _, r in sched.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]

    blocked = {}
    alloc = allocations_df(start_date, end_date)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    log.append({
        "tipo": "FASE FOLGAS",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": "Cobertura OK — alocando folgas (mín. 10, máx. 11; teto 12 se inevitável).",
    })

    if "APAO" in roles_to_generate:
        apao_emps = employees_df("APAO").to_dict("records")
        if apao_emps:
            _compact_rest_runs_for_all(apao_emps, year, month, planned, blocked, log, min_len=1)
    if "PAO" in roles_to_generate:
        pao_emps = employees_df("PAO").to_dict("records")
        if pao_emps:
            _compact_rest_runs_for_all(pao_emps, year, month, planned, blocked, log, min_len=1)

    apao_roles = [r for r in roles_to_generate if r == "APAO"]
    if apao_roles:
        df = auto_add_monthly_rest_allocations(year, month, apao_roles)
        if not df.empty:
            for _, r in df.iterrows():
                log.append({
                    "tipo": str(r.get("tipo", "FOLGA AGRUPADA")),
                    "data": str(r.get("data", "-")),
                    "cargo": str(r.get("cargo", "APAO")),
                    "turno": "-",
                    "detalhe": f"{r.get('funcionario', '')} — folga agrupada/social.",
                })
        auto_add_apao_6x1_rest(year, month, blocked)

    rest_df = auto_allocate_rests(year, month, roles_to_generate, folgas_only=True)
    if not rest_df.empty:
        for _, r in rest_df.iterrows():
            log.append({
                "tipo": str(r.get("tipo", "FOLGA")),
                "data": str(r.get("data", "-")),
                "cargo": str(r.get("cargo", "-")),
                "turno": "-",
                "detalhe": str(r.get("funcionario", r.get("tipo", ""))),
            })

    enforced_6x1 = _enforce_mandatory_6x1_rests(year, month, log=log)
    if enforced_6x1:
        log.append({
            "tipo": "FOLGA 6X1 PÓS",
            "data": "-",
            "cargo": "-",
            "turno": "-",
            "detalhe": f"Varredura 6x1 após folgas: {enforced_6x1} ajuste(s).",
        })

    quota = _enforce_rest_quota(year, month, log=log)
    if quota:
        log.append({
            "tipo": "FOLGA QUOTA RESUMO",
            "data": "-",
            "cargo": "-",
            "turno": "-",
            "detalhe": f"Ajustes quota 10–11 folgas: {quota} alteração(ões).",
        })

    for role in ["PAO", "PAO FCF"]:
        emp_df = employees_df(role)
        if emp_df.empty:
            continue
        for _, emp in emp_df.iterrows():
            _enforce_max_one_monofolga(int(emp["id"]), role, year, month, None)

    if "APAO" in roles_to_generate:
        apao_df = employees_df("APAO")
        if not apao_df.empty:
            for _, emp in apao_df.iterrows():
                heal_apao_agroupada_rules(int(emp["id"]), (year, month))
    all_emp = employees_df()
    if not all_emp.empty:
        for _, emp in all_emp.iterrows():
            emp_cargo = str(emp.get("cargo", "")).strip().upper()
            if emp_cargo in ["PAO", "PAO FCF"]:
                heal_pao_social_rules(int(emp["id"]), (year, month))

    quota2 = _enforce_rest_quota(year, month, log=log)
    if quota2:
        log.append({
            "tipo": "FOLGA QUOTA PÓS-CURA",
            "data": "-",
            "cargo": "-",
            "turno": "-",
            "detalhe": f"Rebalanceamento após cura social: {quota2} alteração(ões).",
        })

    log.append({
        "tipo": "FASE VOO",
        "data": "-",
        "cargo": "-",
        "turno": "-",
        "detalhe": "Folgas fechadas — preenchendo dias livres com VOO.",
    })
    fill_schedule_blank_cells(year, month, log=log)
    fill_schedule_blank_cells(year, month, log=log)


def audit_generation(year: int, month: int) -> Dict[str, Any]:
    """Auditoria pós-geração para diagnóstico."""
    from core.coverage_gate import count_pao_coverage_gaps
    from core.scheduler import count_visual_blank_cells
    from core.rules import validate_rules

    health = coverage_health(year, month)
    gaps = list_spreadsheet_gaps(year, month)
    pao_gaps = count_pao_coverage_gaps(year, month)
    blanks = count_visual_blank_cells(year, month)
    issues = validate_rules(year, month)

    critical = []
    warnings = []
    if pao_gaps > 0:
        critical.append(f"{pao_gaps} furo(s) PAO T6/T7/T8")
    apao_gaps = int(health.get("apao_gaps", 0))
    if apao_gaps > 0:
        warnings.append(f"{apao_gaps} furo(s) APAO")
    if not gaps.empty:
        critical.append(f"{len(gaps)} linha(s) furo estilo planilha")

    alta = issues[issues["gravidade"].isin(["CRÍTICA", "ALTA"])] if not issues.empty else pd.DataFrame()

    return {
        "coverage_ok": pao_gaps == 0,
        "pao_gaps": pao_gaps,
        "blanks": blanks,
        "health": health,
        "sheet_gaps": gaps,
        "critical": critical,
        "warnings": warnings,
        "violations_alta": len(alta),
        "issues_alta": alta.to_dict("records") if not alta.empty else [],
    }
