import pandas as pd
import streamlit as st
from datetime import datetime, date, timedelta
import calendar
import re
from database.connection import execute, query_df, backup_db, get_conn
from core.models import Employee, Shift

# =========================================================================
# REPOSITÓRIO DE FUNCIONÁRIOS (EMPLOYEES) - OTIMIZADO
# =========================================================================

@st.cache_data(ttl=600)
def employees_df(role=None):
    """Busca funcionários com cache para velocidade."""
    if role:
        return query_df("""
            SELECT id, seniority AS senioridade, name AS nome, role AS cargo,
                   fixed_shift_code AS turno_fixo, is_fixed_shift AS fixo,
                   no_flight AS sem_voo, no_flight_start AS sem_voo_inicio,
                   no_flight_end AS sem_voo_fim, no_flight_indefinite AS sem_voo_indeterminado,
                   active AS ativo, notes AS observacao
            FROM employees WHERE role = ? AND active = 1 ORDER BY seniority
        """, (role,))
    return query_df("""
        SELECT id, seniority AS senioridade, name AS nome, role AS cargo,
               fixed_shift_code AS turno_fixo, is_fixed_shift AS fixo,
               no_flight AS sem_voo, no_flight_start AS sem_voo_inicio,
               no_flight_end AS sem_voo_fim, no_flight_indefinite AS sem_voo_indeterminado,
               active AS ativo, notes AS observacao
        FROM employees WHERE active = 1 ORDER BY seniority
    """)

def get_active_employees() -> list[Employee]:
    """Retorna lista de modelos Employee (Necessário para lógica interna)."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM employees WHERE active = 1 ORDER BY seniority")
        return [Employee.from_row(row) for row in cur.fetchall()]
    finally:
        conn.close()

def get_next_seniority(role=None):
    df = query_df("SELECT COALESCE(MAX(seniority), 0) + 1 AS next_s FROM employees")
    return int(df["next_s"].iloc[0])

def normalize_seniority(role=None):
    st.cache_data.clear()
    df = query_df("SELECT id FROM employees ORDER BY seniority, id")
    for idx, row in enumerate(df.itertuples(), start=1):
        execute("UPDATE employees SET seniority = ? WHERE id = ?", (idx, int(row.id)))

def add_employee(name, role, seniority=None, fixed_shift_code=None, is_fixed_shift=0, notes=""):
    st.cache_data.clear()
    name = name.strip().upper()
    role = role.strip().upper()
    if not seniority: seniority = get_next_seniority()
    execute("INSERT OR IGNORE INTO employees (seniority, name, role, fixed_shift_code, is_fixed_shift, notes) VALUES (?, ?, ?, ?, ?, ?)", (int(seniority), name, role, fixed_shift_code, int(is_fixed_shift), notes.strip()))
    normalize_seniority()

def delete_employee(employee_id):
    st.cache_data.clear()
    execute("DELETE FROM assignments WHERE employee_id = ?", (int(employee_id),))
    execute("DELETE FROM allocations WHERE employee_id = ?", (int(employee_id),))
    execute("DELETE FROM employees WHERE id = ?", (int(employee_id),))
    normalize_seniority()

def update_employee(employee_id, name, role, seniority, fixed_shift_code=None, is_fixed_shift=0, no_flight=0, no_flight_start=None, no_flight_end=None, no_flight_indefinite=0, notes=""):
    st.cache_data.clear()
    execute("UPDATE employees SET name = ?, role = ?, seniority = ?, fixed_shift_code = ?, is_fixed_shift = ?, no_flight = ?, no_flight_start = ?, no_flight_end = ?, no_flight_indefinite = ?, notes = ? WHERE id = ?", (name.strip().upper(), role.strip().upper(), int(seniority), fixed_shift_code or None, int(is_fixed_shift), int(no_flight), str(no_flight_start) if no_flight_start else None, str(no_flight_end) if no_flight_end else None, int(no_flight_indefinite), notes.strip(), int(employee_id)))
    normalize_seniority()

# =========================================================================
# REPOSITÓRIO DE TURNOS (SHIFTS) - OTIMIZADO
# =========================================================================

@st.cache_data(ttl=600)
def shifts_df(role=None):
    if role:
        return query_df("SELECT id, code AS codigo, role AS cargo, name AS nome, start_time AS inicio, end_time AS fim, min_staff AS minimo, max_staff AS maximo, active AS ativo, no_fds FROM shifts WHERE role = ? AND active = 1 ORDER BY code", (role,))
    return query_df("SELECT id, code AS codigo, role AS cargo, name AS nome, start_time AS inicio, end_time AS fim, min_staff AS minimo, max_staff AS maximo, active AS ativo, no_fds FROM shifts WHERE active = 1 ORDER BY cargo, code")

def get_active_shifts() -> list[Shift]:
    """Retorna lista de modelos Shift (Resolve o erro do seu print)."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM shifts WHERE active = 1 ORDER BY role, code")
        return [Shift.from_row(row) for row in cur.fetchall()]
    finally:
        conn.close()

