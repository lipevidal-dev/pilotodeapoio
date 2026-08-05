import pandas as pd
from datetime import datetime, date, timedelta
import matplotlib
# Use a non-interactive backend for matplotlib to prevent GUI thread conflicts on the user system
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.platypus import SimpleDocTemplate, Spacer, Paragraph, Table, TableStyle, PageBreak
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import cm

from core.rules import month_range, iter_days
from database.repositories import schedule_df, allocations_df, employees_df
from ui.styles import VISUAL_COLORS

def build_visual_schedule_dataframe(year, month):
    """Gera um DataFrame no padrão clássico da escala visual operacional."""
    start_date, end_date = month_range(year, month)
    prev_day = start_date - timedelta(days=1)

    sched = schedule_df(prev_day, end_date)
    alloc = allocations_df(prev_day, end_date)

    employees = employees_df()
    if employees.empty:
        return pd.DataFrame()

    actual_days = list(iter_days(year, month))
    display_dates = [prev_day] + actual_days

    # Mostra o dia anterior como número, sem sigla ANT.
    prev_label = str(prev_day.day)
    if prev_label in [str(d.day) for d in actual_days]:
        prev_label = prev_label + " "
    day_labels = [prev_label] + [str(d.day) for d in actual_days]

    rows = []
    for _, emp in employees.iterrows():
        row = {
            "Cargo": emp["cargo"],
            "Sen.": emp["senioridade"],
            "Funcionário": emp["nome"]
        }

        emp_sched = sched[sched["funcionario"] == emp["nome"]] if not sched.empty else pd.DataFrame()
        emp_alloc = alloc[alloc["funcionario"] == emp["nome"]] if not alloc.empty else pd.DataFrame()

        for label, current_date in zip(day_labels, display_dates):
            value = ""

            if not emp_alloc.empty:
                match_alloc = emp_alloc[pd.to_datetime(emp_alloc["data"]).dt.date == current_date]
                if not match_alloc.empty:
                    tipo = match_alloc.iloc[0]["tipo"]
                    code_map = {
                        "FOLGA": "F",
                        "FOLGA PEDIDA": "FP",
                        "FOLGA ESCOLHIDA": "FP",
                        "FOLGA SOCIAL": "FS",
                        "FOLGA AGRUPADA": "FAG",
                        "FOLGA ANIVERSÁRIO": "FA",
                        "FÉRIAS": "FER",
                        "FERIAS": "FER",
                        "DISPENSA MÉDICA": "DM",
                        "CURSO ONLINE": "C",
                        "CMA": "CMA",
                        "SIMULADOR": "S",
                        "VOO": "V",
                        "ND": "ND",
                    }
                    value = code_map.get(tipo, tipo)
                    if value == "FOLGA ESCOLHIDA":
                        value = "FP"

            if not emp_sched.empty:
                match = emp_sched[pd.to_datetime(emp_sched["data"]).dt.date == current_date]
                if not match.empty:
                    value = match.iloc[0]["turno"]

            row[str(label)] = value

        rows.append(row)

    return pd.DataFrame(rows)

def get_visual_cell_color(value):
    """Mapeia os códigos de visualização para cores hexadecimais da escala."""
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

def generate_schedule_png(df, output_path):
    """Renderiza a grade visual da escala como imagem PNG de alta resolução."""
    if df.empty:
        return None

    fig_width = max(18, len(df.columns) * 0.48)
    fig_height = max(7, len(df) * 0.46)

    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    ax.axis('off')

    table = ax.table(
        cellText=df.values,
        colLabels=df.columns,
        loc='center',
        cellLoc='center'
    )

    table.auto_set_font_size(False)
    table.set_fontsize(7)
    table.scale(1, 1.45)

    for (row, col), cell in table.get_celld().items():
        if row == 0:
            cell.set_facecolor("#0f172a")
            cell.set_text_props(color="white", weight="bold")
        elif col >= 3:
            value = df.iloc[row-1, col]
            cell.set_facecolor(get_visual_cell_color(value))
        elif col < 3:
            cell.set_facecolor("#f8fafc")

    plt.tight_layout()
    plt.savefig(output_path, bbox_inches='tight', dpi=300)
    plt.close(fig)

    return output_path

def generate_schedule_pdf(df, output_path, title="Escala Operacional"):
    """Gera PDF paisagem A4 fatiando colunas de dias — evita corte horizontal."""
    if df is None or df.empty:
        doc = SimpleDocTemplate(str(output_path), pagesize=landscape(A4))
        doc.build([Paragraph(title, getSampleStyleSheet()["Heading1"])])
        return output_path

    fixed_cols = [c for c in df.columns if c in ("Cargo", "Sen.", "Funcionário")]
    day_cols = [c for c in df.columns if c not in fixed_cols]
    # ~16 dias por página + colunas fixas cabem em A4 paisagem com fonte 6pt
    chunk_size = 16
    day_chunks = [day_cols[i : i + chunk_size] for i in range(0, max(len(day_cols), 1), chunk_size)] or [[]]

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=landscape(A4),
        leftMargin=0.5 * cm,
        rightMargin=0.5 * cm,
        topMargin=0.5 * cm,
        bottomMargin=0.5 * cm,
    )

    styles = getSampleStyleSheet()
    elements = []

    for chunk_idx, days in enumerate(day_chunks):
        cols = fixed_cols + days
        chunk_df = df[cols] if cols else df
        data = [list(chunk_df.columns)] + chunk_df.values.tolist()

        name_w = 3.2 * cm
        fixed_other = 1.1 * cm
        usable = landscape(A4)[0] - 1.0 * cm
        fixed_width = name_w + fixed_other * max(len(fixed_cols) - 1, 0)
        day_count = max(len(days), 1)
        day_w = max(0.55 * cm, (usable - fixed_width) / day_count)
        col_widths = []
        for c in cols:
            if c == "Funcionário":
                col_widths.append(name_w)
            elif c in ("Cargo", "Sen."):
                col_widths.append(fixed_other)
            else:
                col_widths.append(day_w)

        page_title = title if chunk_idx == 0 else f"{title} (cont.)"
        elements.append(Paragraph(page_title, styles["Heading1"]))
        elements.append(Spacer(1, 6))

        table = Table(data, colWidths=col_widths, repeatRows=1)
        style_cmds = [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.black),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 6),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]
        for r in range(1, len(data)):
            for c in range(len(fixed_cols), len(data[0])):
                color = get_visual_cell_color(data[r][c])
                if color != "white":
                    style_cmds.append(("BACKGROUND", (c, r), (c, r), colors.HexColor(color)))

        table.setStyle(TableStyle(style_cmds))
        elements.append(table)
        if chunk_idx < len(day_chunks) - 1:
            elements.append(Spacer(1, 12))
            elements.append(PageBreak())

    doc.build(elements)
    return output_path
