import streamlit as st
import pandas as pd
from datetime import date, datetime
import calendar
from database.connection import execute
from database.repositories import (
    employees_df,
    shifts_df,
    allocations_df,
    add_allocation,
    delete_day_assignment_for_employee,
    delete_day_allocation_for_employee,
    delete_allocation_by_id,
    add_shift_restriction,
    shift_restrictions_df
)
from core.rules import month_range
from ui.components import toggle_dataframe

def employees_options_by_role_or_all():
    df = employees_df()
    if df.empty:
        return []
    return [
        f"{int(r['id'])} | {r['cargo']} {int(r['senioridade'])} | {r['nome']}"
        for _, r in df.iterrows()
    ]

def parse_employee_option_id(option):
    try:
        return int(str(option).split("|")[0].strip())
    except Exception:
        return None

def employee_role_by_id(emp_id):
    df = employees_df()
    if df.empty:
        return ""
    m = df[df["id"].astype(int) == int(emp_id)]
    if m.empty:
        return ""
    return str(m.iloc[0]["cargo"])

def add_preallocation_range(emp_id, start_day, end_day, tipo, notes="Lançado manualmente"):
    rows = []
    for d in pd.date_range(start_day, end_day, freq="D"):
        day = d.date()
        delete_day_assignment_for_employee(emp_id, day)
        delete_day_allocation_for_employee(emp_id, day)
        add_allocation(emp_id, day, tipo, notes)
        rows.append({"funcionario_id": emp_id, "data": str(day), "tipo": tipo})
    return pd.DataFrame(rows)