def add_shift(code, role, name, start_time, end_time, min_staff, max_staff, no_fds=0):
    st.cache_data.clear()
    execute("INSERT OR REPLACE INTO shifts (code, role, name, start_time, end_time, min_staff, max_staff, active, no_fds) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)", (code.strip().upper(), role, name.strip(), start_time, end_time, int(min_staff), int(max_staff), int(no_fds)))

def delete_shift(code):
    st.cache_data.clear()
    execute("DELETE FROM assignments WHERE shift_code = ?", (code,))
    execute("UPDATE shifts SET active = 0 WHERE code = ?", (code,))

def update_shift(code, role, name, start_time, end_time, min_staff, max_staff, no_fds):
    st.cache_data.clear()
    execute("UPDATE shifts SET role = ?, name = ?, start_time = ?, end_time = ?, min_staff = ?, max_staff = ?, no_fds = ? WHERE code = ?", (role.strip().upper(), name.strip(), start_time.strip(), end_time.strip(), int(min_staff), int(max_staff), int(no_fds), code.strip().upper()))

# =========================================================================
# PRÉ-ALOCAÇÕES E RESTRIÇÕES
# =========================================================================

@st.cache_data(ttl=600)
def allocations_df(start_date=None, end_date=None, role=None):
    where, params = [], []
    if start_date and end_date:
        where.append("a.alloc_date BETWEEN ? AND ?")
        params += [str(start_date), str(end_date)]
    if role:
        where.append("e.role = ?")
        params.append(role)
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    return query_df(f"SELECT a.id, a.alloc_date AS data, e.id AS funcionario_id, e.seniority AS senioridade, e.name AS funcionario, e.role AS cargo, a.alloc_type AS tipo, a.notes AS observacao FROM allocations a JOIN employees e ON e.id = a.employee_id {where_sql} ORDER BY a.alloc_date, e.role, e.seniority", params)

@st.cache_data(ttl=600)
def shift_restrictions_df(year=None, month=None, role=None):
    where, params = [], []
    if year and month:
        where.append("sr.year = ? AND sr.month = ?")
        params += [int(year), int(month)]
    if role:
        where.append("e.role = ?")
        params.append(role)
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    return query_df(f"SELECT sr.id, sr.year AS ano, sr.month AS mes, e.id AS funcionario_id, e.seniority AS senioridade, e.name AS funcionario, e.role AS cargo, sr.shift_code AS turno_bloqueado, sr.notes AS observacao FROM shift_restrictions sr JOIN employees e ON e.id = sr.employee_id {where_sql} ORDER BY sr.year, sr.month, e.role, e.seniority, sr.shift_code", params)

def add_shift_restriction(employee_id, year, month, shift_code, notes=""):
    st.cache_data.clear()
    execute("INSERT OR REPLACE INTO shift_restrictions (employee_id, year, month, shift_code, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", (int(employee_id), int(year), int(month), str(shift_code).upper(), notes.strip(), datetime.now().isoformat()))

def build_shift_restriction_map(year, month):
    df = shift_restrictions_df(year, month)
    restrictions = {}
    if df.empty: return restrictions
    for _, r in df.iterrows():
        emp_id = int(r["funcionario_id"])
        restrictions.setdefault(emp_id, set()).add(str(r["turno_bloqueado"]).upper())
    return restrictions

# =========================================================================
# ESCALA E BATCH INSERTS (ALTA VELOCIDADE)
# =========================================================================

def add_assignments_batch(data_list):
    """Salva a escala inteira em uma única transação."""
    if not data_list: return
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.executemany("INSERT OR IGNORE INTO assignments (work_date, shift_code, employee_id, notes, created_at) VALUES (?, ?, ?, ?, ?)", data_list)
        conn.commit()
    finally:
        conn.close()

