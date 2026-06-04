import pytest
from datetime import date, timedelta
import pandas as pd
from database.repositories import (
    employees_df,
    shifts_df,
    add_assignment,
    add_allocation,
    delete_month_schedule,
    schedule_df,
)
from core.rules import (
    has_12h_rest,
    validate_rules,
    month_range,
    build_shift_time_map,
)
from core.scheduler import generate_auto_schedule, can_work


def test_database_initialization():
    """Garante que a inicialização isolada e mock do banco está ativa e consistente."""
    emp = employees_df()
    assert not emp.empty
    assert len(emp[emp["cargo"] == "PAO"]) == 3
    assert len(emp[emp["cargo"] == "APAO"]) == 2

    shifts = shifts_df()
    assert not shifts.empty
    assert "T8" in shifts["codigo"].tolist()
    assert "T1" in shifts["codigo"].tolist()


def test_12h_rest_rule():
    """Garante que o intervalo de 12 horas de descanso é validado corretamente entre turnos."""
    shift_map = build_shift_time_map()
    
    # PAO Silva trabalha no T7 (14:00 - 22:00) no dia 10
    planned_silva_T7 = {
        (1, date(2026, 5, 10)): "T7"
    }

    # Silva tenta trabalhar no T6 (06:00 - 14:00) no dia 11.
    # Fim do T7: 22h dia 10. Início do T6: 06h dia 11. Intervalo = 8 horas (MENOR que 12h) -> Deve falhar.
    ok_T6, reason_T6 = has_12h_rest(1, date(2026, 5, 11), "T6", planned_silva_T7, shift_map)
    assert not ok_T6

    # Silva tenta trabalhar no T7 (14:00 - 22:00) no dia 11.
    # Intervalo = 16 horas (MAIOR que 12h) -> Deve passar.
    ok_T7, reason_T7 = has_12h_rest(1, date(2026, 5, 11), "T7", planned_silva_T7, shift_map)
    assert ok_T7


def test_can_work_with_pre_allocation_blocking():
    """Garante que bloqueios cadastrados (FÉRIAS, DISPENSA MÉDICA etc.) barram novas alocações de turno."""
    emp_df = employees_df()
    pao_silva = emp_df[emp_df["nome"] == "PAO SILVA"].iloc[0].to_dict()
    
    work_date = date(2026, 5, 15)
    shift_code = "T6"
    
    # 1. Caso sem bloqueios: deve ser viável
    blocked = {}
    planned = {}
    shift_map = build_shift_time_map()
    
    ok, reason = can_work(pao_silva, work_date, shift_code, blocked, planned, shift_map, shift_restrictions={})
    assert ok

    # 2. Caso com férias alocadas no dia: deve ser bloqueado
    blocked = {
        (pao_silva["id"], work_date): "FÉRIAS"
    }
    
    ok_ferias, reason_ferias = can_work(pao_silva, work_date, shift_code, blocked, planned, shift_map, shift_restrictions={})
    assert not ok_ferias
    assert "bloqueado por FÉRIAS" in reason_ferias or "FÉRIAS" in reason_ferias or "bloqueado" in reason_ferias


def test_consecutive_days_auto_generation():
    """Garante que o motor do gerador automático cria escalas viáveis sem conflitos de regras."""
    year = 2026
    month = 6
    
    # Limpa dados anteriores
    delete_month_schedule(year, month)
    
    # Executa a geração automática
    log_df = generate_auto_schedule(year, month, ["PAO", "APAO"])
    
    # Verifica se gerou turnos gravados no banco
    sched = schedule_df(date(year, month, 1), date(year, month, 30))
    assert not sched.empty
    
    # Executa a validação de regras operacional total
    issues = validate_rules(year, month)
    
    # O gerador heurístico deve respeitar as regras básicas
    # Filtra falhas graves (gravidade ALTA ou CRÍTICA se houver)
    critical_issues = issues[issues["gravidade"].isin(["ALTA", "CRÍTICA"])]
    assert len(critical_issues) == 0, f"Erros graves encontrados após geração automática: {critical_issues.to_dict(orient='records')}"


