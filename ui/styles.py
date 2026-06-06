import streamlit as st

BLOCK_TYPES = {
    "FOLGA",
    "FOLGA SOCIAL",
    "FOLGA PEDIDA",
    "DISPENSA MÉDICA",
    "FÉRIAS",
    "CURSO ONLINE",
    "SIMULADOR",
    "VOO",
    "ND",
    "CMA",
    "FOLGA AGRUPADA",
    "FOLGA ANIVERSÁRIO",
}

VISUAL_COLORS = {
    "FOLGA": "#ffcccc",
    "FOLGA PEDIDA": "#ffcccc",
    "FÉRIAS": "#cfe8ff",
    "VOO": "#ffd8a8",
    "SIMULADOR": "#d9d9d9",
    "CURSO ONLINE": "#fff3b0",
    "CMA": "#ddd6fe",
    "FOLGA SOCIAL": "#c8f7c5",
    "FOLGA AGRUPADA": "#c8f7c5",
    "DISPENSA MÉDICA": "#e9d5ff",
    "ND": "#e5e7eb",
    "FOLGA ANIVERSÁRIO": "#fbcfe8",
}

def inject_visual_polish_v51():
    """Injeta estilos CSS personalizados de acordo com o design laranja e branco da V51."""
    st.markdown("""
    <style>
    :root {
        --primary-orange: #ff7900;
        --soft-orange: #fff4e8;
        --line-orange: #ffd1a3;
        --dark: #111827;
        --muted: #6b7280;
    }

    section[data-testid="stSidebar"] {
        background: linear-gradient(180deg, #ffffff 0%, #fff7ef 100%);
        border-right: 1px solid #ffe0bd;
    }

    section[data-testid="stSidebar"] [role="radiogroup"] label {
        border-radius: 12px;
        padding: 6px 8px;
        margin: 2px 0;
    }

    .main .block-container {
        padding-top: 1.4rem;
        padding-bottom: 2rem;
        max-width: 1500px;
    }

    h1, h2, h3 {
        letter-spacing: -0.02em;
    }

    div[data-testid="stMetric"] {
        background: #fffaf5;
        border: 1px solid #ffd1a3;
        border-left: 5px solid #ff7900;
        border-radius: 16px;
        padding: 10px 12px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.03);
    }

    div[data-testid="stExpander"] {
        border: 1px solid #ffe0bd !important;
        border-radius: 14px !important;
        overflow: hidden;
        background: #ffffff;
    }

    div[data-testid="stTabs"] button {
        border-radius: 999px;
        padding: 8px 14px;
        font-weight: 700;
    }

    div[data-testid="stTabs"] button[aria-selected="true"] {
        background: #ff7900 !important;
        color: white !important;
    }

    [data-testid="stDataFrame"] {
        border: 1px solid #ffd1a3;
        border-radius: 14px;
        overflow: hidden;
    }

    [data-testid="stDataFrame"] div[role="gridcell"],
    [data-testid="stDataFrame"] div[role="columnheader"] {
        font-size: 10px !important;
        padding: 1px 2px !important;
        min-height: 22px !important;
    }

    .scale-edit-panel {
        background: #fffaf5;
        border: 1px solid #ffd1a3;
        border-left: 6px solid #ff7900;
        border-radius: 16px;
        padding: 10px;
        margin: 6px 0 8px 0;
    }

    button[kind="primary"], div.stButton > button {
        border-radius: 12px !important;
        border: 1px solid #ffb66b !important;
        font-weight: 800 !important;
        background-color: #ff7900 !important;
        color: white !important;
        box-shadow: 0 4px 6px rgba(255, 121, 0, 0.15) !important;
    }

    div.stButton > button:hover {
        border-color: #ff9d42 !important;
        background-color: #e56d00 !important;
        color: #ffffff !important;
    }

    /* Estilização abrangente de alto contraste para inputs do Streamlit (Laranja/Branco V52 Premium) */
    div[data-testid="stTextInput"] div[data-baseweb="base-input"],
    div[data-testid="stNumberInput"] div[data-baseweb="base-input"],
    div[data-testid="stDateInput"] div[data-baseweb="base-input"],
    div[data-testid="stSelectbox"] div[data-baseweb="select"],
    div[data-testid="stTextArea"] div[data-baseweb="textarea"] {
        border: 2px solid #ffb66b !important; /* Borda laranja média muito nítida e visível */
        border-radius: 10px !important;
        background-color: #ffffff !important;
        transition: all 0.2s ease-in-out !important;
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05) !important;
    }

    /* Efeito de foco quando o usuário clica ou digita no campo */
    div[data-testid="stTextInput"] div[data-baseweb="base-input"]:focus-within,
    div[data-testid="stNumberInput"] div[data-baseweb="base-input"]:focus-within,
    div[data-testid="stDateInput"] div[data-baseweb="base-input"]:focus-within,
    div[data-testid="stSelectbox"] div[data-baseweb="select"]:focus-within,
    div[data-testid="stTextArea"] div[data-baseweb="textarea"]:focus-within {
        border-color: #ff7900 !important; /* Laranja ativo forte */
        box-shadow: 0 0 0 4px rgba(255, 121, 0, 0.20) !important;
    }

    /* Estilização e contraste impecáveis para a caixa do Checkbox do Streamlit */
    div[data-testid="stCheckbox"] label span[role="checkbox"] {
        border: 2px solid #ffb66b !important;
        border-radius: 6px !important;
        background-color: #ffffff !important;
        transition: all 0.15s ease-in-out !important;
        width: 18px !important;
        height: 18px !important;
    }

    div[data-testid="stCheckbox"] label:hover span[role="checkbox"] {
        border-color: #ff7900 !important;
        background-color: #fff4e8 !important;
    }

    div[data-testid="stCheckbox"] label span[role="checkbox"][aria-checked="true"] {
        background-color: #ff7900 !important;
        border-color: #ff7900 !important;
    }

    /* Ajuste de contraste para os textos de legenda (Placeholder) */
    div[data-baseweb="base-input"] input::placeholder,
    div[data-baseweb="textarea"] textarea::placeholder {
        color: #9ca3af !important;
        opacity: 1 !important;
    }

    /* Força cor nos rótulos principais dos campos para melhor legibilidade e peso */
    label[data-testid="stWidgetLabel"] p {
        font-weight: 750 !important;
        color: #1f2937 !important;
        font-size: 14px !important;
        margin-bottom: 4px !important;
    }
    </style>
    """, unsafe_allow_html=True)

