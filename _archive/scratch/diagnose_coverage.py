"""Diagnóstico de cobertura — usa banco real do usuário."""
import os
from datetime import timedelta
import pandas as pd

from database.connection import DEFAULT_DB_PATH
from database.repositories import (
    schedule_df, shifts_df, employees_df, allocations_df, build_shift_restriction_map,
)
from services.schedule_service import ScheduleService
from core.scheduler import can_work
from core.rules import month_range, iter_days, build_shift_time_map


def main(year=2026, month=6):
    print("DB:", DEFAULT_DB_PATH, "exists:", DEFAULT_DB_PATH.exists())
    start, end = month_range(year, month)

    gaps = ScheduleService.crosscheck_operational_gaps(year, month)
    print("\n=== LACUNAS (crosscheck) ===")
    if gaps is not None and not gaps.empty:
        print(gaps.to_string(index=False))
    else:
        print("(nenhuma)")

    # Log: inferir do estado atual (geracao nao persiste log — analisamos slots vazios)
    # Por slot faltante: motivo por funcionário
    shift_map = build_shift_time_map()
    shift_restrictions = build_shift_restriction_map(year, month)
    prev_day = start - timedelta(days=1)
    all_existing = schedule_df(prev_day, end)
    planned = {}
    if not all_existing.empty:
        for _, r in all_existing.iterrows():
            planned[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["turno"]
    blocked = {}
    alloc = allocations_df(prev_day, end)
    if not alloc.empty:
        for _, r in alloc.iterrows():
            blocked[(int(r["funcionario_id"]), pd.to_datetime(r["data"]).date())] = r["tipo"]

    print("\n=== DIAGNOSTICO POR SLOT VAZIO ===")
    for role in ["PAO", "APAO", "PAO FCF"]:
        emp_df = employees_df(role)
        sh_df = shifts_df(role)
        if sh_df.empty:
            continue
        for day in iter_days(year, month):
            for _, sh in sh_df.iterrows():
                code = sh["codigo"]
                if code == "ND":
                    continue
                need = int(sh["maximo"])
                have = sum(1 for (eid, d), sc in planned.items() if d == day and sc == code)
                missing = need - have
                if missing <= 0:
                    continue
                print(f"\nFALTA {missing}x {code} ({role}) em {day} [need={need}, have={have}]")
                for _, emp in emp_df.iterrows():
                    rec = emp.to_dict()
                    ok_s, rs = can_work(
                        rec, day, code, blocked, planned,
                        shift_map=shift_map, shift_restrictions=shift_restrictions, strict=True,
                    )
                    ok_l, rl = can_work(
                        rec, day, code, blocked, planned,
                        shift_map=shift_map, shift_restrictions=shift_restrictions, strict=False,
                    )
                    nome = str(rec.get("nome", ""))[:35]
                    if ok_s:
                        print(f"  OK strict  | {nome}")
                    elif ok_l:
                        print(f"  OK relax   | {nome} (strict: {rs[:70]})")
                    else:
                        print(f"  BLOQUEADO  | {nome} | {rl[:90]}")


if __name__ == "__main__":
    main()
