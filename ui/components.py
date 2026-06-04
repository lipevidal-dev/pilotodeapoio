import streamlit as st
import pandas as pd
from datetime import date, timedelta
from ui.styles import VISUAL_COLORS, v51_panel
from core.rules import month_range

def produtividade_status_color(folgas, turnos, meta_turnos=20):
    """Cor do gráfico: verde = 10 folgas + meta produtivos (20 − ND)."""
    try:
        folgas = int(folgas)
        turnos = int(turnos)
        meta_turnos = int(meta_turnos)
    except Exception:
        return "#cccccc"

    if folgas == 10 and turnos == meta_turnos:
        return "#2ecc71"  # verde
    if (6 < folgas <= 9) and (max(8, meta_turnos - 2) <= turnos <= meta_turnos + 1):
        return "#f1c40f"  # amarelo
    if folgas <= 5 and turnos <= 7:
        return "#e74c3c"  # vermelho

    return "#95a5a6"  # cinza fora das faixas

def render_employee_bar_comparison_v52(resumo_prod):
    """Gráfico horizontal premium por funcionário no padrão laranja/branco V52."""
    if resumo_prod is None or resumo_prod.empty:
        st.info("Sem dados para o gráfico de produtividade.")
        return

    # Evita divisão por zero obtendo o máximo de alocações
    try:
        meta_col = resumo_prod["meta_produtivo"] if "meta_produtivo" in resumo_prod.columns else resumo_prod["total_produtivo"]
        max_total = int(max(resumo_prod["total_produtivo"].max(), meta_col.max(), resumo_prod["folgas"].max(), 1))
    except Exception:
        max_total = 1

    html = """
    <div style='border:1px solid #ffd1a3; border-radius:14px; padding:12px; background:#fffaf5;'>
        <div style='font-weight:800; margin-bottom:10px; color:#d95f00; font-family: sans-serif;'>Gráfico por funcionário</div>
        <div style='font-size:12px; margin-bottom:10px; color:#6b7280; font-family: sans-serif;'>
          <span style='color:#2ecc71; font-weight:700;'>■ Verde:</span> 10 folgas e meta produtivos (20 − ND) | 
          <span style='color:#f1c40f; font-weight:700;'>■ Amarelo:</span> próximo da meta | 
          <span style='color:#e74c3c; font-weight:700;'>■ Vermelho:</span> folgas ≤ 5 e produtivos ≤ 7
        </div>
    """

    for _, r in resumo_prod.iterrows():
        nome = str(r["funcionario"])
        turnos = int(r.get("total_produtivo", r.get("turnos_trabalhados", 0)))
        meta = int(r.get("meta_produtivo", 20))
        folgas = int(r.get("folgas", r.get("total_folgas", 0)))
        nd = int(r.get("nd", 0))
        cor = produtividade_status_color(folgas, turnos, meta_turnos=meta)
        w_turnos = max(4, int((turnos / max_total) * 100))
        w_folgas = max(4, int((folgas / max_total) * 100))
        meta_label = f"{turnos}/{meta}" if meta != 20 else str(turnos)
        nd_hint = f" (ND: {nd})" if nd else ""

        html += f"""
        <div style='margin:10px 0 14px 0; font-family: sans-serif;'>
          <div style='font-weight:700; font-size:12px; color:#111827;'>{nome} — Produtivo: {meta_label}{nd_hint} | Folgas: {folgas}</div>
          <div style='display:flex; align-items:center; gap:8px; margin-top:4px;'>
            <span style='width:70px; font-size:11px; color:#4b5563;'>Produtivo</span>
            <div style='height:16px; width:{w_turnos}%; background:{cor}; border-radius:6px; transition: width 0.5s ease;'></div>
          </div>
          <div style='display:flex; align-items:center; gap:8px; margin-top:3px;'>
            <span style='width:70px; font-size:11px; color:#4b5563;'>Folgas</span>
            <div style='height:16px; width:{w_folgas}%; background:#ffcccc; border-radius:6px; transition: width 0.5s ease;'></div>
          </div>
        </div>
        """

    html += "</div>"
    st.components.v1.html(html, height=min(700, 95 * len(resumo_prod) + 80), scrolling=True)