def test_t9_concurrency():
    """Garante que o Turno 9 (T9) pode rodar junto com outros 2 turnos sem estourar o limite de estações."""
    from database.repositories import add_shift, add_assignment
    from core.rules import max_simultaneous_workers_if_added, validate_rules, build_shift_time_map
    
    # 1. Adicionamos o turno T9 no banco de dados
    add_shift("T9", "PAO", "Turno 9 especial", "08:00", "16:00", 1, 1)

    # 2. Montamos um mapa de turnos incluindo T9
    shift_map = build_shift_time_map()
    assert "T9" in shift_map

    # 3. Alocamos 2 funcionários normais em turnos que se sobrepõem (Silva no T6 (06:00-14:00) e APAO Lima no T2 (06:00-12:00))
    planned = {
        (1, date(2026, 5, 10)): "T6",   # Silva no T6
        (4, date(2026, 5, 10)): "T2",   # APAO Lima no T2
    }

    # Sem T9, se tentarmos adicionar uma terceira pessoa no T6, deve exceder 2 estações.
    ans_no_t9 = max_simultaneous_workers_if_added(3, date(2026, 5, 10), "T6", planned, shift_map)
    assert ans_no_t9 > 2

    # Com T9, se tentarmos alocar Oliveira no T9, deve ser permitido (ignorado no limite de simultâneos)
    ans_t9 = max_simultaneous_workers_if_added(3, date(2026, 5, 10), "T9", planned, shift_map)
    assert ans_t9 <= 2

    # 4. Também testamos a validação de regras com T9 na escala
    add_assignment("2026-05-10", "T6", 1, "Silva T6")
    add_assignment("2026-05-10", "T2", 4, "Lima T2")
    add_assignment("2026-05-10", "T9", 3, "Oliveira T9")

    # Isso deve validar sem dar erro de "MAIS DE 2 SIMULTÂNEOS"
    issues = validate_rules(2026, 5)
    high_issues = issues[issues["gravidade"].isin(["ALTA", "CRÍTICA"])]
    dup_stations = high_issues[high_issues["tipo"] == "MAIS DE 2 SIMULTÂNEOS"]
    assert len(dup_stations) == 0


