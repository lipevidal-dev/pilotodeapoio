# Regras extraídas da versão 1 — Escala Piloto de Apoio

Documento de migração profissional. Fonte: `pilotodeapoio` (V52, Streamlit + SQLite).  
**Não reimplementa** o sistema; consolida o que a v2 deve preservar, adaptar ou descartar.

---

## 1. Contexto da versão 1

| Item | Valor |
|------|--------|
| Versão operacional | V52 (changelog em `LEIA-ME.txt`) |
| UI | Streamlit monolítico (`app.py`, `ui/views/`) |
| Motor | `core/scheduler.py` (~3900 linhas) + `core/scheduler_v2.py` (pipeline unificado) |
| Regras | `core/rules.py` (~1830 linhas, 22 classes `*Rule`) |
| Persistência | SQLite em `%USERPROFILE%\Sistema_Escala_PAO_APAO_Dados\escala.db` |
| Testes de contrato | `tests/test_rules.py` + `scripts/testar.bat` |

### Fluxo documentado vs. fluxo real (V52)

| Passo | README / `.cursor/rules` | UI principal (V52) |
|-------|--------------------------|----------------------|
| 1 | Pré-alocações | Igual |
| 2 | Gerar escala automática | `ScheduleService.generate_unified_schedule()` |
| 3 | Alocar folgas e voos | **Incorporado** no motor v2 (`allocate_post_coverage_rests`) |
| 4 | Escala visual / export | Igual |

A v2 deve adotar **um único fluxo alvo** documentado, alinhado ao pipeline unificado.

---

## 2. Cargos e turnos

### 2.1 Cargos

| Cargo | Papel |
|-------|--------|
| **PAO** | Piloto de apoio — turnos T6, T7, T8; meta de folgas e produtividade |
| **APAO** | Apoio administrativo — turnos T1–T4 |
| **PAO FCF** | Variante com regras próprias (meta 10 folgas + 20 produtivos ajustados, concorrência 1/dia, lógica T9 residual) |

Schema: `employees.role` CHECK `('PAO','APAO','PAO FCF')` — `database/migrations.py`.

### 2.2 Turnos padrão (migração v3)

| Código | Cargo | Horário | Observação |
|--------|-------|---------|------------|
| T6 | PAO | 06:00–14:00 | Cobertura diurna |
| T7 | PAO | 14:00–22:00 | Cobertura vespertina |
| T8 | PAO | 22:00–06:00 | Virada de meia-noite; par T8/T8/ND |
| T1 | APAO | 00:00–06:00 | min/max staff = 1 |
| T2 | APAO | 06:00–12:00 | |
| T3 | APAO | 12:00–18:00 | |
| T4 | APAO | 18:00–00:00 | |

**T9:** removido do produto (LEIA-ME V6/V9), mas ainda ignorado no limite de 2 estações (`rules.py` ~130–131, 655–656) e em testes. **Decisão v2:** formalizar remoção ou documentar exceção só para PAO FCF.

### 2.3 Restrições por cargo

- **PAO regular:** apenas T6, T7, T8 (`PaoAllowedShiftsRule`, `can_work` em `scheduler.py`).
- **APAO:** T1–T4; **dois APAOs no mesmo turno/horário proibidos** (`ApaoCompanionRule`).
- **Turno fixo:** `employees.is_fixed_shift` + `fixed_shift_code` — piloto preso a um turno no mês.
- **Restrição mensal de turno:** tabela `shift_restrictions` → validação `TURNO BLOQUEADO` (`BlockedShiftRule`).
- **Fim de semana:** flag `shifts.no_fds` → `WeekendShiftRule`.

### 2.4 Capacidade PAO por turno/dia

- Normalmente **1 PAO** por turno (T6/T7/T8).
- Se faltar APAO no dia, pode subir para **2 PAO** no turno (`pao_shift_capacity_on_day`, `rules.py` ~305–310).
- **Pico global:** máximo **2 trabalhadores simultâneos** (estações), exceto T9 e PAO FCF (`SimultaneousStationsRule`, `max_simultaneous_workers_if_added`).

### 2.5 Cobertura diária obrigatória (PAO)

Cada dia do mês deve ter **≥1 PAO em T6, T7 e T8** (`daily_pao_coverage_matrix`, `spreadsheet_validator`, `coverage_gate`).

Pipeline v2 (`scheduler_v2.py` docstring):

1. Diagnóstico de capacidade  
2. Geração só de turnos (`shifts_only=True`)  
3. `enforce_full_coverage` até zero furos T6/T7/T8  
4. Folgas 10–11 (máx. 12) → VOO  
5. Auto-loop: `force_close_pao_coverage`, `enforce_t8_t8_nd_month`, `fill_schedule_blank_cells`