def schedule_df(start_date=None, end_date=None, role=None):
    where, params = [], []
    if start_date and end_date:
        where.append("a.work_date BETWEEN ? AND ?")
        params += [str(start_date), str(end_date)]
    if role:
        where.append("e.role = ?")
        params.append(role)
    where_sql = "WHERE " + " AND ".join(where) if where else ""
    return query_df(f"SELECT a.id, a.work_date AS data, e.id AS funcionario_id, e.seniority AS senioridade, e.name AS funcionario, e.role AS cargo, a.shift_code AS turno, s.start_time AS inicio, s.end_time AS fim, a.notes AS observacao FROM assignments a JOIN employees e ON e.id = a.employee_id JOIN shifts s ON s.code = a.shift_code {where_sql} ORDER BY a.work_date, e.role, a.shift_code, e.seniority", params)

def delete_month_schedule(year, month, delete_preallocations=False):
    st.cache_data.clear()
    first = date(int(year), int(month), 1)
    last = date(int(year), int(month), calendar.monthrange(int(year), int(month))[1])
    
    # 1. Deleta todas as atribuições de turnos (assignments) do mês
    execute("DELETE FROM assignments WHERE work_date BETWEEN ? AND ?", (str(first), str(last)))
    
    if delete_preallocations:
        # Se for para limpar tudo (pré-alocações inclusas), deleta todas as alocações do mês
        execute("DELETE FROM allocations WHERE alloc_date BETWEEN ? AND ?", (str(first), str(last)))
    else:
        # Preservar pré-alocações manuais e restaurar as promovidas automaticamente
        rows = query_df(
            "SELECT id, alloc_type, notes FROM allocations WHERE alloc_date BETWEEN ? AND ?",
            (str(first), str(last))
        )
        
        KEPT_TYPES = {
            "FOLGA PEDIDA",
            "FOLGA ESCOLHIDA",
            "FOLGA ANIVERSÁRIO",
            "FÉRIAS",
            "DISPENSA MÉDICA",
            "CURSO ONLINE",
            "SIMULADOR"
        }
        
        def is_kept(alloc_type, notes):
            alloc_type_up = str(alloc_type).upper()
            return alloc_type_up in {
                "FOLGA PEDIDA",
                "FOLGA ESCOLHIDA",
                "FOLGA ANIVERSÁRIO",
                "FÉRIAS",
                "DISPENSA MÉDICA",
                "CURSO ONLINE",
                "SIMULADOR"
            }
        
        if not rows.empty:
            for _, r in rows.iterrows():
                alloc_id = int(r["id"])
                alloc_type = str(r["alloc_type"]).upper()
                notes = r["notes"]
                notes = str(notes) if pd.notna(notes) else ""
                orig_type, clean_notes = extract_original_type(notes)
                
                # Se o tipo atual for FOLGA SOCIAL ou FOLGA AGRUPADA:
                if alloc_type in ("FOLGA SOCIAL", "FOLGA AGRUPADA"):
                    if orig_type and is_kept(orig_type, clean_notes):
                        # Restaura a folga pedida/escolhida original
                        execute(
                            "UPDATE allocations SET alloc_type = ?, notes = ? WHERE id = ?",
                            (orig_type, clean_notes, alloc_id)
                        )
                    else:
                        # Se não tinha orig_type que devia ser mantido, era apenas folga normal promovida, então deleta
                        execute("DELETE FROM allocations WHERE id = ?", (alloc_id,))
                elif is_kept(alloc_type, notes):
                    # É um tipo que deve ser mantido.
                    if orig_type:
                        execute(
                            "UPDATE allocations SET notes = ? WHERE id = ?",
                            (clean_notes, alloc_id)
                        )
                    else:
                        pass
                else:
                    # Qualquer outro tipo (como FOLGA simples, VOO, ND, mesmo que marcados manualmente)
                    # DEVE ser excluído da base para não travar o scheduler.
                    execute("DELETE FROM allocations WHERE id = ?", (alloc_id,))
                    
    st.cache_data.clear()
    return {"status": "ok"}

