import streamlit as st
import pandas as pd
import zipfile
import shutil
from pathlib import Path
from ui.styles import v51_panel
from ui.components import safe_dataframe_v52
from core.rules import self_diagnostic_df, coverage_issues_df, generate_fix_suggestions
from database.repositories import employees_df, shifts_df

def internal_health_check():
    """Realiza uma checagem abrangente e modular de integridade do sistema."""
    checks = []

    def add(name, ok, detail=""):
        checks.append({"checagem": name, "status": "OK" if ok else "FALHA", "detalhe": detail})

    # Verifica módulos importados e suas presenças operacionais
    try:
        from database.connection import get_db_path
        add("Database Layer (connection)", True, f"DB Ativo: {get_db_path()}")
    except Exception as e:
        add("Database Layer (connection)", False, str(e))

    try:
        from database.repositories import employees_df, shifts_df, allocations_df, schedule_df
        add("Repository Layer (repositories)", True, "Tabelas principais disponíveis")
    except Exception as e:
        add("Repository Layer (repositories)", False, str(e))

    try:
        from core.rules import validate_rules
        add("Business Logic Layer (rules)", True, "Regras de negócios e auditoria de escala")
    except Exception as e:
        add("Business Logic Layer (rules)", False, str(e))

    try:
        from core.scheduler import generate_auto_schedule
        add("Auto-Scheduler Layer (scheduler)", True, "Motor de geração e otimização automática")
    except Exception as e:
        add("Auto-Scheduler Layer (scheduler)", False, str(e))

    try:
        from services.exporter_pdf import generate_schedule_pdf
        from services.exporter_excel import export_excel
        add("Services Exporter Layer (PDF/Excel)", True, "Exportadores operacionais de relatórios")
    except Exception as e:
        add("Services Exporter Layer (PDF/Excel)", False, str(e))

    try:
        emp = employees_df()
        add("Consulta Funcionários (employees_df)", True, f"{len(emp)} funcionários cadastrados")
    except Exception as e:
        add("Consulta Funcionários (employees_df)", False, str(e))

    try:
        sh = shifts_df()
        add("Consulta Turnos (shifts_df)", True, f"{len(sh)} turnos de trabalho configurados")
    except Exception as e:
        add("Consulta Turnos (shifts_df)", False, str(e))

    return pd.DataFrame(checks)

def apply_update_zip(uploaded_file):
    """Aplica patch de atualização do sistema via pacote ZIP de forma segura."""
    if uploaded_file is None:
        return False, "Nenhum arquivo enviado."

    # Caminho do diretório raiz do projeto (onde app.py reside)
    root_dir = Path(__file__).resolve().parent.parent.parent
    backup_dir = root_dir / "_backup_update"
    temp_dir = root_dir / "_tmp_update"

    if backup_dir.exists():
        shutil.rmtree(backup_dir, ignore_errors=True)
    if temp_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)

    temp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = temp_dir / "update.zip"
    zip_path.write_bytes(uploaded_file.getbuffer())

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(temp_dir / "extracted")
    except Exception as e:
        return False, f"ZIP inválido ou corrompido: {e}"

    # Procura pelo arquivo principal de rota app.py no pacote extraído
    candidates = list((temp_dir / "extracted").rglob("app.py"))
    if not candidates:
        return False, "Não encontrei app.py dentro do ZIP de atualização."

    new_root = candidates[0].parent
    backup_dir.mkdir(parents=True, exist_ok=True)

    # Backup total do sistema atual
    for item in root_dir.iterdir():
        if item.name in [".venv", "_tmp_update", "_backup_update", ".git", "__pycache__"]:
            continue
        dest = backup_dir / item.name
        try:
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest)
        except Exception:
            pass

    # Copia novos arquivos para a raiz
    for item in new_root.iterdir():
        if item.name in [".venv", "_tmp_update", "_backup_update", ".git", "__pycache__"]:
            continue
        dest = root_dir / item.name
        try:
            if item.is_dir():
                if dest.exists():
                    shutil.rmtree(dest, ignore_errors=True)
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)
        except Exception as e:
            return False, f"Falha ao atualizar {item.name}: {e}"

    shutil.rmtree(temp_dir, ignore_errors=True)
    return True, "Atualização aplicada com sucesso! Reinicie o sistema pelo INICIAR_SISTEMA.bat."

