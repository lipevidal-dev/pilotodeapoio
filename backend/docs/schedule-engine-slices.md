# Motor de Escala — Fatias (Fase 6.1A)

Documentação de diagnóstico do motor de escala em camadas testáveis.  
**Nenhuma alteração funcional** — apenas testes e este documento.

## Pipeline de execução

```
GenerateScheduleUseCase
  → buildGenerationInput()
  → ScheduleGenerationEngine.generate()
      → GenerationWorkspace
          1. applyHardBlocks()
          2. preallocatePaoFolgasBeforeCoverage()
          3. planFolgaSocial()
          4. planT8CoverageRotating()
          5. coverT6T7Only() / coverT8BlocksOnly()
          6. assignApaoWithPao() / allocateApaoRestDays()
          7. allocatePaoRestDaysAfterCoverage() / ensureExactTenFolgasPerPao()
          8. finalizePaoFolgaCounts() / fillUnclassifiedPaoDays()
          9. ScheduleRepairEngine.repair() (até 40 rodadas)
          10. completePaoAgenda() / completeApaoAgenda() / enforceApaoSixByOne()
      → validateSchedule() + runFinalCoverageGate()
  → persistência (clearForRegeneration + assignments)
```

## Estrutura de testes

| Fatia | Arquivo | Testes | Foco |
|-------|---------|--------|------|
| 1 — GenerationInput | `schedule-slice-input.test.ts` | 7 | Montagem de input, cross-month, restrições |
| 2 — Hard Blocks | `schedule-slice-hard-blocks.test.ts` | 9 | Férias, FP, VOO, SIM/CURSO/CMA/OUTRO |
| 3 — Eligibility | `schedule-slice-eligibility.test.ts` | 7 | canWork, 12h, restrições, 2 simultâneos, APAO |
| 4 — T8 | `schedule-slice-t8.test.ts` | 7 | Bloco T8/T8/ND, isolado, bloqueios, cobertura |
| 5 — Coverage | `schedule-slice-coverage.test.ts` | 8 | T6/T7/T8, gaps, cenário normal vs crítico |
| 6 — APAO | `schedule-slice-apao.test.ts` | 9 | APAO+PAO, 6x1, FA, sem T8, agenda completa |
| 7 — Folgas PAO | `schedule-slice-pao-off.test.ts` | 8 | Quota 10–11, FS, mono-folga, bloqueios |
| 8 — Repair | `schedule-slice-repair.test.ts` | 7 | T6/T7/T8, bloqueios, limite 40 rodadas |
| 9 — Validação | `schedule-slice-validation.test.ts` | 9 | CRITICAL/WARNING, gate, cross-month, dedup |
| 10 — Regeneração | `schedule-slice-regeneration.test.ts` | 8 | Labels limpos vs protegidos |

**Helpers:** `slice-helpers.ts` — fixtures, UUIDs, validação de workspace.

**Total fatias 6.1A:** 79 testes em 10 arquivos (+ helpers).

## Cobertura por fatia

### Fatia 1 — GenerationInput
- [x] Input completo com todos os cadastros operacionais
- [x] Input vazio / parcial
- [x] Mês sem funcionários
- [x] `crossMonthHistory` → `previousMonthAssignments`
- [x] `buildShiftRestrictionMap`
- [x] Ordenação por senioridade em `buildGenerationInput`
- [ ] Integração E2E `GenerateScheduleUseCase` + repositórios (coberto em `generate-schedule-operational.test.ts`)

### Fatia 2 — Hard Blocks
- [x] Férias, FP, VOO
- [x] SIMULADOR, CURSO→CURSO ONLINE, CMA, OUTRO
- [x] Múltiplos bloqueios simultâneos
- [x] Classificação `isOperationalHardBlock`
- [ ] FANI automático + folga pós-aniversário (coberto em `fani.test.ts`)

### Fatia 3 — Eligibility
- [x] Descanso 12h
- [x] Shift restrictions
- [x] Limite 2 simultâneos
- [x] APAO sem/com PAO
- [x] ND bloqueia turno
- [ ] Funcionário inativo explicitamente (pendente — campo existe no domínio mas não há fixture de slice)

### Fatia 4 — T8
- [x] T8 somente PAO
- [x] Bloco T8→T8→ND
- [x] Detecção T8 isolado
- [x] `repairIsolatedT8`
- [x] T8 com férias bloqueado
- [x] Rotação + cobertura sem T8 isolado crítico
- [ ] Cross-month ND no último dia do mês (coberto em `cross-month-continuity.test.ts`)

### Fatia 5 — Coverage
- [x] `coverT6T7Only`, `coverT8BlocksOnly`
- [x] Máximo 2 PAOs por turno/dia
- [x] Gaps T6 via `listPaoCoverageGaps`
- [x] Cenário crítico (1 PAO) com gaps
- [x] Cenário normal (6 PAO) zera gaps
- [x] Bloqueio massivo reduz cobertura