def test_pao_fcf_rules_and_generation():
    """Garante que as regras e a escala automática de PAO FCF funcionam perfeitamente."""
    from database.repositories import add_employee, add_assignment, add_allocation, delete_month_schedule, schedule_df, allocations_df, add_shift
    from core.rules import max_simultaneous_workers_if_added, interval_covered_by_pao, validate_rules, build_shift_time_map
    from core.scheduler import generate_auto_schedule, can_work
    from datetime import datetime
    
    # 1. Registrar um turno especial T9 e um funcionário PAO FCF no banco de dados temporário
    add_shift("T9", "PAO", "Turno 9 especial", "08:00", "16:00", 1, 1)
    add_employee("CORINGA FCF", "PAO FCF", seniority=1, fixed_shift_code="T9", is_fixed_shift=1, notes="Mock PAO FCF")
    
    # 2. Verificar que PAO FCF não conta para o limite de 2 estações físicas
    shift_map = build_shift_time_map()
    planned = {
        (1, date(2026, 5, 10)): "T6",   # Silva no T6
        (2, date(2026, 5, 10)): "T7",   # Santos no T7
    }
    
    planned_over = {
        (1, date(2026, 5, 10)): "T6",   # Silva no T6
        (2, date(2026, 5, 10)): "T6",   # Santos no T6 (2 pessoas no T6)
    }
    
    # Se tentarmos colocar uma terceira pessoa normal, deve dar excesso:
    ans_no_fcf = max_simultaneous_workers_if_added(3, date(2026, 5, 10), "T6", planned_over, shift_map)
    assert ans_no_fcf > 2
    
    # Vamos descobrir o ID do Coringa FCF dinamicamente:
    from database.repositories import employees_df
    emp_df = employees_df()
    fcf_emp = emp_df[emp_df["nome"] == "CORINGA FCF"].iloc[0].to_dict()
    fcf_id = fcf_emp["id"]
    
    ans_fcf = max_simultaneous_workers_if_added(fcf_id, date(2026, 5, 10), "T6", planned_over, shift_map)
    assert ans_fcf <= 2  # Deve ser ignorado e manter o contador em 2!
    
    # 3. Verificar que PAO FCF não atua como chaperone para APAO
    planned_fcf_only = {
        (fcf_id, date(2026, 5, 10)): "T6"
    }
    cand_start = datetime(2026, 5, 10, 6, 0)
    cand_end = datetime(2026, 5, 10, 12, 0)
    covered = interval_covered_by_pao(cand_start, cand_end, planned_fcf_only, shift_map)
    assert not covered  # PAO FCF não pode cobrir APAO!
    
    # 4. Verificar que can_work permite agendar turno mesmo em dias com simulador/curso/voo
    blocked = {
        (fcf_id, date(2026, 5, 10)): "VOO"
    }
    ok_voo, reason_voo = can_work(fcf_emp, date(2026, 5, 10), "T9", blocked, {}, shift_map=shift_map)
    assert ok_voo  # VOO não deve bloquear PAO FCF!
    
    # 5. Executar geração automática e validar meta de 10 folgas e 20 dias trabalhados
    year = 2026
    month = 6
    
    # Adicionar 2 dias de simulador em pre-alocações para o Coringa para testar o double-counting
    add_allocation(fcf_id, date(year, month, 5), "SIMULADOR", "Treinamento simulador")
    add_allocation(fcf_id, date(year, month, 15), "VOO", "Treinamento voo")
    
    # Limpa dados anteriores
    delete_month_schedule(year, month)
    
    # Executa a geração automática incluindo PAO FCF
    log_df = generate_auto_schedule(year, month, ["PAO", "APAO", "PAO FCF"])
    from core.scheduler import auto_allocate_rests
    from services.schedule_service import ScheduleService
    auto_allocate_rests(year, month, ["PAO", "APAO", "PAO FCF"])
    ScheduleService.fill_blank_cells_with_flights(year, month)

    # Verifica folgas e turnos trabalhados para o Coringa FCF
    from database.repositories import allocations_df, schedule_df
    allocs = allocations_df(date(year, month, 1), date(year, month, 30))
    sched = schedule_df(date(year, month, 1), date(year, month, 30))
    
    # Folgas geradas para o Coringa (deve ter exatamente 10 folgas)
    fcf_folgas = allocs[(allocs["funcionario_id"] == fcf_id) & (allocs["tipo"].isin(["FOLGA", "FOLGA SOCIAL", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA AGRUPADA"]))]
    assert len(fcf_folgas) == 10
    
    # Turnos agendados na escala
    fcf_sched = sched[sched["funcionario_id"] == fcf_id]
    fcf_extra = allocs[(allocs["funcionario_id"] == fcf_id) & (allocs["tipo"].isin(["SIMULADOR", "VOO"]))]
    shift_dates = set(pd.to_datetime(fcf_sched["data"]).dt.date.tolist())
    extra_dates = set(pd.to_datetime(fcf_extra["data"]).dt.date.tolist())
    productive_days = len(shift_dates | extra_dates)

    assert productive_days >= 20, f"Coringa FCF deveria ter >=20 dias produtivos, tem {productive_days}"
    
    # 6. Validar regras no mês e confirmar que não há problemas reportados para o Coringa FCF
    issues = validate_rules(year, month)
    fcf_issues = issues[issues["funcionario"] == "CORINGA FCF"]
    # Devem ser zero falhas
    assert len(fcf_issues) == 0, f"Erros encontrados para o Coringa: {fcf_issues.to_dict(orient='records')}"


def test_auto_repair_rules():
    """Garante que a lógica de auto-reparo/cura automática funciona corretamente após edições manuais."""
    from database.repositories import delete_month_schedule
    from services.schedule_service import ScheduleService
    apply_visual_day_change_with_repair = ScheduleService.apply_visual_day_change_with_repair
    from database.repositories import schedule_df, allocations_df, add_assignment
    
    emp_id = 1
    year = 2026
    month = 6
    
    # Limpa o mês
    delete_month_schedule(year, month)
    
    # 1. Teste de Descanso de 12h:
    # Silva trabalha T7 (14:00 - 22:00) no dia 10
    add_assignment(date(year, month, 10), "T7", emp_id, "T7 manual")
    
    # Tentamos colocar T6 (06:00 - 14:00) no dia 11 (violaria 12h rest)
    # apply_visual_day_change_with_repair deve colocar T6 no dia 11, mas REPARAR o dia 10 convertendo-o em FOLGA
    logs = apply_visual_day_change_with_repair(emp_id, date(year, month, 11), "TURNO", "T6")
    assert not logs.empty
    
    # Verifica que o dia 10 virou folga
    allocs = allocations_df(date(year, month, 10), date(year, month, 10))
    sched = schedule_df(date(year, month, 10), date(year, month, 10))
    assert not allocs.empty
    assert allocs.iloc[0]["tipo"] == "FOLGA"
    assert sched.empty
    
    # 2. Teste de Pareamento T8 / ND após 2 T8s:
    delete_month_schedule(year, month)
    
    # Lançamos T8 no dia 15 manualmente
    # Como está isolado, o reparador deve alocar T8 no dia 14 ou 16 (ou converter em folga se não puder parear).
    logs_t8 = apply_visual_day_change_with_repair(emp_id, date(year, month, 15), "TURNO", "T8")
    assert not logs_t8.empty
    
    # Verifica que temos 2 T8s na escala no mês
    sched_month = schedule_df(date(year, month, 1), date(year, month, 30))
    t8_dates = sorted(sched_month[sched_month["turno"] == "T8"]["data"].apply(lambda x: pd.to_datetime(x).date()).tolist())
    assert len(t8_dates) == 2
    
    d1, d2 = t8_dates
    assert d2 == d1 + timedelta(days=1)
    
    # E verifica que o dia posterior aos dois T8s consecutivos foi definido como ND
    nd_day = d2 + timedelta(days=1)
    allocs_nd = allocations_df(nd_day, nd_day)
    assert not allocs_nd.empty
    assert allocs_nd.iloc[0]["tipo"] == "ND"
    
    # 3. Teste de Sequência Consecutiva (>6 dias):
    delete_month_schedule(year, month)
    
    # Lançamos 6 dias de trabalho consecutivos (dias 1 a 6)
    for d in range(1, 7):
        add_assignment(date(year, month, d), "T6", emp_id, "Dia consecutivo")
        
    # Agora tentamos alocar o 7º dia consecutivo (dia 7)
    # O reparador deve colocar T6 no dia 7, mas converter um dia intermediário (ex: dia 6 ou 5) em FOLGA
    logs_streak = apply_visual_day_change_with_repair(emp_id, date(year, month, 7), "TURNO", "T6")
    assert not logs_streak.empty
    
    # Verifica que o dia 7 está alocado no T6
    sched_7 = schedule_df(date(year, month, 7), date(year, month, 7))
    assert not sched_7.empty
    assert sched_7.iloc[0]["turno"] == "T6"
    
    # E verifica que pelo menos um dos dias de 1 a 6 virou FOLGA
    allocs_streak = allocations_df(date(year, month, 1), date(year, month, 6))
    folgas_found = allocs_streak[allocs_streak["tipo"].isin(["FOLGA", "FOLGA SOCIAL"])]
    assert not folgas_found.empty


def test_phase_ii_premium_rules():
    """Garante o correto funcionamento das melhorias de escala da Fase II Premium."""
    from database.repositories import add_employee, add_allocation, allocations_df, schedule_df, add_assignment, heal_apao_agroupada_rules
    from core.rules import employee_monthly_summary, validate_rules
    from core.scheduler import generate_auto_schedule
    
    # 1. Teste de Folga Aniversário (FA)
    from database.repositories import employees_df
    emp_df = employees_df()
    silva = emp_df[emp_df["nome"] == "PAO SILVA"].iloc[0].to_dict()
    silva_id = silva["id"]
    
    # Limpa alocações do Silva no mês de Junho/2026
    from database.connection import execute
    execute("DELETE FROM allocations WHERE employee_id = ? AND alloc_date LIKE '2026-06-%'", (silva_id,))
    
    # Adiciona 1 Folga Aniversário e 9 Folgas Normais no fim de semana
    add_allocation(silva_id, "2026-06-01", "FOLGA ANIVERSÁRIO", "Aniversário")
    for d in range(2, 11):
        dt_str = f"2026-06-{d:02d}"
        dt = pd.to_datetime(dt_str).date()
        add_allocation(silva_id, dt, "FOLGA", "Folga comum")
        
    # Verifica no banco de dados se as folgas do Silva no FDS (dias 6 e 7 de junho) viraram FOLGA SOCIAL
    allocs_fds = allocations_df("2026-06-06", "2026-06-07")
    silva_fds = allocs_fds[allocs_fds["funcionario_id"] == silva_id]
    assert all(silva_fds["tipo"] == "FOLGA SOCIAL"), "Folgas de FDS do PAO deveriam ter sido convertidas para FOLGA SOCIAL"
    
    # Verifica o resumo mensal do Silva
    summary = employee_monthly_summary(2026, 6)
    silva_sum = summary[summary["funcionario"] == "PAO SILVA"].iloc[0]
    assert silva_sum["total_folgas"] == 10, f"Deveria ter 10 folgas no total, mas obteve: {silva_sum['total_folgas']}"
    assert silva_sum.get("folga_aniversario", 0) == 1, "Deveria ter 1 folga aniversário listada"
    
    # 2. Teste de Cura de Folga Agrupada para APAO (Regra 4)
    lima = emp_df[emp_df["nome"] == "APAO LIMA"].iloc[0].to_dict()
    lima_id = lima["id"]
    
    execute("DELETE FROM allocations WHERE employee_id = ? AND alloc_date LIKE '2026-06-%'", (lima_id,))
    
    # Lançamos uma Folga Pedida no Sábado (2026-06-13) e uma Folga comum no Domingo (2026-06-14)
    add_allocation(lima_id, "2026-06-13", "FOLGA PEDIDA", "Pedido Sab")
    add_allocation(lima_id, "2026-06-14", "FOLGA", "Folga Dom")
    
    lima_allocs = allocations_df("2026-06-13", "2026-06-14")
    lima_fds = lima_allocs[lima_allocs["funcionario_id"] == lima_id]
    assert len(lima_fds) == 2
    assert all(lima_fds["tipo"] == "FOLGA AGRUPADA"), "Ambas deveriam ter sido curadas para FOLGA AGRUPADA"
    
    # 3. Teste de Fallback APAO -> PAO (Estritamente bloqueado por novas regras)
    execute("DELETE FROM allocations WHERE alloc_date LIKE '2026-06-%'")
    execute("DELETE FROM assignments WHERE work_date LIKE '2026-06-%'")
    
    apao_df = emp_df[emp_df["cargo"] == "APAO"]
    for _, apao in apao_df.iterrows():
        add_allocation(int(apao["id"]), "2026-06-20", "DISPENSA MÉDICA", "Bloqueio total")
        
    # Executa a geração automática apenas para APAO
    log_df = generate_auto_schedule(2026, 6, ["APAO"])
    
    # Verifica que nenhum PAO regular foi alocado no turno de APAO no dia 2026-06-20, pois isso é proibido
    sched_20 = schedule_df("2026-06-20", "2026-06-20")
    apao_shifts_on_20 = sched_20[sched_20["turno"].isin(["T1", "T2", "T3", "T4"])]
    assert apao_shifts_on_20.empty, "Nenhum PAO regular deve assumir turnos de APAO (T1, T2, T3, T4) mesmo sob fallback"


def test_strict_pao_social_pairing():
    """Garante que a folga de fim de semana de PAO só vira FOLGA SOCIAL se o par estiver completo.
    Caso um dos dias seja deletado ou alterado, a folga restante é decolada para FOLGA simples.
    """
    from database.repositories import employees_df, add_allocation, allocations_df, delete_day_allocation_for_employee
    
    emp_df = employees_df()
    silva = emp_df[emp_df["nome"] == "PAO SILVA"].iloc[0].to_dict()
    silva_id = int(silva["id"])
    
    # Limpa alocações do Silva nos dias de teste
    delete_day_allocation_for_employee(silva_id, "2026-06-06")
    delete_day_allocation_for_employee(silva_id, "2026-06-07")
    
    # 1. Aloca apenas Sábado (06/06/2026) como FOLGA
    add_allocation(silva_id, "2026-06-06", "FOLGA", "Test Sab")
    
    # Deve continuar como FOLGA simples, pois Domingo não é folga
    allocs = allocations_df("2026-06-06", "2026-06-06")
    silva_sab = allocs[allocs["funcionario_id"] == silva_id]
    assert not silva_sab.empty
    assert silva_sab.iloc[0]["tipo"] == "FOLGA"
    
    # 2. Aloca Domingo (07/06/2026) como FOLGA
    add_allocation(silva_id, "2026-06-07", "FOLGA", "Test Dom")
    
    # Ambos devem ser curados/promovidos para FOLGA SOCIAL
    allocs_fds = allocations_df("2026-06-06", "2026-06-07")
    silva_fds = allocs_fds[allocs_fds["funcionario_id"] == silva_id]
    assert len(silva_fds) == 2
    assert all(silva_fds["tipo"] == "FOLGA SOCIAL")
    
    # 3. Remove o Sábado
    delete_day_allocation_for_employee(silva_id, "2026-06-06")
    
    # Domingo deve ser decolado/demovido de volta para FOLGA simples
    allocs_dom = allocations_df("2026-06-07", "2026-06-07")
    silva_dom = allocs_dom[allocs_dom["funcionario_id"] == silva_id]
    assert not silva_dom.empty
    assert silva_dom.iloc[0]["tipo"] == "FOLGA"


def test_cross_month_t8_nd_timeline():
    """Garante que a timeline contínua de T8/ND funciona perfeitamente além das barreiras mensais.
    Um T8 alocado no dia 31/05 deve ser pareado com o dia 01/06 e gerar um ND em 02/06.
    Além disso, a validação de regras de Maio e de Junho não deve apontar erros de T8 isolado.
    """
    from database.repositories import delete_month_schedule, employees_df, schedule_df, allocations_df
    from services.schedule_service import ScheduleService
    from core.rules import validate_rules
    
    emp_df = employees_df()
    silva = emp_df[emp_df["nome"] == "PAO SILVA"].iloc[0].to_dict()
    silva_id = int(silva["id"])
    
    # Limpa os meses de Maio e Junho de 2026
    delete_month_schedule(2026, 5)
    delete_month_schedule(2026, 6)
    
    # Aloca T8 no dia 31/05/2026
    # O reparador contínuo (Timeline Sem Fim) deve tentar parear no dia anterior ou seguinte.
    # Como o dia anterior está livre de bloqueios, ele deve parear com 01/06/2026 (ou 30/05/2026).
    # Vamos usar apply_visual_day_change_with_repair no dia 31/05/2026
    logs = ScheduleService.apply_visual_day_change_with_repair(silva_id, date(2026, 5, 31), "TURNO", "T8")
    assert not logs.empty
    
    # Vamos verificar que o dia 31/05 e o dia 01/06 (ou 30/05) são T8
    sched_maio = schedule_df("2026-05-30", "2026-06-02")
    silva_sched = sched_maio[sched_maio["funcionario_id"] == silva_id]
    
    t8_dates = sorted(silva_sched[silva_sched["turno"] == "T8"]["data"].apply(lambda x: pd.to_datetime(x).date()).tolist())
    assert len(t8_dates) == 2
    assert t8_dates[1] - t8_dates[0] == timedelta(days=1)
    
    # Verifica o ND no dia seguinte ao par de T8s
    nd_expected_day = t8_dates[1] + timedelta(days=1)
    allocs = allocations_df(nd_expected_day, nd_expected_day)
    silva_nd = allocs[allocs["funcionario_id"] == silva_id]
    assert not silva_nd.empty
    assert silva_nd.iloc[0]["tipo"] == "ND"
    
    # Agora executa a validação de regras em Maio (5) e Junho (6)
    # A validação não deve apontar erros de T8 isolado ou sem ND, pois o par está perfeito cross-month.
    issues_maio = validate_rules(2026, 5)
    issues_junho = validate_rules(2026, 6)
    
    t8_issues_maio = issues_maio[(issues_maio["funcionario"] == "PAO SILVA") & (issues_maio["tipo"].str.contains("T8"))]
    t8_issues_junho = issues_junho[(issues_junho["funcionario"] == "PAO SILVA") & (issues_junho["tipo"].str.contains("T8"))]
    
    assert len(t8_issues_maio) == 0, f"Erros de T8 em Maio: {t8_issues_maio.to_dict(orient='records')}"
    assert len(t8_issues_junho) == 0, f"Erros de T8 em Junho: {t8_issues_junho.to_dict(orient='records')}"


def test_workload_equalization():
    """Valida que a defasagem entre pilotos do mesmo cargo (PAO) é no máximo +- 1 turno após a escala automática."""
    from database.repositories import delete_month_schedule, employees_df, schedule_df
    from core.scheduler import generate_auto_schedule
    
    year = 2026
    month = 6
    delete_month_schedule(year, month)
    
    # Executa a geração automática
    generate_auto_schedule(year, month, ["PAO"])
    
    # Contar quantidade de turnos gerados para cada funcionário PAO
    sched = schedule_df(date(year, month, 1), date(year, month, 30))
    pao_ids = employees_df("PAO")["id"].astype(int).tolist()
    
    workloads = []
    for emp_id in pao_ids:
        cnt = len(sched[sched["funcionario_id"] == emp_id])
        workloads.append(cnt)
        
    if workloads:
        diff = max(workloads) - min(workloads)
        assert diff <= 1, f"Defasagem de turnos entre PAOs ({workloads}) é maior do que 1 turno!"


def test_smart_rest_allocation_no_monofolga():
    """Valida que o motor de alocação inteligente de folgas atinge entre 10 e 11 folgas sem monofolgas para PAO."""
    from database.repositories import delete_month_schedule, employees_df, allocations_df, add_allocation
    from core.scheduler import auto_allocate_rests
    
    year = 2026
    month = 6
    delete_month_schedule(year, month)
    
    # Adicionamos uma folga pedida em um dia de semana aleatório para Silva para forçar needed ser ímpar
    emp_df = employees_df("PAO")
    silva_id = int(emp_df.iloc[0]["id"])
    add_allocation(silva_id, date(year, month, 10), "FOLGA PEDIDA", "Folga pedida manual")
    
    # Executa a alocação inteligente de folgas
    auto_allocate_rests(year, month, ["PAO"])
    
    # Carrega alocações geradas
    allocs = allocations_df(date(year, month, 1), date(year, month, 30))
    silva_allocs = allocs[allocs["funcionario_id"] == silva_id]
    
    rest_types = ["FOLGA", "FOLGA SOCIAL", "FOLGA PEDIDA", "FOLGA ESCOLHIDA", "FOLGA AGRUPADA"]
    silva_rests = silva_allocs[silva_allocs["tipo"].isin(rest_types)]
    
    # A quantidade de folgas deve ser entre 10 e 12 (par 11º dia ou folga 6x1)
    assert 10 <= len(silva_rests) <= 12, f"Deveria ter 10 a 12 folgas, tem: {len(silva_rests)}"
    assert len(silva_allocs[silva_allocs["tipo"] == "FOLGA SOCIAL"]) >= 1, "Deveria ter ao menos 1 folga social"

    # PAO: no máximo 1 monofolga (folga isolada)
    rest_dates = sorted(silva_rests["data"].apply(lambda x: pd.to_datetime(x).date()).tolist())
    isolated = [
        d for d in rest_dates
        if (d - timedelta(days=1)) not in rest_dates and (d + timedelta(days=1)) not in rest_dates
    ]
    assert len(isolated) <= 1, f"PAO não pode ter mais de 1 monofolga; encontradas: {isolated}"


def test_auto_allocate_preserves_t8_t8_nd_rule():
    """Após alocar folgas/voos, dois T8 seguidos devem gerar ND no terceiro dia."""
    from database.repositories import delete_month_schedule, employees_df, allocations_df, add_assignment
    from core.scheduler import auto_allocate_rests

    year, month = 2026, 6
    delete_month_schedule(year, month)
    emp_id = int(employees_df("PAO").iloc[0]["id"])

    add_assignment(date(year, month, 10), "T8", emp_id, "Teste T8 1")
    add_assignment(date(year, month, 11), "T8", emp_id, "Teste T8 2")

    auto_allocate_rests(year, month, ["PAO"])

    nd_day = date(year, month, 12)
    allocs = allocations_df(nd_day, nd_day)
    emp_nd = allocs[allocs["funcionario_id"] == emp_id]
    assert not emp_nd.empty, "Terceiro dia após T8,T8 deve ser ND"
    assert emp_nd.iloc[0]["tipo"] == "ND"


def test_shift_streak_and_productivity_targets():
    """Garante carga e blocos de turnos após fluxo completo (gerar + folgas)."""
    from database.repositories import delete_month_schedule, employees_df, schedule_df
    from core.scheduler import auto_allocate_rests, generate_auto_schedule

    year, month = 2026, 6
    delete_month_schedule(year, month)
    generate_auto_schedule(year, month, ["PAO", "APAO"])
    auto_allocate_rests(year, month, ["PAO"])

    emp_id = int(employees_df("PAO").iloc[0]["id"])
    sched = schedule_df(date(year, month, 1), date(year, month, 30))
    shift_dates = sorted(
        sched[sched["funcionario_id"] == emp_id]["data"].apply(lambda x: pd.to_datetime(x).date()).tolist()
    )

    assert len(shift_dates) >= 15, f"Esperado carga substancial de turnos, obteve {len(shift_dates)}"

    max_streak = 0
    streak = 0
    prev = None
    for d in shift_dates:
        if prev and d == prev + timedelta(days=1):
            streak += 1
        else:
            streak = 1
        max_streak = max(max_streak, streak)
        prev = d
    assert max_streak >= 4, f"Maior sequência de turnos {max_streak} < 4"


def test_unified_rest_and_flight_allocation():
    """Fluxo completo não deve gerar violações graves (T8/ND, folga+turno no mesmo dia)."""
    from database.repositories import delete_month_schedule
    from core.scheduler import auto_allocate_rests, generate_auto_schedule
    from core.rules import validate_rules

    year, month = 2026, 6
    delete_month_schedule(year, month)
    generate_auto_schedule(year, month, ["PAO", "APAO"])
    auto_allocate_rests(year, month, ["PAO"])

    issues = validate_rules(year, month)
    if issues.empty:
        return
    critical = issues[
        issues["tipo"].isin(["T8 SEM ND", "T8 ISOLADO", "TRABALHO EM DIA BLOQUEADO"])
    ]
    assert critical.empty, f"Violações críticas: {critical.to_dict(orient='records')}"


def test_schedule_clearing_retains_preferential_and_deletes_standard():
    """Garante que a limpeza da escala preserva alocações preferenciais manuais
    e exclui completamente folgas simples, voos e ND, tanto automáticos quanto manuais.
    Também garante que folgas promovidas que viraram folgas sociais/agrupadas sejam demovidas
    para o tipo original.
    """
    from database.repositories import employees_df, add_allocation, allocations_df, delete_month_schedule
    
    year = 2026
    month = 6
    delete_month_schedule(year, month)
    
    emp_df = employees_df()
    silva = emp_df[emp_df["nome"] == "PAO SILVA"].iloc[0].to_dict()
    silva_id = int(silva["id"])
    
    lima = emp_df[emp_df["cargo"] == "APAO"].iloc[0].to_dict()
    lima_id = int(lima["id"])
    
    # 1. Adicionar alocações manuais preferenciais e padrão
    add_allocation(silva_id, date(year, month, 1), "FOLGA PEDIDA", "Folga pedida pelo Silva")
    add_allocation(silva_id, date(year, month, 2), "FÉRIAS", "Férias programadas")
    add_allocation(silva_id, date(year, month, 3), "FOLGA", "Folga manual simples")
    add_allocation(silva_id, date(year, month, 4), "VOO", "Voo manual")
    add_allocation(silva_id, date(year, month, 5), "ND", "ND manual")
    
    # 2. Adicionar alocações para APAO que sofrerão cura/promoção
    add_allocation(lima_id, date(year, month, 6), "FOLGA PEDIDA", "Folga de sábado")
    add_allocation(lima_id, date(year, month, 7), "FOLGA", "Folga de domingo") # Será promovido a FOLGA AGRUPADA junto com sábado
    
    # 3. Adicionar alocações para PAO que sofrerão cura/promoção
    add_allocation(silva_id, date(year, month, 13), "FOLGA PEDIDA", "Folga Sab")
    add_allocation(silva_id, date(year, month, 14), "FOLGA", "Folga Dom") # Ambas viram FOLGA SOCIAL
    
    # Executa a limpeza da escala
    delete_month_schedule(year, month)
    
    # Verifica o que foi preservado e o que foi excluído
    all_allocs = allocations_df(date(year, month, 1), date(year, month, 30))
    
    silva_allocs = all_allocs[all_allocs["funcionario_id"] == silva_id]
    lima_allocs = all_allocs[all_allocs["funcionario_id"] == lima_id]
    
    # O dia 1 (FOLGA PEDIDA) e o dia 2 (FÉRIAS) do Silva devem ser mantidos
    assert not silva_allocs[silva_allocs["data"] == "2026-06-01"].empty
    assert silva_allocs[silva_allocs["data"] == "2026-06-01"].iloc[0]["tipo"] == "FOLGA PEDIDA"
    assert "Folga pedida pelo Silva" in silva_allocs[silva_allocs["data"] == "2026-06-01"].iloc[0]["observacao"]
    
    assert not silva_allocs[silva_allocs["data"] == "2026-06-02"].empty
    assert silva_allocs[silva_allocs["data"] == "2026-06-02"].iloc[0]["tipo"] == "FÉRIAS"
    
    # O dia 3 (FOLGA), dia 4 (VOO), e dia 5 (ND) do Silva devem ser DELETADOS
    assert silva_allocs[silva_allocs["data"] == "2026-06-03"].empty
    assert silva_allocs[silva_allocs["data"] == "2026-06-04"].empty
    assert silva_allocs[silva_allocs["data"] == "2026-06-05"].empty
    
    # APAO Lima:
    # Sábado (dia 6) era FOLGA PEDIDA (promovida a FOLGA AGRUPADA), deve ser RESTAURADA a FOLGA PEDIDA com notas limpas
    assert not lima_allocs[lima_allocs["data"] == "2026-06-06"].empty
    assert lima_allocs[lima_allocs["data"] == "2026-06-06"].iloc[0]["tipo"] == "FOLGA PEDIDA"
    assert "Folga de sábado" in lima_allocs[lima_allocs["data"] == "2026-06-06"].iloc[0]["observacao"]
    
    # Domingo (dia 7) era FOLGA comum (promovida a FOLGA AGRUPADA), deve ser DELETADA
    assert lima_allocs[lima_allocs["data"] == "2026-06-07"].empty
    
    # PAO Silva:
    # Sábado (dia 13) era FOLGA PEDIDA (promovida a FOLGA SOCIAL), deve ser RESTAURADA a FOLGA PEDIDA com notas limpas
    assert not silva_allocs[silva_allocs["data"] == "2026-06-13"].empty
    assert silva_allocs[silva_allocs["data"] == "2026-06-13"].iloc[0]["tipo"] == "FOLGA PEDIDA"
    assert "Folga Sab" in silva_allocs[silva_allocs["data"] == "2026-06-13"].iloc[0]["observacao"]
    
    # Domingo (dia 14) era FOLGA comum (promovida a FOLGA SOCIAL), deve ser DELETADA
    assert silva_allocs[silva_allocs["data"] == "2026-06-14"].empty