def render_print_button_v44():
    """Renderiza o botão clássico e nativo de impressão via Javascript window.print()."""
    html = """
    <button onclick="window.parent.print()" style="
        width: 100%;
        min-height: 44px;
        background:#ff7900;
        color:white;
        border:none;
        border-radius:12px;
        padding:8px 12px;
        font-weight:800;
        cursor:pointer;
        font-size:14px;
        line-height:18px;
        white-space:nowrap;
        font-family: sans-serif;
        box-shadow: 0 4px 6px -1px rgba(255, 121, 0, 0.2);">
        🖨️ Imprimir escala
    </button>
    """
    st.components.v1.html(html, height=56)

def toggle_dataframe(label, df, key, default=False):
    """Tabela de registros recolhível para manter a tela limpa."""
    safe_key = f"{key}_{abs(hash(label)) % 100000}"
    show = st.checkbox(f"👁️ Visualizar {label}", value=default, key=safe_key)
    if show:
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.caption(f"🙈 {label} oculto.")

def safe_dataframe_v52(label, df, key, default=False):
    """Controle seguro de exibição de DataFrames para evitar falhas de runtime."""
    try:
        if df is None or df.empty:
            st.info(f"{label}: sem dados para exibir.")
        else:
            toggle_dataframe(label, df, key, default=default)
    except Exception as e:
        st.warning(f"{label}: não foi possível carregar a tabela agora.")
        st.caption(str(e))

def get_visual_cell_color(value):
    """Mapeia os códigos de visualização da escala para suas cores hexadecimais."""
    reverse = {
        "F": VISUAL_COLORS["FOLGA"],
        "FP": VISUAL_COLORS["FOLGA PEDIDA"],
        "FER": VISUAL_COLORS["FÉRIAS"],
        "L": VISUAL_COLORS["FÉRIAS"],
        "V": VISUAL_COLORS["VOO"],
        "S": VISUAL_COLORS["SIMULADOR"],
        "C": VISUAL_COLORS["CURSO ONLINE"],
        "K": VISUAL_COLORS["CURSO ONLINE"],
        "CMA": VISUAL_COLORS["CMA"],
        "EP": VISUAL_COLORS["CMA"],
        "FS": VISUAL_COLORS["FOLGA SOCIAL"],
        "FAG": VISUAL_COLORS["FOLGA AGRUPADA"],
        "FA": VISUAL_COLORS["FOLGA ANIVERSÁRIO"],
        "DM": VISUAL_COLORS["DISPENSA MÉDICA"],
        "ND": VISUAL_COLORS["ND"],
    }
    return reverse.get(str(value), "white")

def is_visual_day_column(col):
    """Identifica se uma coluna da escala visual representa um dia (número ou número com espaço)."""
    try:
        val = str(col).strip()
        int(val)
        return True
    except ValueError:
        return False

def previous_month_last_day(year, month):
    """Calcula o último dia do mês anterior."""
    first = date(int(year), int(month), 1)
    return first - timedelta(days=1)

