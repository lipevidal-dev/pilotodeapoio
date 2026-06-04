import streamlit as st
from database.repositories import shifts_df
from services.shift_service import ShiftService

def render_shifts_view(year, month):
    """Renderiza a visualização de turnos."""
    st.subheader("🕒 Turnos de Trabalho")
    st.info("Turnos padrão recomendados: PAO T8/T6/T7 e APAO T1/T2/T3/T4.")

    with st.expander("Adicionar ou atualizar turno", expanded=True):
        col1, col2, col3 = st.columns(3)
        code = col1.text_input("Código do turno", placeholder="Ex: T10", key="shift_code_add")
        role = col2.selectbox("Cargo do turno", ["PAO", "APAO", "PAO FCF"], key="shift_role_add")
        name = col3.text_input("Nome", placeholder="Ex: Turno especial", key="shift_name_add")
        
        col4, col5, col6, col7 = st.columns(4)
        start = col4.text_input("Início", value="08:00", key="shift_start_add")
        end = col5.text_input("Fim", value="16:00", key="shift_end_add")
        min_staff = col6.number_input("Mínimo de funcionários", min_value=0, value=1, key="shift_min_add")
        max_staff = col7.number_input("Máximo de funcionários", min_value=1, value=1, key="shift_max_add")
        
        no_fds = st.checkbox("Não alocar em fins de semana (Sábado/Domingo)", value=False, key="shift_no_fds_add")
        
        if st.button("Salvar turno", key="btn_save_shift"):
            success, msg = ShiftService.create_shift(
                code=code,
                role=role,
                name=name,
                start_time=start,
                end_time=end,
                min_staff=min_staff,
                max_staff=max_staff,
                no_fds=no_fds
            )
            if success:
                st.success(msg)
                st.rerun()
            else:
                st.error(msg)

    df = shifts_df()
    
    st.markdown("---")
    st.markdown("### 📋 Tabela de Turnos Cadastrados")
    st.markdown("Você pode editar os atributos dos turnos diretamente na tabela abaixo. O código do turno e cargo/ativo não podem ser alterados diretamente para garantir a integridade estrutural, mas o cargo pode ser selecionado em novos registros.")
    
    if not df.empty:
        # Render st.data_editor para edição inline premium
        edited_df = st.data_editor(
            df,
            key="shifts_editor_v52",
            disabled=["codigo", "ativo", "id"],
            column_config={
                "id": None,  # Oculta coluna ID
                "ativo": None,  # Oculta coluna Ativo
                "codigo": st.column_config.TextColumn("Código (Fixo)", disabled=True),
                "cargo": st.column_config.SelectboxColumn("Cargo", options=["PAO", "APAO", "PAO FCF"], required=True),
                "nome": st.column_config.TextColumn("Nome", required=True),
                "inicio": st.column_config.TextColumn("Início (hh:mm)", required=True),
                "fim": st.column_config.TextColumn("Fim (hh:mm)", required=True),
                "minimo": st.column_config.NumberColumn("Mín. Staff", min_value=0, step=1, required=True),
                "maximo": st.column_config.NumberColumn("Máx. Staff", min_value=1, step=1, required=True),
                "no_fds": st.column_config.CheckboxColumn("Não FDS"),
            },
            use_container_width=True,
            hide_index=True,
        )
        
        # Verifica alterações na session state do Streamlit
        has_changes = False
        if "shifts_editor_v52" in st.session_state:
            edits = st.session_state["shifts_editor_v52"].get("edited_rows", {})
            if edits:
                has_changes = True
                
        if has_changes:
            st.warning("⚠️ Você possui alterações não salvas na tabela de turnos.")
            if st.button("💾 Salvar Alterações da Tabela", key="btn_save_shift_edits"):
                edits = st.session_state["shifts_editor_v52"]["edited_rows"]
                success_count = 0
                for row_idx_str, row_changes in edits.items():
                    row_idx = int(row_idx_str)
                    original_row = df.iloc[row_idx]
                    
                    code = original_row["codigo"]
                    role = row_changes.get("cargo", original_row["cargo"])
                    name = row_changes.get("nome", original_row["nome"])
                    start_time = row_changes.get("inicio", original_row["inicio"])
                    end_time = row_changes.get("fim", original_row["fim"])
                    min_staff = row_changes.get("minimo", original_row["minimo"])
                    max_staff = row_changes.get("maximo", original_row["maximo"])
                    no_fds = row_changes.get("no_fds", original_row["no_fds"])
                    
                    success, msg = ShiftService.update_shift(
                        code=code,
                        role=role,
                        name=name,
                        start_time=start_time,
                        end_time=end_time,
                        min_staff=min_staff,
                        max_staff=max_staff,
                        no_fds=no_fds
                    )
                    if success:
                        success_count += 1
                    else:
                        st.error(f"Erro ao atualizar turno {code}: {msg}")
                
                if success_count > 0:
                    st.success(f"🎉 {success_count} turno(s) atualizado(s) com sucesso!")
                    st.rerun()
                
        st.markdown("#### Excluir Turno")
        selected = st.selectbox("Turno para excluir", df["codigo"].tolist(), key="shift_to_delete")
        if st.button("Excluir turno", key="btn_delete_shift"):
            success, msg = ShiftService.delete_shift(selected)
            if success:
                st.success(msg)
                st.rerun()
            else:
                st.error(msg)