def v51_panel(title, help_text=""):
    """Renderiza um bloco em painel elegante com o design laranja/branco de autoria."""
    st.markdown(
        f"""
        <div style='background:#fffaf5;border:1px solid #ffd1a3;border-left:6px solid #ff7900;border-radius:18px;padding:12px 14px;margin:10px 0 14px 0;'>
            <div style='font-weight:900;color:#c95f00;margin-bottom:4px;'>{title}</div>
            <div style='color:#6b7280;font-size:12px;'>{help_text}</div>
        </div>
        """,
        unsafe_allow_html=True
    )

def inject_v52_ui_fixes():
    """Injeta as correções e otimizações de altura da escala e painéis da V52."""
    st.markdown("""
    <style>
    div.stButton > button {
        min-height: 44px !important;
        white-space: nowrap !important;
        padding: 8px 14px !important;
        font-size: 14px !important;
        line-height: 18px !important;
    }

    [data-testid="stDataFrame"] div[role="row"] {
        min-height: 24px !important;
    }

    [data-testid="stDataFrame"] div[role="gridcell"],
    [data-testid="stDataFrame"] div[role="columnheader"] {
        font-size: 10px !important;
        padding-top: 0px !important;
        padding-bottom: 0px !important;
    }

    .v52-chart-box {
        border: 1px solid #ffd1a3;
        border-left: 6px solid #ff7900;
        background: #fffaf5;
        border-radius: 16px;
        padding: 12px;
        margin-top: 12px;
    }

    div[data-testid="stMarkdownContainer"]:has(.vscale-escala-wrap),
    div[data-testid="stMarkdownContainer"]:has(.vscale-cargo-title) {
        max-width: 100% !important;
        overflow-x: auto !important;
    }
    </style>
    """, unsafe_allow_html=True)