def render_rules_summary_card():
    """Renderiza card com resumo das regras de conformidade da escala."""
    st.html("""
    <div style="
        background: linear-gradient(135deg, #ffffff 0%, #fffbf7 100%);
        border: 2px solid #ff7900;
        border-radius: 16px;
        padding: 24px;
        margin-top: 24px;
        margin-bottom: 24px;
        box-shadow: 0 10px 25px -5px rgba(255, 121, 0, 0.08), 0 8px 10px -6px rgba(255, 121, 0, 0.04);
        font-family: 'Segoe UI', Roboto, sans-serif;
    ">
        <div style="display: flex; align-items: center; margin-bottom: 18px; border-bottom: 2px solid #ffe0bd; padding-bottom: 12px;">
            <span style="font-size: 28px; margin-right: 12px;">🛡️</span>
            <div>
                <h3 style="color: #ff7900; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">Resumo das Regras de Escala Ativas</h3>
                <span style="color: #6b7280; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Diretrizes de Conformidade Operacional</span>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div>
                <div style="display: flex; margin-bottom: 12px;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Regra T8/T8/ND Obrigatória</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">Todo T8 em bloco T8/T8/ND. Cada piloto elegível recebe no mínimo 1 bloco no mês (até 2 se a cobertura exigir). Preferência T8 é incentivo, não exclusividade.</span>
                    </div>
                </div>
                <div style="display: flex; margin-bottom: 12px;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Alternância Quinzenal (Regular PAO)</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">Grupos A/B/C por senioridade: turnos e voos alternam entre quinzenas conforme o bloco do piloto.</span>
                    </div>
                </div>
                <div style="display: flex; margin-bottom: 12px;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Estações Simultâneas no Escritório</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">Máximo de 2 estações físicas ativas simultaneamente (exclui T9 e PAO FCF remoto).</span>
                    </div>
                </div>
                <div style="display: flex;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Preservação de Folgas Planejadas</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">Folgas manuais (FOLGA / FOLGA PEDIDA) são preservadas e não são substituídas na geração automática.</span>
                    </div>
                </div>
            </div>
            <div>
                <div style="display: flex; margin-bottom: 12px;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Ordem de geração</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">1º APAO (preferência de turno, senioridade 1→N, sem dias vazios) → 2º PAO/PAO FCF por senioridade 1→N → T8 automático → ajustes v2.</span>
                    </div>
                </div>
                <div style="display: flex; margin-bottom: 12px;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">APAO — Regras Isoladas</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">APAO segue 6×1, folga agrupada e restrições próprias. Sem pareamento obrigatório com PAO. Se faltar APAO, PAO extra cobre (até 2 PAO no mesmo turno).</span>
                    </div>
                </div>
                <div style="display: flex; margin-bottom: 12px;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Limite de Trabalho Consecutivo</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">Máximo de 6 dias consecutivos trabalhados para PAO e APAO.</span>
                    </div>
                </div>
                <div style="display: flex;">
                    <div style="color: #ff7900; font-weight: bold; margin-right: 8px; font-size: 16px;">✓</div>
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">Metas de Carga de Trabalho</strong><br>
                        <span style="color: #4b5563; font-size: 12.5px; line-height: 1.4;">10–11 folgas por piloto (máx. 12 se inevitável); dias livres restantes viram VOO. Meta produtiva PAO = 20 − ND.</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    """)