def add_assignment(work_date, shift_code, employee_id, notes=""):
    st.cache_data.clear()
    execute("INSERT OR IGNORE INTO assignments (work_date, shift_code, employee_id, notes, created_at) VALUES (?, ?, ?, ?, ?)",
            (str(work_date), shift_code, int(employee_id), notes.strip(), datetime.now().isoformat()))
    st.cache_data.clear()

def add_allocation(employee_id, alloc_date, alloc_type, notes=""):
    st.cache_data.clear()
    execute("INSERT OR REPLACE INTO allocations (employee_id, alloc_date, alloc_type, notes, created_at) VALUES (?, ?, ?, ?, ?)",
            (int(employee_id), str(alloc_date), str(alloc_type).strip(), notes.strip(), datetime.now().isoformat()))
    heal_pao_social_rules(employee_id, alloc_date)
    heal_apao_agroupada_rules(employee_id, alloc_date)
    st.cache_data.clear()

def delete_day_assignment_for_employee(employee_id, work_date):
    st.cache_data.clear()
    execute("DELETE FROM assignments WHERE employee_id = ? AND work_date = ?", (int(employee_id), str(work_date)))
    st.cache_data.clear()

def delete_day_allocation_for_employee(employee_id, alloc_date):
    st.cache_data.clear()
    execute("DELETE FROM allocations WHERE employee_id = ? AND alloc_date = ?", (int(employee_id), str(alloc_date)))
    heal_pao_social_rules(employee_id, alloc_date)
    heal_apao_agroupada_rules(employee_id, alloc_date)
    st.cache_data.clear()

def delete_allocation_by_id(alloc_id):
    st.cache_data.clear()
    row = query_df("SELECT employee_id, alloc_date FROM allocations WHERE id = ?", (int(alloc_id),))
    if not row.empty:
        emp_id = int(row.iloc[0]["employee_id"])
        alloc_date = pd.to_datetime(row.iloc[0]["alloc_date"]).date()
        execute("DELETE FROM allocations WHERE id = ?", (int(alloc_id),))
        heal_pao_social_rules(emp_id, alloc_date)
        heal_apao_agroupada_rules(emp_id, alloc_date)
    st.cache_data.clear()

def get_assignment_by_date_shift(work_date, shift_code):
    sched = schedule_df(work_date, work_date)
    return sched[sched["turno"] == str(shift_code).strip().upper()] if not sched.empty else pd.DataFrame()

def heal_apao_agroupada_rules(employee_id, date_or_month):
    try:
        if isinstance(date_or_month, (datetime, date)): dt = date_or_month
        elif isinstance(date_or_month, str): dt = pd.to_datetime(date_or_month).date()
        else: dt = date(int(date_or_month[0]), int(date_or_month[1]), 1)
        year, month = dt.year, dt.month
    except: return
    emp_df = query_df("SELECT role FROM employees WHERE id = ?", (int(employee_id),))
    if emp_df.empty or not str(emp_df["role"].iloc[0]).strip().upper().startswith("APAO"): return
    first, last = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    allocs = query_df("SELECT id, alloc_date, alloc_type, notes FROM allocations WHERE employee_id = ? AND alloc_date BETWEEN ? AND ?", (int(employee_id), str(first - timedelta(days=2)), str(last + timedelta(days=2))))
    if allocs.empty: return
    alloc_map = {pd.to_datetime(r["alloc_date"]).date(): {"id": int(r["id"]), "tipo": str(r["alloc_type"]).upper(), "notes": str(r["notes"] or "")} for _, r in allocs.iterrows()}
    rest_types, curr, to_update = {"FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA"}, first - timedelta(days=2), set()
    while curr <= last + timedelta(days=2):
        if curr.weekday() == 5:
            sab, dom = curr, curr + timedelta(days=1)
            if sab in alloc_map and dom in alloc_map and alloc_map[sab]["tipo"] in rest_types and alloc_map[dom]["tipo"] in rest_types:
                to_update.add(sab); to_update.add(dom)
        if curr.weekday() == 6:
            dom, seg = curr, curr + timedelta(days=1)
            if dom in alloc_map and seg in alloc_map and alloc_map[dom]["tipo"] in rest_types and alloc_map[seg]["tipo"] in rest_types:
                to_update.add(dom); to_update.add(seg)
        curr += timedelta(days=1)
    for d in to_update:
        info = alloc_map[d]
        if info["tipo"] != "FOLGA AGRUPADA":
            orig_type, clean_notes = extract_original_type(info["notes"])
            if not orig_type:
                orig_type = info["tipo"]
            clean_notes = clean_notes.replace(" (Cura APAO)", "").strip()
            new_notes = f"{clean_notes} (Original: {orig_type})".strip()
            execute("UPDATE allocations SET alloc_type = 'FOLGA AGRUPADA', notes = ? WHERE id = ?", (new_notes, info["id"]))
            
    for d, info in alloc_map.items():
        if info["tipo"] == "FOLGA AGRUPADA" and d not in to_update:
            orig_type, clean_notes = extract_original_type(info["notes"])
            if not orig_type:
                orig_type = "FOLGA"
            clean_notes = clean_notes.replace(" (Cura APAO)", "").strip()
            execute("UPDATE allocations SET alloc_type = ?, notes = ? WHERE id = ?", (orig_type, clean_notes, info["id"]))

