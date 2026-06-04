import streamlit as st
from datetime import date
from database.connection import init_db
from ui.styles import inject_visual_polish_v51, inject_v52_ui_fixes
from ui.views.employees import render_employees_view
from ui.views.shifts import render_shifts_view
from ui.views.schedule import render_schedule_view

def main():
    # 1. Configurações essenciais da página
    st.set_page_config(
        page_title="Sistema de Escala PAO/APAO",
        page_icon="🛫",
        layout="wide",
        initial_sidebar_state="expanded"
    )

    # 2. Inicializa o banco de dados persistentemente
    init_db()

    query_params = st.query_params

    # Intercepta parâmetros de URL para persistir o menu e aba selecionados (apenas em novas sessões/recargas completas)
    if "active_menu_radio" not in st.session_state and "menu" in query_params:
        menu_val = query_params["menu"]
        if menu_val == "Escala":
            st.session_state["active_menu_radio"] = "🗓️ Escala"
            st.session_state["active_menu"] = "Escala"
        elif menu_val == "Funcionarios":
            st.session_state["active_menu_radio"] = "👥 Funcionários"
            st.session_state["active_menu"] = "Funcionários"
        elif menu_val == "Turnos":
            st.session_state["active_menu_radio"] = "🕒 Turnos"
            st.session_state["active_menu"] = "Turnos"
        elif menu_val == "Dashboard":
            st.session_state["active_menu_radio"] = "🗓️ Escala"
            st.session_state["active_menu"] = "Escala"
            st.session_state["active_schedule_tab"] = "📅 Gerar / Ajustar"
            st.session_state["active_schedule_tab_widget"] = "📅 Gerar / Ajustar"
    
    # Caso 1: Edição de Célula de Turno/Folga Diária
    if "change_emp" in query_params and "change_day" in query_params and "change_val" in query_params:
        employee_name = query_params["change_emp"]
        target_date = query_params["change_day"]
        new_value = query_params["change_val"]
        
        from database.repositories import employees_df
        from services.schedule_service import ScheduleService
        visual_code_to_action = ScheduleService.visual_code_to_action
        apply_visual_day_change_with_repair = ScheduleService.apply_visual_day_change_with_repair
        
        employees = employees_df()
        emp_match = employees[employees["nome"] == employee_name]
        if not emp_match.empty:
            emp_id = int(emp_match.iloc[0]["id"])
            action, value = visual_code_to_action(new_value)
            if action is not None:
                logs = apply_visual_day_change_with_repair(
                    emp_id, target_date, action, value, "Ajuste direto pela escala visual"
                )
                if not logs.empty:
                    st.session_state["repair_logs"] = logs
        
        st.session_state["active_menu"] = "Escala"
        st.session_state["active_menu_radio"] = "🗓️ Escala"
        
        # Limpa apenas chaves de edição e garante persistência do menu
        for k in ["change_emp", "change_day", "change_val"]:
            if k in st.query_params:
                del st.query_params[k]
        st.query_params["menu"] = "Escala"
        st.query_params["tab"] = "visual"
        st.rerun()

    # Caso 2: Lançamento de Pré-Alocação/Férias pelo Nome do Piloto
    elif "change_pre_emp" in query_params and "change_pre_action" in query_params:
        employee_name = query_params["change_pre_emp"]
        change_pre_action = query_params["change_pre_action"]
        
        # Pega competência opcional da URL
        try:
            req_year = int(query_params.get("year", date.today().year))
            req_month = int(query_params.get("month", date.today().month))
        except Exception:
            req_year = date.today().year
            req_month = date.today().month
            
        from database.repositories import employees_df
        employees = employees_df()
        emp_match = employees[employees["nome"] == employee_name]
        if not emp_match.empty:
            emp_id = int(emp_match.iloc[0]["id"])
            
            if change_pre_action == "FORM":
                st.session_state["open_pre_form_emp"] = employee_name
            else:
                import calendar
                from core.rules import month_range
                from ui.views.pre_allocations import add_preallocation_range
                
                start_date, end_date = month_range(req_year, req_month)
                
                if change_pre_action == "FERIAS_1Q":
                    dt_ini = date(req_year, req_month, 1)
                    dt_fim = date(req_year, req_month, min(15, calendar.monthrange(req_year, req_month)[1]))
                    add_preallocation_range(emp_id, dt_ini, dt_fim, "FÉRIAS", "Férias 1ª Quinzena (Escala Visual)")
                elif change_pre_action == "FERIAS_2Q":
                    dt_ini = date(req_year, req_month, 16)
                    dt_fim = end_date
                    add_preallocation_range(emp_id, dt_ini, dt_fim, "FÉRIAS", "Férias 2ª Quinzena (Escala Visual)")
                elif change_pre_action == "FERIAS_MES":
                    dt_ini = start_date
                    dt_fim = end_date
                    add_preallocation_range(emp_id, dt_ini, dt_fim, "FÉRIAS", "Férias Mês Inteiro (Escala Visual)")
        
        st.session_state["active_menu"] = "Escala"
        st.session_state["active_menu_radio"] = "🗓️ Escala"
        
        # Limpa apenas chaves de edição e garante persistência do menu
        for k in ["change_pre_emp", "change_pre_action"]:
            if k in st.query_params:
                del st.query_params[k]
        st.query_params["menu"] = "Escala"
        st.query_params["tab"] = "visual"
        st.rerun()

    # 3. Injeta a identidade visual orange/white premium (V51/V52)
    inject_visual_polish_v51()
    inject_v52_ui_fixes()

    st.title("🛫 Sistema de Escala PAO/APAO")
    st.caption("Versão 52 — Arquitetura Modular Premium de Alta Performance.")

    # 4. Painel de Controle de Competência e Roteamento na Sidebar
    today = date.today()
    
    # Preserva o ano e mês selecionados a partir da URL se presentes
    default_year = today.year
    default_month = today.month
    
    # Interceptamos os parâmetros de URL antes de limpar
    url_params = st.query_params
    if "year" in url_params:
        try:
            default_year = int(url_params["year"])
        except ValueError:
            pass
    if "month" in url_params:
        try:
            default_month = int(url_params["month"])
        except ValueError:
            pass

    with st.sidebar:
        st.header("Competência")
        year = st.number_input("Ano", min_value=2024, max_value=2035, value=default_year, step=1)
        month = st.selectbox("Mês", list(range(1, 13)), index=default_month - 1, format_func=lambda m: f"{m:02d}")
        
        st.markdown("---")
        menu_options = [
            "👥 Funcionários",
            "🕒 Turnos",
            "🗓️ Escala",
        ]

        if "active_menu_radio" not in st.session_state:
            st.session_state["active_menu_radio"] = "🗓️ Escala"
            
        menu_label = st.radio("Menu de Navegação", menu_options, key="active_menu_radio")
        # Filtra o emoji para obter a rota e salva na session state
        menu = menu_label.split(" ", 1)[1]
        st.session_state["active_menu"] = menu
        
        # Sincroniza query parameter na URL com a seleção manual da sidebar
        if "menu" not in st.query_params or st.query_params["menu"] != (
            "Escala" if menu == "Escala" else 
            "Funcionarios" if menu == "Funcionários" else 
            "Turnos" if menu == "Turnos" else menu
        ):
            st.query_params["menu"] = (
                "Escala" if menu == "Escala" else 
                "Funcionarios" if menu == "Funcionários" else 
                "Turnos" if menu == "Turnos" else menu
            )

    # 5. Roteamento Modular de Visualizações
    if menu == "Funcionários":
        render_employees_view(int(year), int(month))
    elif menu == "Turnos":
        render_shifts_view(int(year), int(month))
    elif menu == "Escala":
        render_schedule_view(int(year), int(month))

if __name__ == "__main__":
    main()
