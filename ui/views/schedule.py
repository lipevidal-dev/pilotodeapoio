import streamlit as st
import pandas as pd
import calendar
from datetime import date, timedelta
import io
import os

from ui.styles import BLOCK_TYPES, VISUAL_COLORS, v51_panel
from ui.components import (
    safe_dataframe_v52,
    toggle_dataframe,
    render_print_button_v44,
    get_visual_cell_color,
    is_visual_day_column,
    previous_month_last_day,
    render_classic_visual_html,
)
from ui.views.analytics import render_gerar_ajustar_analytics
from database.repositories import delete_month_schedule
from core.rules import month_range
from services.schedule_service import ScheduleService
from services.exporter_excel import export_excel
from services.exporter_pdf import (
    generate_schedule_pdf,
    build_visual_schedule_dataframe,
)
from ui.views.pre_allocations import render_pre_allocations_view

# ==============================================================================
# 3. INTERACTIVE STREAMLIT VIEW RENDER
# ==============================================================================

@st.fragment
def render_visual_interactive_table(visual_df, year, month):
    st.markdown("### Ajustes Rápidos Diretos na Escala Visual")
    st.caption(
        "Ajuste a escala clicando diretamente nas células coloridas da grade visual para abrir o menu de turnos/folgas. "
        "As alterações são processadas instantaneamente no banco de dados."
    )
    html_content = render_classic_visual_html(visual_df, f"Escala Mensal Operacional PAO/APAO - {month:02d}/{year}", year, month)
    st.html(html_content)
    render_print_button_v44()


def _roles_for_generation():
    from database.repositories import employees_df
    roles = ["PAO", "APAO"]
    all_employees = employees_df()
    if not all_employees.empty and "PAO FCF" in all_employees["cargo"].values:
        roles.append("PAO FCF")
    return roles


def _run_generate_schedule(year, month) -> None:
    with st.spinner("Gerando escala..."):
        try:
            log_df = ScheduleService.generate_unified_schedule(
                year, month, _roles_for_generation(), auto_loop=True, max_attempts=8,
            )
            st.session_state["last_generation_log"] = log_df
            gaps_df = ScheduleService.crosscheck_operational_gaps(year, month)
            remaining = len(gaps_df)
            resumo = log_df[log_df["tipo"] == "RESUMO FINAL"] if not log_df.empty else pd.DataFrame()
            msg = "Escala gerada."
            if not resumo.empty:
                msg = str(resumo.iloc[0]["detalhe"])
            if remaining == 0:
                msg += " Cobertura PAO OK."
            else:
                msg += f" Ainda {remaining} lacuna(s) — veja o painel analítico."
            st.success(msg)
            st.balloons()
            st.query_params["menu"] = "Escala"
            st.query_params["tab"] = "visual"
            st.rerun()
        except Exception as e:
            st.error(f"Falha na geração: {e}")


def _run_clear_schedule(year, month) -> None:
    delete_month_schedule(year, month)
    st.warning(f"Escala operacional {month:02d}/{year} apagada.")
    st.query_params["menu"] = "Escala"
    st.query_params["tab"] = "visual"
    st.rerun()