def render_classic_visual_html(df, titulo, year, month):
    """Renderiza a escala clássica e colorida nativa em HTML, ideal para visualização e impressão."""
    if df.empty:
        return f"<div style='font-family:sans-serif'><h3>{titulo}</h3><p>Sem dados.</p></div>"

    day_cols = [c for c in df.columns if is_visual_day_column(c)]
    
    # Carrega os turnos dinamicamente do banco para que alterações/exclusões reflitam instantaneamente
    from database.repositories import shifts_df
    try:
        active_shifts = shifts_df()["codigo"].tolist()
        if not active_shifts:
            active_shifts = ["T1", "T2", "T3", "T4", "T6", "T7", "T8", "T9"]
    except Exception:
        active_shifts = ["T1", "T2", "T3", "T4", "T6", "T7", "T8", "T9"]
    
    html = f"""
    <style>
    /* Forca visibilidade total dos containers do Streamlit para evitar clipping dos dropdowns na escala visual renderizada via st.markdown */
    .main .block-container,
    div[data-testid="stVerticalBlock"],
    div[data-testid="stVerticalBlockBorderWrapper"],
    div[data-testid="stHorizontalBlock"],
    div[data-testid="stTabs"],
    div[data-testid="stTabPanel"],
    div[role="tabpanel"],
    div.element-container,
    div.stMarkdown {{
      overflow: visible !important;
    }}
    .vscale-escala-wrap {{overflow-x: auto; overflow-y: visible; max-width: 100%; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background: white; font-family: system-ui, -apple-system, sans-serif;}}
    table.vscale-escala {{border-collapse:collapse; font-family:system-ui, -apple-system, sans-serif; font-size:10px; width: max-content; min-width: 100%; table-layout: fixed; overflow:visible;}}
    table.vscale-escala th {{border:1px solid #cbd5e1; padding:4px 1px; text-align:center; background:#f1f5f9; color:#0f172a; font-weight:700; font-size:9.5px; white-space:nowrap; width: 28px; min-width: 28px; max-width: 28px;}}
    table.vscale-escala td {{border:1px solid #cbd5e1; padding:0; text-align:center; font-weight: 700; font-size:9.5px; height: 26px; width: 28px; min-width: 28px; max-width: 28px; overflow:visible; white-space:nowrap;}}
    table.vscale-escala td.nome, table.vscale-escala th.nome-header {{
      text-align:left;
      padding:0;
      font-weight:800;
      background:#f8fafc;
      color:#1e293b;
      border-right:2px solid #94a3b8;
      overflow:visible;
      white-space:nowrap;
      min-width:140px !important;
      width:140px !important;
      max-width:180px !important;
    }}
    table.vscale-escala td.meta {{background:#f8fafc; font-weight:600; color:#475569; padding:0; font-size:9px;}}
    .vscale-legenda {{font-family:system-ui, -apple-system, sans-serif; margin-bottom:10px;}}
    .vscale-legenda span {{display:inline-block; padding:3px 6px; margin:2px; border:1px solid #cbd5e1; font-size:10px; border-radius:6px; font-weight: 600;}}
    .vscale-cargo-title {{font-family:system-ui, -apple-system, sans-serif; background:#ff7900; color:white; padding:8px 12px; margin-top:16px; font-weight:800; border-radius:8px 8px 0 0; font-size: 13px; letter-spacing: -0.01em;}}
    
    /* Dropdown CSS */
    .vscale-dropdown {{
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      min-height: 26px;
      overflow: visible;
    }}
    .vscale-dropbtn {{
      background: transparent;
      border: none;
      font-size: 9.5px;
      font-weight: 800;
      width: 100%;
      height: 100%;
      min-height: 26px;
      cursor: pointer;
      padding: 0;
      color: #111827;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
      white-space: nowrap;
    }}
    .vscale-dropbtn:hover {{
      background: rgba(0,0,0,0.08);
    }}
    .vscale-dropdown-content {{
      display: none;
      position: absolute;
      top: 100%;
      margin-top: -2px;
      background-color: #ffffff;
      min-width: 50px;
      box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.15);
      z-index: 9999;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      left: 50%;
      transform: translateX(-50%);
      max-height: 200px;
      overflow-y: auto;
    }}
    .vscale-dropdown-content a, .vscale-dropdown-content .vscale-opt, .vscale-opt-btn {{
      color: #1e293b;
      padding: 6px 10px;
      text-decoration: none;
      display: block;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
      transition: background 0.15s ease;
      white-space: nowrap;
      cursor: pointer;
      background: none;
      border: none;
      width: 100%;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, sans-serif;
    }}
    .vscale-dropdown-content a:hover, .vscale-dropdown-content .vscale-opt:hover, .vscale-opt-btn:hover {{
      background-color: #ff7900;
      color: #ffffff !important;
    }}
    .vscale-dropdown:hover .vscale-dropdown-content {{
      display: block;
    }}
    .vscale-dropdown.upward .vscale-dropdown-content {{
      top: auto;
      bottom: 100%;
      margin-bottom: -2px;
      box-shadow: 0px -8px 16px 0px rgba(0,0,0,0.15);
    }}
    table.vscale-escala td:hover,
    table.vscale-escala td:focus-within,
    .vscale-dropdown:hover,
    .vscale-dropdown:focus-within {{
      z-index: 100000 !important;
    }}
    </style>
    <div class='vscale-cargo-title'>{titulo}</div>
    <div class='vscale-legenda'>
        <span style='background:#ffcccc'>F Folga</span>
        <span style='background:#ffcccc'>FP Folga Pedida</span>
        <span style='background:#c8f7c5'>FS Social</span>
        <span style='background:#c8f7c5'>FAG Agrupada</span>
        <span style='background:#fbcfe8'>FA Aniversário</span>
        <span style='background:#cfe8ff'>FER Férias</span>
        <span style='background:#ffd8a8'>V Voo</span>
        <span style='background:#d9d9d9'>S Simulador</span>
        <span style='background:#fff3b0'>C Curso</span>
        <span style='background:#ddd6fe'>CMA Exame</span>
        <span style='background:#e5e7eb'>ND</span>
    </div>
    <div class='vscale-escala-wrap'>
    <table class='vscale-escala'>
    <colgroup>
      <col style="width: 140px;"> <!-- Nome -->
      <col style="width: 35px;"> <!-- Sen -->
    """

    for _ in day_cols:
        html += '    <col style="width: 28px; min-width: 28px; max-width: 28px;">'
    html += "    </colgroup>"

    # Cabeçalho: Dias do mês
    html += "<tr><th class='nome-header'>NOME</th><th>SEN</th>"
    for c in day_cols:
        html += f"<th>{c}</th>"
    html += "</tr>"

    # Cabeçalho: Dias da semana
    html += "<tr><th class='nome-header'></th><th></th>"
    dias_semana = ["S", "T", "Q", "Q", "S", "S", "D"]
    for idx_col, c in enumerate(day_cols):
        try:
            if idx_col == 0:
                possible_prev = previous_month_last_day(int(year), int(month))
                if str(c).strip() == str(possible_prev.day):
                    d = possible_prev
                else:
                    d = date(int(year), int(month), int(str(c).strip()))
            else:
                d = date(int(year), int(month), int(str(c).strip()))
            bg = "#fee2e2" if d.weekday() >= 5 else "#ffffff"
            html += f"<th style='background:{bg}'>{dias_semana[d.weekday()]}</th>"
        except Exception:
            html += "<th></th>"
    html += "</tr>"

    import urllib.parse

    # Conteúdo da tabela
    total_rows = len(df)
    for idx_row, r in enumerate(df.iterrows()):
        r = r[1] # obter a linha
        html += "<tr>"
        upward_class = " upward" if idx_row >= total_rows - 4 else ""
        name_dropdown_html = f"""
        <form method="get" style="margin:0; padding:0; display:block;">
            <input type="hidden" name="menu" value="Escala">
            <input type="hidden" name="tab" value="visual">
            <input type="hidden" name="change_pre_emp" value="{r['Funcionário']}">
            <input type="hidden" name="year" value="{year}">
            <input type="hidden" name="month" value="{month}">
            <div class="vscale-dropdown{upward_class}" style="overflow: visible;">
                <button type="button" class="vscale-dropbtn" style="text-align: left; padding: 4px 6px; font-weight: 800; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; width: 100%;">{r['Funcionário']}</button>
                <div class="vscale-dropdown-content" style="min-width: 210px; left: 0; transform: none; text-align: left;">
                    <button type="submit" name="change_pre_action" value="FERIAS_1Q" class="vscale-opt-btn" style="text-align: left; padding: 6px 12px;">🏖️ Lançar Férias (1ª Quinzena)</button>
                    <button type="submit" name="change_pre_action" value="FERIAS_2Q" class="vscale-opt-btn" style="text-align: left; padding: 6px 12px;">🏖️ Lançar Férias (2ª Quinzena)</button>
                    <button type="submit" name="change_pre_action" value="FERIAS_MES" class="vscale-opt-btn" style="text-align: left; padding: 6px 12px;">🏖️ Lançar Férias (Mês Inteiro)</button>
                    <button type="submit" name="change_pre_action" value="FORM" class="vscale-opt-btn" style="text-align: left; padding: 6px 12px; border-top: 1px solid #cbd5e1;">📅 Personalizar Pré-Alocação</button>
                </div>
            </div>
        </form>
        """
        html += f"<td class='nome' style='position: relative; overflow: visible;'>{name_dropdown_html}</td>"
        html += f"<td class='meta'>{r['Sen.']}</td>"
        for idx_col, c in enumerate(day_cols):
            val = r[c]
            bg = get_visual_cell_color(val)
            
            try:
                if idx_col == 0:
                    possible_prev = previous_month_last_day(int(year), int(month))
                    if str(c).strip() == str(possible_prev.day):
                        d = previous_month_last_day(int(year), int(month))
                    else:
                        d = date(int(year), int(month), int(str(c).strip()))
                else:
                    d = date(int(year), int(month), int(str(c).strip()))
                date_str = str(d)
            except Exception:
                date_str = ""
 
            if date_str:
                # Constrói dinamicamente os botões de turnos ativos
                shift_buttons = ""
                apao_s = [s for s in active_shifts if s in ["T1", "T2", "T3", "T4"]]
                pao_s = [s for s in active_shifts if s not in ["T1", "T2", "T3", "T4"]]
                
                if not apao_s and not pao_s:
                    apao_s = active_shifts
                
                for s in apao_s:
                    shift_buttons += f'<button type="submit" name="change_val" value="{s}" class="vscale-opt-btn">{s}</button>\n'
                
                if apao_s and pao_s:
                    shift_buttons += '<div style="border-top: 1px solid #cbd5e1; margin: 2px 0;"></div>'
                    
                for s in pao_s:
                    shift_buttons += f'<button type="submit" name="change_val" value="{s}" class="vscale-opt-btn">{s}</button>\n'

                dropdown_html = f"""
                <form method="get" style="margin:0; padding:0; display:block; width:100%; height:100%;">
                    <input type="hidden" name="menu" value="Escala">
                    <input type="hidden" name="tab" value="visual">
                    <input type="hidden" name="change_emp" value="{r['Funcionário']}">
                    <input type="hidden" name="change_day" value="{date_str}">
                    <input type="hidden" name="year" value="{year}">
                    <input type="hidden" name="month" value="{month}">
                    <div class="vscale-dropdown{upward_class}">
                        <button type="button" class="vscale-dropbtn">{val}</button>
                        <div class="vscale-dropdown-content">
                            {shift_buttons}
                            <button type="submit" name="change_val" value="F" class="vscale-opt-btn" style="border-top: 1px solid #cbd5e1;">F</button>
                            <button type="submit" name="change_val" value="FP" class="vscale-opt-btn">FP</button>
                            <button type="submit" name="change_val" value="FS" class="vscale-opt-btn">FS</button>
                            <button type="submit" name="change_val" value="FAG" class="vscale-opt-btn">FAG</button>
                            <button type="submit" name="change_val" value="FA" class="vscale-opt-btn">FA</button>
                            <button type="submit" name="change_val" value="FER" class="vscale-opt-btn">FER</button>
                            <button type="submit" name="change_val" value="DM" class="vscale-opt-btn">DM</button>
                            <button type="submit" name="change_val" value="V" class="vscale-opt-btn">V</button>
                            <button type="submit" name="change_val" value="S" class="vscale-opt-btn">S</button>
                            <button type="submit" name="change_val" value="C" class="vscale-opt-btn">C</button>
                            <button type="submit" name="change_val" value="CMA" class="vscale-opt-btn">CMA</button>
                            <button type="submit" name="change_val" value="ND" class="vscale-opt-btn">ND</button>
                            <button type="submit" name="change_val" value="" class="vscale-opt-btn" style="color: #ef4444; border-top: 1px solid #cbd5e1;">Limpar</button>
                        </div>
                    </div>
                </form>
                """
                html += f"<td style='background:{bg}; position: relative; overflow: visible;'>{dropdown_html}</td>"
            else:
                html += f"<td style='background:{bg};'>{val}</td>"
        html += "</tr>"

    html += "</table></div>"
    return html