---

## 3. Regras de escala (núcleo inviolável)

Documentadas em `.cursor/rules/escala-pao.mdc`, `README.md` e código.

| # | Regra | Detalhe | Referência principal |
|---|--------|---------|----------------------|
| 1 | **T8, T8, ND** | Após 2 T8 consecutivos, o 3º dia é **ND** (não turno). Máx. 2 T8 seguidos. | `T8PairingRule`, `t8_planner.py`, `enforce_t8_t8_nd_month` |
| 2 | **12h entre turnos** | Inclui virada de meia-noite (ex.: T8). | `has_12h_rest`, `Rest12hRule` |
| 3 | **Máx. 6 dias consecutivos** | Conta continuidade do **mês anterior** (lookback no banco). | `ConsecutiveDaysRule`, `coverage_gate.enforce_month_start_6x1_from_previous` |
| 4 | **2 estações simultâneas** | Pico ≤2 (exceto T9, PAO FCF). | `SimultaneousStationsRule` |
| 5 | **ND só oficial** | ND via regra T8 ou reparo; **nunca** ND genérico para “preencher buraco”. | `.cursor/rules`; delete de ND-lacuna em `auto_allocate_rests` |
| 6 | **Nunca bypass `can_work`** | Exceto flags explícitas: `strict=False`, `allow_fortnight_override`, `coverage_emergency`. | `_pick_shift_candidate` em `scheduler.py` |

### 3.1 Rotação por blocos A/B/C (substitui “quinzena” fixa)

- PAOs divididos em grupos **A, B, C** por senioridade (`get_fortnight_group`, `month_day_blocks` em `scheduler.py`).
- Cada piloto trabalha **~2 blocos** do mês (~20 dias) e fica **off** em **1 bloco** (~10 dias).
- VOO e folgas preferencialmente no bloco off (`FortnightGroupRule`).
- Validação alerta desvio entre turnos/VOO e bloco esperado.

### 3.2 Pré-alocações protegidas

Não sobrescritas pelo gerador (`_is_protected_prealloc` em `scheduler.py`):

- FÉRIAS, FOLGA PEDIDA, DISPENSA MÉDICA, CURSO ONLINE, SIMULADOR, CMA

### 3.3 Delete do mês (`delete_month_schedule`)

- Remove `assignments` do mês.
- Em `allocations`: **preserva** FP, FÉRIAS, DM, CURSO, SIMULADOR, FA; **reverte** FS/FAG promovidas via `(Original: …)` em `notes`; **remove** FOLGA simples, VOO, ND gerados (`repositories.py` ~174–248).

### 3.4 Coluna do dia anterior

Grade visual inclui **último dia do mês anterior** (sem sigla “ANT”) para contexto de 6x1 e 12h (`exporter_pdf.build_visual_schedule_dataframe`).

---

## 4. Regras de PAO

| Regra | Valor | Onde |
|-------|-------|------|
| Folgas no mês | **Exatamente 10** na validação (`PaoOffLimitRule`) | Tipos: FOLGA, FP, FS, FAG, FA |
| Folgas no gerador | Mín. **10**, pref. **11**, máx. **12** se inevitável | `_enforce_rest_quota`, `scheduler_v2` |
| Meta produtiva | **20 − ND** turnos/dia produtivo | `employee_productive_target` |
| Produtivos contam | Turnos + VOO + CURSO + SIMULADOR + CMA | `employee_monthly_summary` |
| Folga social | **1** par sáb+dom completo → promove a **FOLGA SOCIAL** | `heal_pao_social_rules` |
| Monofolga | Alerta; auto PAO tenta máx. 1 monofolga | `MonofolgaRule`, `_fill_remaining_folgas_no_monofolga` |
| Folgas pedidas | Máx. **3**/mês (não PAO FCF) | `RequestedOffLimitRule` |
| T8 agrupado | Todo PAO ativo deve ter **≥1 bloco T8/T8/ND** no mês | `T8GroupingPresenceRule` |
| T8 solto | T8 **não** entra em alocação PAO “solta” — só motor T8 | `generate_auto_schedule` |

**PAO FCF (adicional):**

- Meta 10 folgas + 20 produtivos (ajustado por ND).
- **1 PAO FCF ativo por dia** (`PaoFcfConcurrencyRule`).
- Excluído de: 6 dias consecutivos padrão, blocos &lt;3 dias, disponibilidade APAO em alguns caminhos.