def render_schedule_view(year, month):
    """Renderiza a visualização consolidada do módulo de Escala Operacional V52."""
    # Observação: A interceptação de parâmetros de alteração via URL é feita de forma centralizada no app.py.

    st.markdown("## 🗓️ Escala Mensal do Piloto de Apoio (PAO e APAO)")
    
    # Injeta estilos específicos
    st.markdown("""
    <style>
    .op-card {
        background: #ffffff;
        border: 1px solid #ffe0bd;
        border-radius: 14px;
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
    }
    </style>
    """, unsafe_allow_html=True)

    # Sincronização da aba ativa através de query params ou session state
    if "active_schedule_tab" not in st.session_state:
        st.session_state["active_schedule_tab"] = "📅 Gerar / Ajustar"

    if "tab" in st.query_params:
        tab_param = st.query_params["tab"]
        target_tab = None
        if tab_param == "gerar":
            target_tab = "📅 Gerar / Ajustar"
        elif tab_param == "pre":
            target_tab = "📌 Pré-alocações"
        elif tab_param == "visual":
            target_tab = "🗓️ Escala Visual & Exportação"
        
        # Só atualiza se o parâmetro da URL diferir do que já rastreamos no estado interno (evita loop e travamento)
        if target_tab and target_tab != st.session_state["active_schedule_tab"]:
            st.session_state["active_schedule_tab"] = target_tab
            st.session_state["active_schedule_tab_widget"] = target_tab

    tabs_options = [
        "📅 Gerar / Ajustar",
        "📌 Pré-alocações",
        "🗓️ Escala Visual & Exportação"
    ]

    try:
        default_idx = tabs_options.index(st.session_state["active_schedule_tab"])
    except ValueError:
        default_idx = 0

    st.markdown("""
    <style>
    /* Estilos para transformar o st.radio horizontal em um seletor de abas premium */
    .custom-tabs-container div[data-testid="stRadio"] > label {
        display: none !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] > div {
        flex-direction: row !important;
        background-color: #f3f4f6 !important;
        border-radius: 999px !important;
        padding: 4px !important;
        width: fit-content !important;
        border: 1px solid #e5e7eb !important;
        margin-bottom: 20px !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] > div > label {
        background-color: transparent !important;
        border: none !important;
        border-radius: 999px !important;
        padding: 8px 20px !important;
        font-weight: 700 !important;
        color: #4b5563 !important;
        cursor: pointer !important;
        transition: all 0.2s ease-in-out !important;
        margin: 0 !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] > div > label:hover {
        color: #ff7900 !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] > div > label[data-checked="true"] {
        background-color: #ff7900 !important;
        color: white !important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] > div > label[data-checked="true"] p {
        color: white !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] div[data-testid="stMarkdownContainer"] {
        margin-left: 0 !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] input[type="radio"] {
        position: absolute !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        pointer-events: none !important;
    }
    .custom-tabs-container div[data-testid="stRadio"] div[role="radiogroup"] > label > div:first-child {
        position: absolute !important;
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        pointer-events: none !important;
    }
    </style>
    """, unsafe_allow_html=True)

    st.markdown('<div class="custom-tabs-container">', unsafe_allow_html=True)
    selected_tab = st.radio(
        "Aba da Escala",
        options=tabs_options,
        index=default_idx,
        horizontal=True,
        key="active_schedule_tab_widget"
    )
    st.markdown('</div>', unsafe_allow_html=True)

    if selected_tab != st.session_state["active_schedule_tab"]:
        st.session_state["active_schedule_tab"] = selected_tab
        if selected_tab == "📅 Gerar / Ajustar":
            st.query_params["tab"] = "gerar"
        elif selected_tab == "📌 Pré-alocações":
            st.query_params["tab"] = "pre"
        elif selected_tab == "🗓️ Escala Visual & Exportação":
            st.query_params["tab"] = "visual"
        st.rerun()

    # Conteúdo condicional com base no seletor
    if selected_tab == "📅 Gerar / Ajustar":
        render_gerar_ajustar_analytics(year, month)

    elif selected_tab == "📌 Pré-alocações":
        render_pre_allocations_view(year, month)

    elif selected_tab == "🗓️ Escala Visual & Exportação":
        hdr_left, hdr_right = st.columns([5, 1])
        with hdr_left:
            st.markdown("### Escala Visual & Exportação")
        with hdr_right:
            b1, b2 = st.columns(2)
            with b1:
                if st.button("GERAR", type="primary", use_container_width=True, key="btn_gerar_escala"):
                    _run_generate_schedule(year, month)
            with b2:
                if st.button("APAGAR", use_container_width=True, key="btn_apagar_escala"):
                    _run_clear_schedule(year, month)

        visual_df = build_visual_schedule_dataframe(year, month)

        if "open_pre_form_emp" in st.session_state and st.session_state["open_pre_form_emp"] is not None:
            emp_name = st.session_state["open_pre_form_emp"]
            
            from database.repositories import employees_df
            employees = employees_df()
            emp_match = employees[employees["nome"] == emp_name]
            
            if not emp_match.empty:
                emp_id = int(emp_match.iloc[0]["id"])
                
                # Renderiza um formulário elegante no padrão laranja/branco para personalização direta na escala visual
                st.markdown(f"""
                <div style='background: #fff8f0; border: 1px solid #ffd1a3; border-radius: 12px; padding: 16px; margin-bottom: 20px;'>
                     <h4 style='color: #ff7900; margin: 0 0 8px 0;'>📅 Lançar Atividade ou Férias para <b>{emp_name}</b></h4>
                     <p style='font-size: 12px; color: #4b5563; margin: 0 0 16px 0;'>Selecione o tipo de atividade e o período desejado no mês para a pré-alocação.</p>
                </div>
                """, unsafe_allow_html=True)
                
                with st.form("visual_custom_pre_alloc_form", clear_on_submit=True):
                    tipo_label = st.selectbox(
                        "Tipo de Pré-alocação / Atividade",
                        ["FOLGA", "FOLGA PEDIDA", "FOLGA SOCIAL", "FOLGA AGRUPADA", "VOO", "SIMULADOR", "CURSO ONLINE", "CMA", "DISPENSA MÉDICA", "ND", "FÉRIAS"],
                        key="vis_pre_tipo"
                    )
                    c1, c2 = st.columns(2)
                    start_date, end_date = month_range(int(year), int(month))
                    dt_ini = c1.date_input("Data de Início", value=start_date, min_value=start_date, max_value=end_date, key="vis_pre_ini")
                    dt_fim = c2.date_input("Data de Fim", value=dt_ini, min_value=start_date, max_value=end_date, key="vis_pre_fim")
                    obs = st.text_input("Observação / Justificativa", value="Lançado diretamente pela escala visual", key="vis_pre_obs")
                    
                    col_btn1, col_btn2 = st.columns(2)
                    with col_btn1:
                        submitted = st.form_submit_button("💾 Confirmar Lançamento", type="primary", use_container_width=True)
                    with col_btn2:
                        cancel = st.form_submit_button("❌ Cancelar", use_container_width=True)
                        
                    if submitted:
                        if dt_fim < dt_ini:
                            st.error("A data de fim não pode ser menor que a data de início.")
                        else:
                            from ui.views.pre_allocations import add_preallocation_range
                            add_preallocation_range(emp_id, dt_ini, dt_fim, tipo_label, obs)
                            st.session_state["open_pre_form_emp"] = None
                            st.success(f"{tipo_label} lançado com sucesso para {emp_name}!")
                            st.rerun()
                    elif cancel:
                        st.session_state["open_pre_form_emp"] = None
                        st.rerun()

        if visual_df.empty:
            st.info("Nenhuma escala operacional ou funcionário configurado para este mês.")
        else:
            # Chama a tabela interativa otimizada com fragment para evitar recarregamento desnecessário de toda a página Streamlit
            render_visual_interactive_table(visual_df, year, month)

            # Exibe histórico de ajustes/reparos se houver
            if "repair_logs" in st.session_state and st.session_state["repair_logs"] is not None:
                st.markdown("#### 📜 Relatório de Ajustes e Resolução de Choques")
                st.dataframe(st.session_state["repair_logs"], use_container_width=True, hide_index=True)
                if st.button("Limpar Histórico de Ajustes"):
                    st.session_state["repair_logs"] = None
                    st.rerun()

            st.divider()

            # Seção de Exportação Física de Arquivos
            st.markdown("### 📥 Relatórios e Exportação")
            col_exp1, col_exp2 = st.columns(2)

            # Exportação Excel
            with col_exp1:
                try:
                    excel_data = export_excel(year, month)
                    st.download_button(
                        label="🟢 Exportar Dados Completos (Excel)",
                        data=excel_data,
                        file_name=f"escala_pao_apao_{year}_{month:02d}.xlsx",
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        use_container_width=True
                    )
                except Exception as e:
                    st.error(f"Erro ao compilar Excel: {e}")

            # Exportação PDF
            with col_exp2:
                pdf_path = f"escala_operacional_{year}_{month:02d}.pdf"
                try:
                    generate_schedule_pdf(visual_df, pdf_path, title=f"Escala Operacional PAO/APAO - {month:02d}/{year}")
                    with open(pdf_path, "rb") as f:
                         pdf_data = f.read()
                    st.download_button(
                        label="🔴 Exportar Grade de Escala (PDF)",
                        data=pdf_data,
                        file_name=pdf_path,
                        mime="application/pdf",
                        use_container_width=True
                    )
                    # Limpa arquivo temporário
                    if os.path.exists(pdf_path):
                        os.remove(pdf_path)
                except Exception as e:
                    st.error(f"Erro ao compilar PDF: {e}")