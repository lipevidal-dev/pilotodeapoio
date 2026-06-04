# Sistema de Escala PAO / APAO

Aplicação Streamlit para escala operacional de PAO, APAO e PAO FCF.

## Como abrir

```powershell
cd "C:\Users\xirin\OneDrive\Desktop\Escala Piloto de Apoio\Sistema_Escala_PAO_APAO_V4"
.\.venv\Scripts\activate
streamlit run app.py
```

Dados persistentes: `%USERPROFILE%\Sistema_Escala_PAO_APAO_Dados\escala.db`

## Fluxo mensal (ordem importa)

1. **Pré-alocações** — férias, simulador, folgas pedidas, restrições.
2. **Gerar Escala Automática** — turnos, blocos T8→T8→ND, cobertura APAO.
3. **Alocar Folgas e Voos** — mín. 10 folgas, folga social, VOO agrupado, meta de turnos.
4. **Escala Visual** — conferir grade, exportar PDF/Excel, auditor de regras.

Não pule o passo 2 antes do 3. O ND após dois T8 é criado na geração automática.

## Estrutura do código (não mexer à toa)

| Pasta | Função |
|-------|--------|
| `core/` | Regras e motor (`scheduler.py`, `rules.py`) |
| `database/` | SQLite e repositórios |
| `services/` | Orquestração e exportação |
| `ui/` | Telas Streamlit |
| `tests/` | Testes — rodar antes de entregar mudança |
| `_archive/` | Scripts antigos de experimento (ignorar) |

## Manter o sistema saudável

```powershell
.\scripts\testar.bat
```

Todos os testes devem passar. Se pedir mudança de regra ao Cursor/Antigravity, peça também para **atualizar ou criar teste** em `tests/test_rules.py`.

## Regras que não podem quebrar

- T8, T8, **ND** (terceiro dia após dois T8 consecutivos)
- Descanso mínimo **12h** entre turnos
- Máximo **6 dias** consecutivos de trabalho
- PAO: **10 folgas** e **20 turnos** produtivos (meta V52)
- **1 folga social** (fim de semana) por PAO/mês
- PAO regular: só turnos **T6, T7, T8**