def render_rules_auditor_component(year, month):
    """Auditoria de regras com painel visual."""
    from core.rules import validate_rules

    st.markdown("#### Auditor de regras")
    with st.spinner("Analisando conformidade..."):
        issues_df = validate_rules(year, month)

    if issues_df.empty:
        st.success("Escala 100% em conformidade.")
        return

    alta_critica = issues_df[issues_df["gravidade"].isin(["CRÍTICA", "ALTA"])]
    media = issues_df[issues_df["gravidade"] == "MÉDIA"]
    baixa = issues_df[issues_df["gravidade"] == "BAIXA"]

    cols = st.columns(3)
    cols[0].metric("Críticas / Altas", len(alta_critica))
    cols[1].metric("Médias", len(media))
    cols[2].metric("Baixas / Avisos", len(baixa))

    for _, row in issues_df.iterrows():
        grav = str(row["gravidade"]).upper()
        if grav in ["CRÍTICA", "ALTA"]:
            bg_color, border_color, text_color, icon = "#fff5f5", "#feb2b2", "#c53030", "🔴"
        elif grav == "MÉDIA":
            bg_color, border_color, text_color, icon = "#fffaf0", "#fbd38d", "#c05621", "🟡"
        else:
            bg_color, border_color, text_color, icon = "#ebf8ff", "#90cdf4", "#2b6cb0", "🔵"
        data_str = f" - {row['data']}" if row["data"] else ""
        func_str = f" | {row['funcionario']}" if row.get("funcionario") and row["funcionario"] != "-" else ""
        st.markdown(
            f"""<div style="background:{bg_color};border:1px solid {border_color};border-radius:8px;padding:12px;margin-bottom:8px;">
            <strong>{icon} [{grav}] {row['tipo']}{data_str}{func_str}</strong><br/>
            <span style="color:{text_color};font-size:13px;">{row['detalhe']}</span></div>""",
            unsafe_allow_html=True,
        )