def extract_original_type(notes):
    if not isinstance(notes, str):
        return None, ""
    m = re.search(r'\(Original:\s*([^\)]+)\)', notes)
    if m:
        orig = m.group(1).strip().upper()
        clean_notes = re.sub(r'\(Original:\s*[^\)]+\)', '', notes).strip()
        clean_notes = re.sub(r'\s+', ' ', clean_notes).strip()
        return orig, clean_notes
    return None, notes

def heal_pao_social_rules(employee_id, date_or_month):
    try:
        if isinstance(date_or_month, (datetime, date)): dt = date_or_month
        elif isinstance(date_or_month, str): dt = pd.to_datetime(date_or_month).date()
        else: dt = date(int(date_or_month[0]), int(date_or_month[1]), 1)
        year, month = dt.year, dt.month
    except: return
    emp_df = query_df("SELECT role FROM employees WHERE id = ?", (int(employee_id),))
    if emp_df.empty: return
    cargo = str(emp_df["role"].iloc[0]).strip().upper()
    if not (cargo.startswith("PAO") or cargo == "PAO FCF"): return
    first, last = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    allocs = query_df("SELECT id, alloc_date, alloc_type, notes FROM allocations WHERE employee_id = ? AND alloc_date BETWEEN ? AND ?", (int(employee_id), str(first - timedelta(days=7)), str(last + timedelta(days=7))))
    alloc_map = {pd.to_datetime(r["alloc_date"]).date(): {"id": int(r["id"]), "tipo": str(r["alloc_type"]).upper(), "notes": str(r["notes"] or "")} for _, r in allocs.iterrows()} if not allocs.empty else {}
    rest_types, curr, updates = {"FOLGA", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO"}, first - timedelta(days=7), []
    promoted_weekend = None
    while curr <= last + timedelta(days=7):
        if curr.weekday() == 5:
            sab, dom = curr, curr + timedelta(days=1)
            sab_a, dom_a = alloc_map.get(sab), alloc_map.get(dom)
            if sab_a and dom_a and sab_a["tipo"] in rest_types and dom_a["tipo"] in rest_types:
                if promoted_weekend is None:
                    promoted_weekend = (sab, dom)
                    for a in [sab_a, dom_a]:
                        if a["tipo"] != "FOLGA SOCIAL":
                            orig_type, clean_notes = extract_original_type(a["notes"])
                            if not orig_type:
                                orig_type = a["tipo"]
                            new_notes = f"{clean_notes} (Original: {orig_type})".strip()
                            updates.append({"id": a["id"], "tipo": "FOLGA SOCIAL", "notes": new_notes})
                else:
                    for a in [sab_a, dom_a]:
                        if a["tipo"] == "FOLGA SOCIAL":
                            orig_type, clean_notes = extract_original_type(a["notes"])
                            if not orig_type:
                                orig_type = "FOLGA"
                            updates.append({"id": a["id"], "tipo": orig_type, "notes": clean_notes})
            else:
                for a in [sab_a, dom_a]:
                    if a and a["tipo"] == "FOLGA SOCIAL":
                        orig_type, clean_notes = extract_original_type(a["notes"])
                        if not orig_type:
                            orig_type = "FOLGA"
                        updates.append({"id": a["id"], "tipo": orig_type, "notes": clean_notes})
        curr += timedelta(days=1)
    for up in updates: execute("UPDATE allocations SET alloc_type = ?, notes = ? WHERE id = ?", (up["tipo"], up["notes"], up["id"]))