def render_dashboard_view(year, month):
    """Renderiza a visualização do painel de diagnóstico geral e autodiagnóstico V52."""
    st.markdown("## 📊 Painel de Status Geral e Autodiagnóstico")
    v51_panel(
        "Diagnóstico da Escala Operacional",
        "Esta tela realiza varredura automática em busca de furos de cobertura, incompatibilidades e sugestões corretivas."
    )

    # 1. Autodiagnóstico Geral
    st.markdown("### 🔍 Diagnóstico Rápido da Competência")
    diag_df = self_diagnostic_df(year, month)
    
    col1, col2 = st.columns(2)
    with col1:
        if not diag_df.empty:
            for _, r in diag_df.iterrows():
                status_emoji = "✅" if r["resultado"] == "OK" else "⚠️"
                st.metric(
                    label=f"{status_emoji} {r['teste']}",
                    value=r["resultado"],
                    delta=f"{r['achados']} incompatibilidades encontradas" if r["achados"] > 0 else "Nenhum problema"
                )
        else:
            st.info("Sem escala gerada neste mês.")
    
    with col2:
        # Checagem de integridade interna dos scripts do sistema
        st.markdown("#### ⚙️ Status das Camadas de Software")
        health_df = internal_health_check()
        st.dataframe(health_df, use_container_width=True, hide_index=True)

    st.divider()

    # 2. Incompatibilidades e Furos de Cobertura Horária
    st.markdown("### 🕒 Incompatibilidades de Cobertura Horária (24 horas)")
    issues_cov_df = coverage_issues_df(year, month)
    safe_dataframe_v52("Lista de Furos na Janela 24h", issues_cov_df, "cov_issues", default=True)

    st.divider()

    # 3. Sugestões Automatizadas de Correções
    st.markdown("### 💡 Plano de Ações Corretivas Sugeridas")
    suggestions_df = generate_fix_suggestions(year, month)
    
    if not suggestions_df.empty:
        for _, s in suggestions_df.iterrows():
            severity = str(s.get("prioridade", "INFO")).upper()
            prob = s["problema"]
            sug = s["sugestão"]
            data_info = f" | Data: {s['data']}" if s["data"] != "-" else ""
            janela_info = f" ({s['janela']})" if s["janela"] != "-" else ""

            if severity == "ALTA":
                st.error(f"🚨 **{prob}**{data_info}{janela_info}\n\n*Ação sugerida:* {sug}")
            elif severity in ["MÉDIA", "WARN"]:
                st.warning(f"⚠️ **{prob}**{data_info}{janela_info}\n\n*Ação sugerida:* {sug}")
            elif severity == "INFO":
                st.info(f"ℹ️ **{prob}**{data_info}{janela_info}\n\n*Ação sugerida:* {sug}")
            elif severity == "OK":
                st.success(f"💚 **{prob}**\n\n{sug}")
            else:
                st.caption(f"📌 **{prob}**{data_info}\n\n{sug}")
    else:
        st.success("Tudo parece em conformidade! Nenhuma sugestão necessária.")

    st.divider()

    # 4. Atualizador do Sistema por ZIP
    st.markdown("### 📦 Atualizar Sistema (Hot-Patch)")
    with st.expander("Instalar Atualização do Sistema (.zip)"):
        st.markdown(
            "Se você recebeu uma nova versão do sistema (V53, etc.) ou patch corretivo em formato `.zip`, "
            "envie o arquivo abaixo para atualizar a aplicação de forma automatizada e com backup de segurança."
        )
        uploaded = st.file_uploader("Selecione o arquivo update.zip", type=["zip"])
        if uploaded is not None:
            if st.button("Executar atualização do sistema", type="primary"):
                with st.spinner("Realizando backup e aplicando patch..."):
                    ok, msg = apply_update_zip(uploaded)
                    if ok:
                        st.success(msg)
                    else:
                        st.error(msg)

    st.divider()
    render_rules_summary_card()