### Fatia 6 — APAO
- [x] APAO SEM PAO (regra)
- [x] Não atribui sem T6 coberto
- [x] Atribui com cobertura PAO
- [x] Dois APAOs sem PAO (companion gap)
- [x] `enforceApaoSixByOne`
- [x] FOLGA AGRUPADA possível
- [x] APAO não recebe T8
- [x] Motor realista sem APAO SEM PAO crítico
- [x] `completeApaoAgenda`

### Fatia 7 — Folgas PAO
- [x] 10 folgas por PAO (motor completo)
- [x] `ensureExactTenFolgasPerPao`
- [x] `planFolgaSocial`
- [x] `PaoOffLimitRule` detecta déficit
- [x] Folgas vs bloqueios
- [x] Mono-folga (WARNING)
- [x] SocialOff (INFO)
- [x] Teto 11 folgas

### Fatia 8 — Repair
- [x] Reparo T6, T7, T8
- [x] Bloqueios impedem reparo
- [x] Limite 40 rodadas / tempo finito
- [x] Não sobrescreve VOO
- [x] Sugestões em gaps remanescentes

### Fatia 9 — Validação Final
- [x] DEFAULT_RULES cobre cobertura/descanso/APAO/T8
- [x] Níveis CRITICAL/WARNING/INFO
- [x] Coverage gate T6
- [x] Cross-month 12h
- [x] Deduplicação no motor
- [x] T8 SEM ND crítico
- [x] Descanso adequado pós-T8 passa

### Fatia 10 — Regeneração
- [x] `REGENERATION_CLEAR_LABELS` (FOLGA, FS, FA, ND, VOO, FÉRIAS, FP)
- [x] `MANUAL_PREALLOC_LABELS` protegidos
- [x] `CLEAR_GENERATED_LABELS` ⊆ regeneração
- [ ] Persistência real `clearForRegeneration` no repositório (coberto em testes de use case)

## Falhas conhecidas (registro para Fase 6.1B)

Nenhum teste de fatia falhou na execução da 6.1A. Os itens abaixo são **riscos/limitações observados** em cenários difíceis (Fase 5.3) e áreas com cobertura parcial — candidatos a testes de regressão na 6.1B.

| ID | Classificação | Fatia | Descrição | Teste de referência |
|----|---------------|-------|-----------|---------------------|
| KF-01 | HIGH | 5 — Coverage | Equipe mínima (1 PAO) produz gaps de cobertura inevitáveis; motor sinaliza `impossibleScenario` ou CRITICAL de cobertura | `schedule-slice-coverage` + `schedule-hard-scenarios` |
| KF-02 | HIGH | 5 — Coverage | Duas férias PAO sobrepostas podem tornar o mês impossível; comportamento depende de disponibilidade remanescente | `schedule-hard-scenarios` cenário 2 |
| KF-03 | MEDIUM | 7 — Folgas | Mono-folga (folga isolada sem par) pode aparecer como WARNING em meses com muitos bloqueios | `schedule-slice-pao-off` |
| KF-04 | MEDIUM | 3 — Eligibility | Funcionário inativo não possui teste de slice dedicado; comportamento não auditado isoladamente | Pendente 6.1B |
| KF-05 | MEDIUM | 1 — Input | Pipeline completo use case→DB não está duplicado nas fatias (delegado a testes de integração) | `generate-schedule-operational.test.ts` |
| KF-06 | LOW | 9 — Validação | Cenários realistas podem gerar WARNING/INFO (ex.: FS ausente) sem impedir `valid=true` | `schedule-slice-validation` |

## Priorização para Fase 6.1B

1. **KF-01 / KF-02** — Cenários impossíveis: mensagens, `impossibleScenario` e sugestões consistentes.
2. **KF-04** — Elegibilidade de funcionário inativo.
3. **KF-03** — Mono-folga em meses com alta ocupação de bloqueios.
4. **KF-05** — Teste de slice do use case com mocks mínimos (sem alterar repositório).
5. **KF-06** — Revisão de severidade INFO vs WARNING em folga social.

## Como executar

```bash
# Somente fatias 6.1A
npm test -- src/tests/schedule-slices

# Suíte completa
npm test
npm run typecheck
npm run build
```

## Princípio de correção

```
1. Criar teste que demonstra a falha
2. Executar e registrar resultado
3. Corrigir somente na Fase 6.1B
```

Testes legados relacionados: `motor-structural.test.ts`, `motor-phase-6-1-fixes.test.ts`, `schedule-hard-scenarios.test.ts`, `complete-pao-agenda.test.ts`, `cross-month-continuity.test.ts`.
