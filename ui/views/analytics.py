"""Painel analítico — GERAR / AJUSTAR (ex-Dashboard + métricas de escala)."""
import streamlit as st
import pandas as pd

from ui.styles import v51_panel
from ui.components import render_employee_bar_comparison_v52, safe_dataframe_v52
from core.rules import (
    self_diagnostic_df,
    coverage_issues_df,
    generate_fix_suggestions,
    employee_monthly_summary,
    validate_rules,
)
from services.schedule_service import ScheduleService
from ui.views.dashboard import internal_health_check, render_rules_summary_card, apply_update_zip
from ui.components import render_rules_auditor_component


def _render_coverage_daily_chart(summary: pd.DataFrame) -> None:
    if summary.empty:
        return
    st.markdown("#### Cobertura PAO por dia (T6 / T7 / T8)")
    chart_df = summary.set_index("dia")[["pao_t6", "pao_t7", "pao_t8"]].rename(
        columns={"pao_t6": "T6", "pao_t7": "T7", "pao_t8": "T8"}
    )
    st.bar_chart(chart_df, height=260)


def _render_gaps_chart(sheet_gaps: pd.DataFrame) -> None:
    if sheet_gaps.empty:
        st.success("Nenhum furo de turno detectado (estilo planilha).")
        return
    st.markdown("#### Furos por turno")
    if "turno" in sheet_gaps.columns:
        counts = sheet_gaps.groupby("turno").size().reset_index(name="furos")
        st.bar_chart(counts.set_index("turno"), height=200)


def _render_quality_chart(quality_df: pd.DataFrame) -> None:
    if quality_df.empty:
        st.info("Gere a escala para ver qualidade por funcionário.")
        return
    st.markdown("#### Nota de qualidade por funcionário")
    q = quality_df.sort_values("nota", ascending=True)
    chart = q.set_index("funcionario")[["nota"]]
    st.bar_chart(chart, height=max(220, len(q) * 28))


def render_gerar_ajustar_analytics(year: int, month: int) -> None:
    """Gráficos e diagnósticos consolidados."""
    st.markdown("### Painel analítico")
    v51_panel(
        "Visão geral da competência",
        "Furos, capacidade, produtividade e conformidade — atualize após gerar na aba Escala Visual.",
    )

    cap = ScheduleService.diagnose_capacity(year, month)
    sheet_health = ScheduleService.spreadsheet_health(year, month)
    gaps_df = ScheduleService.crosscheck_operational_gaps(year, month)
    summary = ScheduleService.spreadsheet_daily_summary(year, month)
    sheet_gaps = ScheduleService.spreadsheet_coverage_gaps(year, month)
    quality_df = ScheduleService.employee_quality_report(year, month)
    resumo_prod = employee_monthly_summary(year, month)

    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Capacidade", cap.get("status_label", "?"))
    m2.metric("Furos planilha", sheet_health.get("total_gaps", 0))
    m3.metric("Furos PAO", sheet_health.get("pao_gaps", 0))
    m4.metric("Lacunas operacionais", len(gaps_df) if not gaps_df.empty else 0)
    m5.metric("Pilotos PAO", cap.get("pao_pilotos", 0))

    if cap.get("status") == "critico":
        st.error(cap.get("message", ""))
    elif cap.get("status") == "atencao":
        st.warning(cap.get("message", ""))
    else:
        st.success(cap.get("message", ""))

    c1, c2 = st.columns(2)
    with c1:
        _render_coverage_daily_chart(summary)
    with c2:
        _render_gaps_chart(sheet_gaps)

    st.markdown("---")
    render_employee_bar_comparison_v52(resumo_prod)

    st.markdown("---")
    _render_quality_chart(quality_df)

    if not quality_df.empty:
        with st.expander("Detalhe qualidade por funcionário", expanded=False):
            st.dataframe(
                quality_df.rename(columns={
                    "funcionario": "Funcionário",
                    "cargo": "Cargo",
                    "turnos": "Turnos",
                    "blocos_4plus": "Blocos ≥4",
                    "folgas_isoladas": "Folgas isoladas",
                    "excecoes_quinzena": "Exc. bloco",
                    "nota": "Nota",
                    "status": "Status",
                }),
                use_container_width=True,
                hide_index=True,
            )

    st.markdown("---")
    st.markdown("### Autodiagnóstico da competência")
    diag_df = self_diagnostic_df(year, month)
    d1, d2 = st.columns(2)
    with d1:
        if not diag_df.empty:
            for _, r in diag_df.iterrows():
                emoji = "✅" if r["resultado"] == "OK" else "⚠️"
                st.metric(
                    f"{emoji} {r['teste']}",
                    r["resultado"],
                    delta=f"{r['achados']} achado(s)" if r["achados"] > 0 else None,
                )
        else:
            st.info("Sem escala gerada neste mês.")
    with d2:
        st.markdown("#### Camadas do sistema")
        st.dataframe(internal_health_check(), use_container_width=True, hide_index=True)

    st.markdown("---")
    st.markdown("### Cobertura horária (24h)")
    safe_dataframe_v52("Janelas com furo", coverage_issues_df(year, month), "cov_issues_an", default=False)

    st.markdown("---")
    st.markdown("### Plano de ações sugeridas")
    suggestions_df = generate_fix_suggestions(year, month)
    if suggestions_df.empty:
        st.success("Nenhuma sugestão corretiva pendente.")
    else:
        for _, s in suggestions_df.head(12).iterrows():
            sev = str(s.get("prioridade", "INFO")).upper()
            line = f"**{s['problema']}** — {s['sugestão']}"
            if sev == "ALTA":
                st.error(line)
            elif sev in ("MÉDIA", "WARN"):
                st.warning(line)
            else:
                st.info(line)

    st.markdown("---")
    if "last_generation_log" in st.session_state and not st.session_state.get("last_generation_log", pd.DataFrame()).empty:
        with st.expander("Log da última geração", expanded=False):
            st.dataframe(st.session_state["last_generation_log"], use_container_width=True, hide_index=True)

    with st.expander("Contagem diária (planilha)", expanded=False):
        if not summary.empty:
            view = summary[["dia", "pao_t6", "pao_t7", "pao_t8", "folgas", "voo", "curso", "cma"]].rename(
                columns={
                    "dia": "Dia", "pao_t6": "T6", "pao_t7": "T7", "pao_t8": "T8",
                    "folgas": "Folgas", "voo": "V", "curso": "C", "cma": "CMA",
                }
            )
            st.dataframe(view, use_container_width=True, hide_index=True)

    with st.expander("Diagnóstico de capacidade (tabela)", expanded=False):
        st.dataframe(ScheduleService.capacity_summary_df(year, month), use_container_width=True, hide_index=True)

    st.markdown("---")
    render_rules_auditor_component(year, month)

    with st.expander("Atualizar sistema (.zip)", expanded=False):
        uploaded = st.file_uploader("Arquivo update.zip", type=["zip"], key="analytics_zip_update")
        if uploaded and st.button("Aplicar atualização", key="analytics_apply_zip"):
            ok, msg = apply_update_zip(uploaded)
            st.success(msg) if ok else st.error(msg)

    render_rules_summary_card()
