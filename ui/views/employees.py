import streamlit as st
import pandas as pd
from datetime import date
from database.repositories import (
    employees_df,
    shifts_df,
    add_employee,
    delete_employee,
    update_employee,
    add_shift_restriction,
    shift_restrictions_df,
    get_next_seniority
)
from ui.components import toggle_dataframe

def render_employees_view(year, month):
    """Renderiza a visualização de Funcionários e Senioridade."""
    st.subheader("👥 Funcionários e Senioridade")

    # Inicializa o gerador de chaves para o formulário de cadastro, se não existir
    if "cad_form_generation" not in st.session_state:
        st.session_state.cad_form_generation = 0

    # Callback para cadastrar o funcionário e limpar o formulário com segurança
    def callback_cadastrar_func():
        gen = st.session_state.get("cad_form_generation", 0)
        name = st.session_state.get(f"cad_nome_v26_{gen}", "").strip()
        if not name:
            st.session_state.cad_error_v26 = "Informe o nome."
            st.session_state.cad_success_v26 = ""
            return
            
        role = st.session_state.get(f"cad_role_v26_{gen}", "PAO")
        seniority = st.session_state.get(f"cad_sen_v26_{gen}", 1)
        is_fixed = st.session_state.get(f"cad_fixed_v26_{gen}", False)
        fixed_shift = st.session_state.get(f"cad_fixed_shift_v26_{gen}", "")
        no_flight = st.session_state.get(f"cad_no_flight_v26_{gen}", False)
        no_flight_indef = st.session_state.get(f"cad_no_flight_indef_v26_{gen}", False)
        no_flight_start = st.session_state.get(f"cad_no_flight_start_v26_{gen}", date.today())
        no_flight_end = st.session_state.get(f"cad_no_flight_end_v26_{gen}", date.today())
        notes = st.session_state.get(f"cad_notes_v26_{gen}", "")
        
        # database logic
        add_employee(name, role, seniority, fixed_shift or None, int(is_fixed), notes)
        new_emp = employees_df(role)
        created = new_emp[new_emp["nome"] == name.upper()]
        if not created.empty:
            update_employee(
                int(created.iloc[0]["id"]),
                name,
                role,
                seniority,
                fixed_shift or None,
                int(is_fixed),
                int(no_flight),
                no_flight_start if no_flight else None,
                no_flight_end if no_flight and not no_flight_indef else None,
                int(no_flight_indef),
                notes
            )
        
        # Incrementa o contador de geração do formulário para rotacionar as chaves dos widgets.
        # Isso faz com que todos os campos de texto/seleção voltem a seu estado padrão de forma limpa e nativa!
        st.session_state.cad_form_generation = gen + 1
        
        st.session_state.cad_success_v26 = "Funcionário cadastrado."
        st.session_state.cad_error_v26 = ""

    tab_cad, tab_edit, tab_del, tab_lista = st.tabs(["➕ Cadastrar", "✏️ Editar", "🗑️ Excluir", "👁️ Registros"])

    with tab_cad:
        # Exibe mensagens de feedback se existirem
        if st.session_state.get("cad_error_v26"):
            st.error(st.session_state.cad_error_v26)
            st.session_state.cad_error_v26 = ""
        if st.session_state.get("cad_success_v26"):
            st.success(st.session_state.cad_success_v26)
            st.session_state.cad_success_v26 = ""

        # Obtém o contador de geração atual
        gen = st.session_state.cad_form_generation

        col1, col2, col3 = st.columns(3)
        name = col1.text_input("Nome", key=f"cad_nome_v26_{gen}")
        role = col2.selectbox("Cargo", ["PAO", "APAO", "PAO FCF"], key=f"cad_role_v26_{gen}")
        
        # Pega a senioridade atual do cargo selecionado na geração atual
        current_role = st.session_state.get(f"cad_role_v26_{gen}", "PAO")
        default_sen = get_next_seniority(current_role)
        seniority = col3.number_input("Senioridade", min_value=1, value=default_sen, step=1, key=f"cad_sen_v26_{gen}")
        
        try:
            shift_options = [""] + shifts_df(current_role)["codigo"].tolist()
        except Exception:
            shift_options = [""]

        col4, col5 = st.columns(2)
        is_fixed = col4.checkbox("Funcionário específico/fixo em turno", key=f"cad_fixed_v26_{gen}")
        fixed_shift = col5.selectbox("Turno fixo", shift_options, key=f"cad_fixed_shift_v26_{gen}")

        st.markdown("#### Restrição de voo")
        colv1, colv2, colv3, colv4 = st.columns(4)
        no_flight = colv1.checkbox("Não alocar voos", key=f"cad_no_flight_v26_{gen}")
        no_flight_indef = colv2.checkbox("Indeterminado", key=f"cad_no_flight_indef_v26_{gen}")
        no_flight_start = colv3.date_input("Início restrição voo", value=date.today(), key=f"cad_no_flight_start_v26_{gen}")
        no_flight_end = colv4.date_input("Fim restrição voo", value=date.today(), key=f"cad_no_flight_end_v26_{gen}")

        notes = st.text_area("Observações", key=f"cad_notes_v26_{gen}")

        st.button("Cadastrar funcionário", key="btn_cad_func_v26", on_click=callback_cadastrar_func)

    df = employees_df()

    with tab_edit:
        if df.empty:
            st.info("Nenhum funcionário cadastrado.")
        else:
            # Inicializa a variável de controle do funcionário anterior
            if "edit_employee_prev" not in st.session_state:
                st.session_state.edit_employee_prev = None

            edit_label = st.selectbox(
                "Selecione funcionário para editar",
                df.apply(lambda r: f"{r['id']} | {r['cargo']} {r['senioridade']} | {r['nome']}", axis=1).tolist(),
                key="edit_employee_select_v26"
            )
            edit_id = int(edit_label.split(" | ")[0])
            current = df[df["id"] == edit_id].iloc[0]

            # Se o funcionário selecionado mudou (ou é a primeira vez), ou se as variáveis do widget foram limpas pelo Streamlit, forçamos a carga dos valores no session_state
            if (st.session_state.edit_employee_prev != edit_id or 
                "edit_name" not in st.session_state or 
                "edit_role" not in st.session_state or 
                "edit_sen" not in st.session_state):
                st.session_state.edit_employee_prev = edit_id
                st.session_state.edit_name = current["nome"]
                st.session_state.edit_role = current["cargo"]
                st.session_state.edit_sen = int(current["senioridade"])
                st.session_state.edit_fixed = bool(current["fixo"])
                st.session_state.edit_shift = current["turno_fixo"] if pd.notna(current["turno_fixo"]) else ""
                st.session_state.edit_no_flight = bool(current.get("sem_voo", 0))
                st.session_state.edit_no_flight_indef = bool(current.get("sem_voo_indeterminado", 0))
                st.session_state.edit_start = pd.to_datetime(current["sem_voo_inicio"]).date() if pd.notna(current.get("sem_voo_inicio")) else date.today()
                st.session_state.edit_end = pd.to_datetime(current["sem_voo_fim"]).date() if pd.notna(current.get("sem_voo_fim")) else date.today()
                st.session_state.edit_notes = current["observacao"] if pd.notna(current["observacao"]) else ""
                st.rerun()

            st.info(f"Editando: {st.session_state.edit_name} | {st.session_state.edit_role} | Senioridade {st.session_state.edit_sen}")

            col1, col2, col3 = st.columns(3)
            # Usamos o session_state como chave direta dos widgets
            edit_name = col1.text_input("Nome", key="edit_name")
            edit_role = col2.selectbox("Cargo", ["PAO", "APAO", "PAO FCF"], key="edit_role")
            edit_sen = col3.number_input("Senioridade", min_value=1, step=1, key="edit_sen")

            try:
                edit_shift_options = [""] + shifts_df(edit_role)["codigo"].tolist()
            except Exception:
                edit_shift_options = [""]

            col4, col5 = st.columns(2)
            edit_fixed = col4.checkbox("Funcionário específico/fixo em turno", key="edit_fixed")
            
            # Se o turno fixo atual não estiver nas opções do cargo recém-selecionado, resetamos
            current_fixed_shift = st.session_state.get("edit_shift", "")
            if current_fixed_shift not in edit_shift_options:
                current_fixed_shift = ""
                st.session_state.edit_shift = ""

            edit_shift = col5.selectbox(
                "Turno fixo",
                edit_shift_options,
                key="edit_shift"
            )

            st.markdown("#### Restrição de voo")
            colv1, colv2, colv3, colv4 = st.columns(4)
            edit_no_flight = colv1.checkbox("Não alocar voos", key="edit_no_flight")
            edit_no_flight_indef = colv2.checkbox("Indeterminado", key="edit_no_flight_indef")
            edit_start = colv3.date_input("Início", key="edit_start")
            edit_end = colv4.date_input("Fim", key="edit_end")

            edit_notes = st.text_area("Observações", key="edit_notes")

            if st.button("Salvar edição", key="save_employee_btn"):
                update_employee(
                    edit_id,
                    edit_name,
                    edit_role,
                    edit_sen,
                    edit_shift or None,
                    int(edit_fixed),
                    int(edit_no_flight),
                    edit_start if edit_no_flight else None,
                    edit_end if edit_no_flight and not edit_no_flight_indef else None,
                    int(edit_no_flight_indef),
                    edit_notes
                )
                st.success("Cadastro atualizado.")
                # Forçamos a limpeza do estado prev para recarregar do banco no próximo loop
                st.session_state.edit_employee_prev = None
                st.rerun()

            st.markdown("#### Não alocar em determinado turno")
            try:
                restr_shift_options = shifts_df(edit_role)["codigo"].tolist()
            except Exception:
                restr_shift_options = []
                
            if restr_shift_options:
                colr1, colr2 = st.columns(2)
                restr_shift = colr1.selectbox("Turno bloqueado", restr_shift_options, key="emp_restr_shift")
                restr_note = colr2.text_input("Observação", value="Restrição cadastrada no funcionário", key="emp_restr_note")
                if st.button("Adicionar restrição de turno para competência atual", key="emp_add_restr_btn"):
                    add_shift_restriction(edit_id, int(year), int(month), restr_shift, restr_note)
                    st.success(f"Restrição adicionada para {restr_shift} em {month:02d}/{year}.")
                    st.rerun()

    with tab_del:
        if df.empty:
            st.info("Nenhum funcionário cadastrado.")
        else:
            selected = st.selectbox(
                "Selecione funcionário para excluir",
                df.apply(lambda r: f"{r['id']} | {r['cargo']} {r['senioridade']} | {r['nome']}", axis=1).tolist(),
                key="delete_employee_select_v26"
            )
            if st.button("Excluir funcionário e reorganizar senioridade", key="delete_employee_btn_v26"):
                emp_id = int(selected.split(" | ")[0])
                delete_employee(emp_id)
                st.success("Funcionário excluído. A senioridade dos demais foi reorganizada.")
                st.rerun()

    with tab_lista:
        toggle_dataframe("tabela de funcionários", df, "tbl_funcionarios_v26", default=True)