def render_pre_allocations_view(year, month):
    """Renderiza a visualização de Pré-alocações e bloqueios mensais."""
    start_date, end_date = month_range(int(year), int(month))

    st.markdown(f"## 📌 Pré-alocações antes da escala — {month:02d}/{year}")
    st.caption("Lance bloqueios, férias (FER), curso (C), CMA (exame periódico), simulador, voo, dispensa médica, folgas manuais e ND antes da geração automática.")

    pre_tab_ferias, pre_tab_restr, pre_tab_diarias, pre_tab_lista = st.tabs([
        "🏖️ Férias",
        "🚫 Restrições por funcionário",
        "📅 Pré-alocações diárias",
        "🗑️ Excluir / registros"
    ])

    emp_options = employees_options_by_role_or_all()

    with pre_tab_ferias:
        st.markdown("### Férias em Bloco")
        if not emp_options:
            st.warning("Cadastre funcionários antes de lançar férias.")
        else:
            with st.container(border=True):
                emp_opt = st.selectbox("Funcionário", emp_options, key="ferias_emp_v50")
                periodo = st.radio(
                    "Período",
                    ["Primeira quinzena", "Segunda quinzena", "Mês inteiro", "Período personalizado"],
                    horizontal=True,
                    key="ferias_periodo_v50"
                )

                if periodo == "Primeira quinzena":
                    dt_ini = date(int(year), int(month), 1)
                    dt_fim = date(int(year), int(month), min(15, calendar.monthrange(int(year), int(month))[1]))
                elif periodo == "Segunda quinzena":
                    dt_ini = date(int(year), int(month), 16)
                    dt_fim = end_date
                elif periodo == "Mês inteiro":
                    dt_ini = start_date
                    dt_fim = end_date
                else:
                    c1, c2 = st.columns(2)
                    dt_ini = c1.date_input("Início", value=start_date, min_value=start_date, max_value=end_date, key="ferias_ini_v50")
                    dt_fim = c2.date_input("Fim", value=end_date, min_value=start_date, max_value=end_date, key="ferias_fim_v50")

                if st.button("Lançar férias", key="btn_lancar_ferias_v50"):
                    emp_id = parse_employee_option_id(emp_opt)
                    if emp_id is None:
                        st.error("Funcionário inválido.")
                    elif dt_fim < dt_ini:
                        st.error("Data final menor que a inicial.")
                    else:
                        df_added = add_preallocation_range(emp_id, dt_ini, dt_fim, "FÉRIAS", "Férias lançadas na aba Pré-alocações")
                        st.success(f"Férias lançadas em {len(df_added)} dia(s) com sucesso.")
                        st.rerun()

    with pre_tab_restr:
        st.markdown("### Restrições por funcionário")
        st.caption("Use para impedir que um funcionário seja alocado em determinado turno neste mês de escala.")
        if not emp_options:
            st.warning("Cadastre funcionários antes de criar restrições.")
        else:
            with st.container(border=True):
                emp_opt = st.selectbox("Funcionário", emp_options, key="restr_emp_v50")
                emp_id = parse_employee_option_id(emp_opt)
                role = employee_role_by_id(emp_id) if emp_id else ""
                try:
                    turnos = shifts_df(role)["codigo"].tolist() if role else shifts_df()["codigo"].tolist()
                except Exception:
                    turnos = []
                turno = st.selectbox("Turno bloqueado", turnos, key="restr_turno_v50")
                obs = st.text_input("Observação", value="Restrição mensal de turno", key="restr_obs_v50")
                if st.button("Salvar restrição de turno", key="btn_restr_turno_v50"):
                    try:
                        add_shift_restriction(emp_id, int(year), int(month), turno, obs)
                        st.success(f"Restrição para o turno {turno} salva com sucesso.")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Não foi possível salvar a restrição: {e}")

    with pre_tab_diarias:
        st.markdown("### Pré-alocações diárias")
        st.caption("Lançamento de atividades específicas ou indisponibilidades dia a dia.")
        if not emp_options:
            st.warning("Cadastre funcionários antes de lançar pré-alocações.")
        else:
            with st.container(border=True):
                emp_opt = st.selectbox("Funcionário", emp_options, key="pre_emp_v50")
                tipo_selecionado = st.selectbox(
                    "Tipo de Pré-alocação",
                    ["FOLGA", "FOLGA PEDIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "FOLGA ANIVERSÁRIO", "VOO", "SIMULADOR", "CURSO ONLINE", "CMA", "DISPENSA MÉDICA", "ND", "Outro (digitar...)"],
                    key="pre_tipo_v50"
                )
                tipo_final = tipo_selecionado
                if tipo_selecionado == "Outro (digitar...)":
                    tipo_final = st.text_input("Digite o tipo de pré-alocação", key="pre_tipo_custom_v50").strip().upper()

                c1, c2 = st.columns(2)
                dt_ini = c1.date_input("Início", value=start_date, min_value=start_date, max_value=end_date, key="pre_ini_v50")
                dt_fim = c2.date_input("Fim", value=dt_ini, min_value=start_date, max_value=end_date, key="pre_fim_v50")
                obs = st.text_input("Observação", value="Lançado manualmente", key="pre_obs_v50")
                
                if st.button("Lançar pré-alocação", key="btn_pre_diaria_v50"):
                    emp_id = parse_employee_option_id(emp_opt)
                    if emp_id is None:
                        st.error("Funcionário inválido.")
                    elif tipo_selecionado == "Outro (digitar...)" and not tipo_final:
                        st.error("Por favor, digite o nome do tipo customizado.")
                    elif dt_fim < dt_ini:
                        st.error("Data final menor que a inicial.")
                    else:
                        df_added = add_preallocation_range(emp_id, dt_ini, dt_fim, tipo_final, obs)
                        st.success(f"{tipo_final} lançado em {len(df_added)} dia(s) com sucesso.")
                        st.rerun()

    with pre_tab_lista:
        st.markdown("### Pré-alocações registradas")
        df = allocations_df(start_date, end_date)
        if df.empty:
            st.info("Nenhuma pré-alocação cadastrada para este mês.")
        else:
            # Importa cores do estilo visual para os badges
            from ui.styles import VISUAL_COLORS

            # Seção de Exclusão em Massa
            col_bulk1, col_bulk2 = st.columns([3, 1])
            with col_bulk2:
                if st.button("🗑️ Limpar Mês Inteiro", key="btn_clear_all_pre_v52", type="secondary", use_container_width=True):
                    st.session_state["show_clear_all_confirm_v52"] = True
            
            if st.session_state.get("show_clear_all_confirm_v52"):
                st.warning("⚠️ Tem certeza que deseja excluir TODAS as pré-alocações deste mês? Esta ação não pode ser desfeita.")
                c_bulk1, c_bulk2 = st.columns(2)
                if c_bulk1.button("✅ Sim, excluir todas", key="btn_confirm_clear_all_v52", type="primary", use_container_width=True):
                    try:
                        execute("DELETE FROM allocations WHERE alloc_date BETWEEN ? AND ?", (str(start_date), str(end_date)))
                        st.success("Todas as pré-alocações deste mês foram excluídas!")
                        st.session_state["show_clear_all_confirm_v52"] = False
                        st.rerun()
                    except Exception as e:
                        st.error(f"Erro ao excluir: {e}")
                if c_bulk2.button("❌ Cancelar", key="btn_cancel_clear_all_v52", use_container_width=True):
                    st.session_state["show_clear_all_confirm_v52"] = False
                    st.rerun()

            # Renderiza as pré-alocações em um grid super limpo e elegante
            st.markdown(
                """
                <div style='background:#fffaf5; border:1px solid #ffd1a3; border-radius:12px; padding:10px 14px; margin-bottom:12px;'>
                  <span style='color:#d95f00; font-weight:800;'>Dica:</span> Clique no botão <b>🗑️</b> ao lado de qualquer registro para removê-lo instantaneamente do banco de dados!
                </div>
                """,
                unsafe_allow_html=True
            )

            # Cabeçalho da Tabela Customizada
            st.markdown("---")
            h1, h2, h3, h4, h5 = st.columns([2.5, 1.5, 2, 3, 1])
            h1.markdown("**Funcionário**")
            h2.markdown("**Data**")
            h3.markdown("**Tipo**")
            h4.markdown("**Observação**")
            h5.markdown("**Ação**")
            st.markdown("---")

            # Loop para renderizar cada linha
            for idx, r in df.iterrows():
                row_id = int(r["id"])
                func_name = r["funcionario"]
                func_cargo = r["cargo"]
                func_sen = int(r["senioridade"])
                data_obj = datetime.strptime(r["data"], "%Y-%m-%d")
                data_f = data_obj.strftime("%d/%m/%Y")
                tipo = r["tipo"]
                obs = r["observacao"] or ""

                c1, c2, c3, c4, c5 = st.columns([2.5, 1.5, 2, 3, 1])
                
                # Nome do funcionário com cargo e senioridade
                c1.markdown(f"**{func_name}** <br><small style='color:#6b7280;'>{func_cargo} {func_sen}</small>", unsafe_allow_html=True)
                
                # Data
                c2.markdown(f"<div style='margin-top: 8px;'>{data_f}</div>", unsafe_allow_html=True)
                
                # Badge colorido baseado no tipo
                bg = VISUAL_COLORS.get(tipo, "#e5e7eb")
                c3.markdown(
                    f"<div style='margin-top: 6px;'><span style='background:{bg}; color:#111827; font-weight:800; font-size:10.5px; padding:3px 8px; border-radius:6px; border: 1px solid rgba(0,0,0,0.08);'>{tipo}</span></div>",
                    unsafe_allow_html=True
                )
                
                # Observação
                c4.markdown(f"<div style='margin-top: 8px; color: #4b5563; font-style: italic;'>{obs}</div>", unsafe_allow_html=True)
                
                # Botão Excluir
                if c5.button("🗑️", key=f"btn_del_pre_row_{row_id}", help=f"Excluir pré-alocação de {func_name} no dia {data_f}"):
                    try:
                        delete_allocation_by_id(row_id)
                        st.success(f"Pré-alocação de {func_name} excluída com sucesso.")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Erro ao excluir registro: {e}")

        # Exibição de Restrições
        st.markdown("### Restrições de turno cadastradas")
        try:
            restr_df = shift_restrictions_df(int(year), int(month))
            if restr_df.empty:
                st.info("Nenhuma restrição de turno cadastrada para este mês.")
            else:
                toggle_dataframe("restrições de turno do mês", restr_df, "tbl_restricoes_turno_v50", default=True)
        except Exception:
            pass