---

## 5. Regras de APAO

| Regra | Detalhe | Referência |
|-------|---------|------------|
| Duplicidade | Dois APAOs no mesmo turno/dia → violação | `ApaoCompanionRule` |
| Cobertura horária | Com APAO escalado, janela exige **≥1 PAO**; máx. **1 APAO** simultâneo | `coverage_dataframe` |
| Disponibilidade | ≥1 APAO **não** bloqueado por dia | `ApaoAvailabilityRule` |
| Indisponível em duplicidade | Máx. **1** APAO indisponível/dia (folga/bloqueio) | LEIA-ME V28–V34 + mesma regra |
| 6x1 | 6 dias trabalhados → folga obrigatória no 7º | `Apao6x1Rule`, `can_work` |
| Folga agrupada | Sáb+dom ou dom+seg com folgas → **FOLGA AGRUPADA** | `heal_apao_agroupada_rules` |
| Lacuna sem turno | Pode virar **VOO** | `_fill_role_blank_with_voo` |
| Score na geração | Peso menor que PAO (0.03 vs 0.1) | `employee_score` |

**Inconsistência conhecida (migrar com cuidado):**

- `apao_has_pao_companion()` existe em `rules.py` mas **não** é chamada em `can_work` do scheduler ativo.
- Cobertura horária ainda exige PAO quando há APAO — gerador e validador podem divergir.

---

## 6. Regras de folga

### 6.1 Tipos (`BLOCK_TYPES`)

Definidos em `core/rules.py` e `ui/styles.py`:

| Tipo | Sigla visual | Cor (hex) |
|------|--------------|-----------|
| FOLGA | F | `#ffcccc` |
| FOLGA PEDIDA | FP | `#ffcccc` |
| FOLGA SOCIAL | FS | `#c8f7c5` |
| FOLGA AGRUPADA | FAG | `#c8f7c5` |
| FOLGA ANIVERSÁRIO | FA | `#fbcfe8` |
| FÉRIAS | FER / L | `#cfe8ff` |

Legado: `FOLGA ESCOLHIDA` → migrado para `FOLGA PEDIDA` (migração v4).

### 6.2 Promoção automática (heal)

| Cargo | Gatilho | Resultado |
|-------|---------|-----------|
| PAO | Primeiro par sáb+dom com folgas no mês | `FOLGA SOCIAL` + `notes` com `(Original: …)` |
| APAO | Sáb+dom ou dom+seg com folgas | `FOLGA AGRUPADA` |

Reversão via `extract_original_type(notes)` no delete do mês.

### 6.3 6x1 geral

- Folga obrigatória após 6 dias trabalhados (PAO e APAO).
- `_enforce_mandatory_6x1_rests` no motor.
- Validação APAO no 7º dia: `Apao6x1Rule`.

### 6.4 Monofolga

- Folga isolada de 1 dia entre trabalhos → alerta `MonofolgaRule` (recomendação/ALTA conforme contexto).

---

## 7. Regras de férias

| Regra | Detalhe |
|-------|---------|
| Tipos aceitos | `FÉRIAS`, `FERIAS`, `FER`, etc. (`VACATION_TYPES`) |
| Efeito | Funcionário **fora do planejamento** no período |
| Mês inteiro em férias | `is_employee_planning_active_month` = false → meta produtiva **0** |
| Pré-alocação UI | 1ª quinzena, 2ª quinzena ou mês inteiro (`pre_allocations.py`) |
| Geração | `can_work` retorna falso; não aloca turno/folga automática em dias de férias |
| Por dia | `vacation_employee_ids_by_day` para diagnóstico de capacidade |

---

## 8. Regras de voo

| Regra | Detalhe |
|-------|---------|
| Natureza | **Produtivo** (conta na meta PAO/FCF) |
| Onde alocar | Preferência no **bloco off** (~10 dias); preenchimento de lacunas |
| Restrições cadastro | `no_flight`, `no_flight_start/end`, `no_flight_indefinite` → `employee_can_receive_flight` |
| PAO em bloco de turno | Não recebe VOO no bloco de trabalho de turnos |
| Proteção | VOO em pré-alocação manual é protegido; VOO gerado é removido no delete mês |

Sigla visual: **V** — cor `#ffd8a8`.

---

## 9. Regras de simulador

| Regra | Detalhe |
|-------|---------|
| Tipo | `SIMULADOR` — produtivo |
| Bloqueio | Impede turno no mesmo dia (`BlockedDayWorkRule`) |
| Pré-alocação | Protegida no delete mês |
| PAO FCF | Pode coexistir com regras de concorrência FCF |
| Sigla | **S** — cor `#d9d9d9` |

---

## 10. Regras de curso

| Tipo | Sigla | Cor |
|------|-------|-----|
| CURSO ONLINE | C ou K | `#fff3b0` |
| CMA | CMA ou EP | `#ddd6fe` |

Ambos são **produtivos**, bloqueiam escala no dia, pré-alocações protegidas (CURSO/SIMULADOR/CMA conforme tipo).

---

## 11. Regras de cores e layout visual

### 11.1 Paleta de células da grade

Fonte: `ui/styles.py` → `VISUAL_COLORS`; espelhado em `services/exporter_pdf.get_visual_cell_color`.

| Atividade | Hex |
|-----------|-----|
| FOLGA / FP | `#ffcccc` |
| FS / FAG | `#c8f7c5` |
| FÉRIAS | `#cfe8ff` |
| VOO | `#ffd8a8` |
| SIMULADOR | `#d9d9d9` |
| CURSO ONLINE | `#fff3b0` |
| CMA | `#ddd6fe` |
| ND | `#e5e7eb` |
| DISPENSA MÉDICA | `#e9d5ff` |
| FOLGA ANIVERSÁRIO | `#fbcfe8` |

### 11.2 UI global (V51/V52)

| Token | Valor |
|-------|--------|
| Laranja primário | `#ff7900` |
| Fundo suave | `#fff4e8`, `#fffaf5` |
| Bordas | `#ffd1a3`, `#ffe0bd` |
| Cabeçalho PDF | `#0f172a` |

Funções: `inject_visual_polish_v51()`, `inject_v52_ui_fixes()`, `v51_panel()`.

### 11.3 Layout da escala operacional

- Título: **“ESCALA DE REVEZAMENTO MÊS XX/YYYY”** (LEIA-ME V13).
- **PAO e APAO em tabelas separadas** (por cargo).
- Colunas: dia do mês (+ dia anterior).
- Linhas: senioridade, nome, células com siglas.
- Métricas de status (`ui/components.py`): verde = 10 folgas + meta produtivos; amarelo = intermediário; vermelho = crítico.

### 11.4 Mapeamento sigla ↔ ação

`ScheduleService.visual_code_to_action` (`schedule_service.py` ~199–233) e `exporter_pdf` `code_map` — devem permanecer **idênticos** na v2 para paridade com planilha Excel.

---

## 12. Validação modular (contrato de domínio)

`validate_rules()` executa 22 regras (`rules.py` ~1405+):

1. ShiftCapacityRule  
2. DuplicityRule  
3. Rest12hRule  
4. SimultaneousStationsRule  
5. BlockedShiftRule  
6. ApaoCompanionRule  
7. BlockedDayWorkRule  
8. T8PairingRule  
9. ConsecutiveDaysRule  
10. WeekendShiftRule  
11. ApaoAvailabilityRule  
12. WorkBlockLengthRule (blocos &lt;3 dias — recomendação)  
13. Apao6x1Rule  
14. PaoFcfMetaRule  
15. RequestedOffLimitRule  
16. PaoOffLimitRule  
17. SocialOffPresenceRule  
18. MonofolgaRule  
19. PaoFcfConcurrencyRule  
20. PaoAllowedShiftsRule  
21. T8GroupingPresenceRule  
22. FortnightGroupRule  

Gravidades: **BAIXA**, **MÉDIA**, **ALTA**, **CRÍTICA**.

---

## 13. Funções úteis para reaproveitar na v2

Prioridade **alta** — lógica estável e coberta por testes:

| Módulo | Funções / classes |
|--------|-------------------|
| `core/rules.py` | `has_12h_rest`, `shift_start_end_datetimes`, `build_shift_time_map`, `month_range`, `iter_days`, `employee_productive_target`, `VACATION_TYPES`, todas as `*Rule`, `coverage_dataframe`, `validate_rules` |
| `core/models.py` | `Employee`, `Shift` (+ `to_dict` legado) |
| `core/t8_planner.py` | Planejamento T8/T8/ND |
| `core/coverage_gate.py` | Gate 100% + folgas pós-cobertura + carryover 6x1 |
| `core/spreadsheet_validator.py` | Paridade planilha Excel |
| `database/migrations.py` | Schema versionado |
| `database/repositories.py` | CRUD, batch, `heal_*`, `delete_month_schedule` |
| `services/schedule_service.py` | `visual_code_to_action`, reparo interativo |
| `services/exporter_pdf.py` | Grade + cores |
| `tests/test_rules.py` | Suite de regressão — **rodar na migração** |

Motor (extrair para serviço sem Streamlit):

- `can_work`, `employee_score`, `generate_auto_schedule`, `generate_unified_schedule`, `enforce_t8_t8_nd_month`, `get_fortnight_group`, `employee_can_receive_flight`.

---

## 14. Partes bagunçadas — descartar ou não portar

| Item | Motivo |
|------|--------|
| `_archive/scratch/*` (~30 scripts) | Diagnósticos one-off (jun/2026, FCF, gaps) |
| `_archive/extracted_scheduler.py` | Snapshot antigo; regras APAO diferentes |
| Menus removidos (Validação, Banco, Import/Export, Escala Manual) | Só histórico no LEIA-ME |
| Caminhos hardcoded no README (`xirin\OneDrive\...`) | Desatualizado |
| Duplicação `scheduler.py` + `scheduler_v2.py` + múltiplos “fechar cobertura” | Unificar em um motor na v2 |
| `st.cache_data` no repositório | Impede API headless |
| Notas `(Original: tipo)` em allocations | Frágil; substituir por modelo explícito (ex.: `promoted_from`) |
| Relaxamentos múltiplos em `can_work` sem auditoria | Risco de violar regras “invioláveis” |
| T9 como turno fantasma | Alinhar com produto ou remover de testes |

---

## 15. Riscos técnicos da versão 1

| # | Risco | Impacto na migração |
|---|--------|---------------------|
| 1 | **Dupla verdade** assignments vs allocations | Toda edição deve sincronizar + heal |
| 2 | **Folgas 10 vs 11–12** | Validador vs gerador — unificar política na v2 |
| 3 | **Monólito scheduler.py** | Difícil manter; extrair domínio puro |
| 4 | **APAO sem companion no alocador** | Buracos ou violações só na validação tardia |
| 5 | **Continuidade intermensal** | Lookback 5+ dias; coluna dia anterior obrigatória |
| 6 | **Promoção FS/FAG** | Delete/restore complexo |
| 7 | **Streamlit + SQLite no perfil do usuário** | Deploy multiusuário precisa path configurável (`set_db_path` nos testes) |
| 8 | **PAO FCF + T9** | Regras especiais pouco documentadas para operação |
| 9 | **Testes em arquivo `test_escala.db`** | Flakiness em CI paralelo |
| 10 | **Bypass `can_work` em emergência de cobertura** | Documentar e limitar na v2 |

---

## 16. Schema SQLite (referência de migração de dados)

Ver `database/migrations.py` (versões 1–5).

**Tabelas:** `employees`, `shifts`, `assignments`, `allocations`, `shift_restrictions`, `schema_version`.

**Índices (v5):** `assignments(work_date, employee_id)`, `allocations(alloc_date, employee_id)`.

**Backups:** pasta `backups\` junto ao DB, automático antes de ações críticas (`backup_db`).

---

## 17. Checklist de paridade v1 → v2

- [ ] Fluxo único: pré-alocações → geração → visual/export → auditoria  
- [ ] 22 regras de validação com mesmas gravidades  
- [ ] Siglas e cores idênticas à planilha operacional  
- [ ] T8/T8/ND + ND na meta 20  
- [ ] Heal FS/FAG ou regra declarativa equivalente  
- [ ] Delete mês com mesma semântica de preservação  
- [ ] `pytest tests/test_rules.py` verde (portar testes para API v2)  
- [ ] Script de migração `escala.db` v1 → schema v2  
- [ ] Decisão explícita: folgas 10 fixas vs 10–12  
- [ ] Decisão explícita: APAO sempre exige PAO na alocação  

---

## 18. Referência rápida de arquivos v1

| Assunto | Arquivo |
|---------|---------|
| Regras invioláveis (Cursor) | `.cursor/rules/escala-pao.mdc` |
| Regras + validação | `core/rules.py` |
| Motor legado | `core/scheduler.py` |
| Motor unificado | `core/scheduler_v2.py` |
| T8 | `core/t8_planner.py` |
| Cobertura | `core/coverage_gate.py` |
| Planilha | `core/spreadsheet_validator.py` |
| Modelos | `core/models.py` |
| Banco | `database/migrations.py`, `repositories.py` |
| Orquestração | `services/schedule_service.py` |
| Visual/PDF | `ui/styles.py`, `services/exporter_pdf.py` |
| Testes | `tests/test_rules.py` |

---

*Documento gerado na fase 0 da v2. Atualizar quando decisões em `decisoes-tecnicas.md` forem fechadas.*
