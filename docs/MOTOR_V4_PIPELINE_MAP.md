# Mapa do Pipeline — Motor REAL_V1 / V4

Documento de revisão estrutural. **Não altera regras, rateio ou cobertura.** Objetivo: mapear o fluxo completo, identificar duplicidade de contadores e propor refatoração segura.

**Entrada de produção:** `GenerateScheduleUseCase.execute` → `RealScheduleEngine.generate`  
**Workspace mutável:** `GenerationWorkspace` (`generation-workspace.ts`)  
**Versão:** `MOTOR_VERSION_ID = "REAL_V1"`

---

## Diagrama geral

```
[1 Entrada]     buildGenerationInput + GenerationWorkspace + applyHardBlocks
[1d Rateio]     initRateioContext (bounds min/target/max)
[2 T8]          allocateT8BlocksStrict
[3 Férias]      materializeVacationFortnightPatterns
[4 Metas]       computeRealMotorTargets
[5 Blocos V3]   buildBlockPlans → materializeBlockPlans
[5b Residual]   coverResidualT6T7Only
[5d–8b]         folgas, voos, paralelos, APAO, closeStructurePreservingGaps
[9 Balance]     operationalBalancer.balance
[10–11c]        dedup, repair, T8/ND reconcile
[11d V4]        enforceProportionalTurnTargets
[12 Optimizer]  blockOptimizer.optimize
[12b V4]        enforceProportionalTurnTargets (pós-optimizer)
[13 Final]      runFinalCoveragePipeline
[14 Audit]      validateSchedule + runFinalCoverageGate
[15 Persist]    scheduleRepo.upsertGeneratedMonth
```

`execute()` cobre `[1]`–`[8b]`. `generate()` adiciona `[9]`–`[14]`.

---

## Etapas detalhadas

Legenda de colunas:

| Col | Significado |
|-----|-------------|
| **Turnos** | Conta T6/T7/T8/T9 |
| **Dias trab.** | Conta dias úteis operacionais (turnos + voo + cadastros) |
| **Pré-aloc** | Pode sobrescrever pré-alocação admin? |
| **Rateio** | Altera contadores/limites de rateio? |
| **Cobertura** | Altera slots T6/T7/T8 do mês? |

---

### 1. Entrada de dados

| Campo | Valor |
|-------|-------|
| **Funções** | `GenerateScheduleUseCase.execute`, `buildGenerationInput`, `new GenerationWorkspace`, `seedCrossMonthHistory`, `enforceMonthStart6x1FromPrevious`, `planFolgaSocial` |
| **Arquivos** | `application/use-cases/generate-schedule.use-case.ts`, `infrastructure/mappers/generation-input.mapper.ts`, `domain/schedule/generation-workspace.ts`, `domain/schedule/generation-types.ts` |
| **Entrada** | DB: employees, shifts, roles, férias, FP, VOO, pré-alocações, histórico cross-month, restrições, preferências, no-flight |
| **Saída** | `GenerationInput`, `GenerationWorkspace` com `planned`, `blocked`, `allocations`, maps de bloqueio |
| **Contadores** | Nenhum de rateio ainda |
| **Turnos / Dias trab.** | N/A |
| **Pré-aloc** | Não — aplica locks |
| **Rateio** | Não |
| **Cobertura** | Indireto (bloqueia dias) |
| **Próximo** | `applyHardBlocks` → `execute` |

---

### 2. Pré-alocações (hard blocks)

| Campo | Valor |
|-------|-------|
| **Funções** | `applyHardBlocks`, `lockDay`, `isLockedByAdmin`, `isNdOverrideProtected` |
| **Arquivos** | `generation-workspace.ts`, `operational-labels.ts` |
| **Entrada** | `lockedAllocations`, calendário (férias, FP, VOO, FANI, cadastros) |
| **Saída** | `blocked`, `allocations`, flags de proteção |
| **Contadores** | Nenhum |
| **Pré-aloc** | **Protege** — motor não sobrescreve `isLockedByAdmin` |
| **Próximo** | `initRateioContext` |

Labels protegidos na persistência: `MANUAL_PREALLOC_LABELS` (`generate-schedule.use-case.ts`).

---

### 3. Cálculo de disponibilidade

| Campo | Valor |
|-------|-------|
| **Funções** | `buildScheduleRateioContext`, `computeProportionalTurnTargets`, `countCalendarAvailableDaysForRateio`, `isCalendarUnavailableForRateio`, `classifyPlanningGroup`, `calculateEmployeeCapacity` |
| **Arquivos** | `schedule-rateio-context.ts`, `pao-turn-availability.ts`, `demand-planning-capacity.ts` |
| **Entrada** | `blocked`, férias, FP, FANI (reduzem dias); CURSO/SIM/CMA/OUTRO **não** reduzem |
| **Saída** | `availableDaysByEmployee`, `relativeAvailabilityByEmployee`, `min/target/maxTurnCounts` |
| **Contadores** | Apenas **bounds** (não `current*`) |
| **Turnos / Dias trab.** | **Dias de calendário** disponíveis |
| **Pré-aloc** | Não |
| **Rateio** | Define limites proporcionais |
| **Cobertura** | Não |
| **Próximo** | `allocateT8BlocksStrict` |

**Dois modelos paralelos:**

1. **Disponibilidade rateio** — dias livres no calendário  
2. **Capacidade planning** — grupo NORMAL / VACATION / FULL_NO_FLIGHT (`demand-planning-capacity.ts`)

---

### 4. Cálculo de metas proporcionais

| Campo | Valor |
|-------|-------|
| **Funções** | `computeTurnRateio`, `distributeProportionalIntegerTargets`, `computeRealMotorTargets`, `calculateRequiredT6T7Shifts`, `syncRateioCountsFromWorkspace` |
| **Arquivos** | `real-schedule-turn-rateio.ts`, `real-schedule-targets.ts`, `schedule-rateio-context.ts`, `demand-planning-demand.ts` |
| **Entrada** | Estado pós-T8 e pós-férias quinzenais; demanda = `dias × 3` (T6+T7+T8) |
| **Saída** | `TurnRateioEntry[]` (`turnTarget`, `allocatedTurns`, `requiredT6T7`), `IndividualTarget[]` para blocos |
| **Contadores** | `currentTurnCounts`, `currentT6/T7/T8/T9Counts` (sync do grid) |
| **Turnos** | Sim — meta e alocado são turnos T6–T9 |
| **Pré-aloc** | Não |
| **Rateio** | Sim (metas, não movimentação) |
| **Cobertura** | Não |
| **Próximo** | `materializeT6T7BlocksStrict` |

**Importante:** `computeRealMotorTargets` roda **depois** de T8 e férias — `allocatedTurns` já inclui T8 e turnos de férias.

---

### 5. Planejamento de blocos (V3)

| Campo | Valor |
|-------|-------|
| **Funções** | `buildBlockPlans`, `targetToBlocksV3`, `idealBlockSizeForTarget`, `plannedBlockCountForTarget`, `idealBlockSpacing` |
| **Arquivos** | `demand-planning-blocks.ts`, `motor-v3-planning.ts` |
| **Entrada** | `IndividualTarget[]` filtrados (não VACATION, não T9-only, não T8-preferred, `target > 0`) |
| **Saída** | `EmployeeBlockPlan[]` com `plannedBlocks: { size }[]` — **somente plano, sem grid** |
| **Contadores** | Nenhum |
| **Turnos** | Sim — `target` = T6/T7 restantes |
| **Pré-aloc** | Não |
| **Rateio** | Não |
| **Cobertura** | Não |
| **Próximo** | `materializeBlockPlans` |

---

### 6. Materialização

| Campo | Valor |
|-------|-------|
| **Funções** | `materializeT6T7BlocksStrict` → `materializeBlockPlans`; também antecipado: `allocateT8BlocksStrict`, `materializeVacationFortnightPatterns` |
| **Arquivos** | `real-schedule-blocks.ts`, `demand-planning-materialize.ts`, `real-schedule-t8.ts`, `real-schedule-vacation-materialize.ts`, `employee-t6-t7-shift.js`, `v3-block-materialize-audit.ts` |
| **Entrada** | Block plans + workspace; T8: pool rotativo; férias: padrão 3/2 |
| **Saída** | `planned` (T6/T7/T8), `allocations` (ND), `V3BlockMaterializeAudit` |
| **Contadores** | `recordRateioAssignment` via `tryAssignShift`; `employeeT6T7Lock` |
| **Turnos** | Sim |
| **Pré-aloc** | Não — `tryAssignShift` respeita bloqueios |
| **Rateio** | Sim (incremental) |
| **Cobertura** | **Sim** — preenchimento primário |
| **Próximo** | `coverResidualT6T7Only` |

Ordem em `execute`: **[2] T8 → [3] férias → [4] metas → [5] T6/T7**.

---

### 7. Residual

| Campo | Valor |
|-------|-------|
| **Funções** | `coverResidualT6T7Only`, `tryPlaceResidualBlock`; também via `closeStructurePreservingGaps` |
| **Arquivos** | `real-schedule-residual.ts`, `real-schedule-engine.ts` |
| **Entrada** | Gaps T6/T7 restantes |
| **Saída** | Blocos 5→4→3 e unitários; `ResidualT6T7Result` |
| **Contadores** | `tryAssignShift` + `coverageEmergency` pode exceder max |
| **Turnos** | Sim |
| **Pré-aloc** | Não |
| **Rateio** | Sim (overflow possível) |
| **Cobertura** | **Sim** |
| **Próximo** | `closeStructurePreservingGaps` → folgas |

---

### 8. T8 / T8 / ND

| Campo | Valor |
|-------|-------|
| **Funções** | `allocateT8BlocksStrict`, `tryPlaceT8Block`, `closeT8CoverageGaps`, `finalizeT8NdBlocks`, `ensureNdForT8Pairs`, `repairIsolatedT8`, `cleanupOrphanNd`, `reconcileNdAfterParallelShifts`, `repairT8GapsAfterDedup`, `optimizeEmergencyIsolatedT8` |
| **Arquivos** | `real-schedule-t8.ts`, `schedule-grid-source.ts`, `repair-t8-gaps-after-dedup.ts`, `optimize-emergency-isolated-t8.ts` |
| **Entrada** | Gaps T8, pares existentes, regras ND |
| **Saída** | Blocos T8/T8/ND; ND em `blocked`/`allocations` |
| **Contadores** | T8 em `currentT8Counts`; **ND não é turno** |
| **Turnos** | T8 sim; ND não |
| **Pré-aloc** | ND pode substituir folgas geradas; não admin locks |
| **Rateio** | T8 sim |
| **Cobertura** | **Sim** |
| **Próximo** | Múltiplos pontos — inicial antes de metas; final pós-dedup/optimizer |

`finalizeT8NdBlocks` = `repairIsolatedT8` + `reconcileNdAfterParallelShifts` + `ensureNdForT8Pairs` + ND cross-month + `cleanupOrphanNd`.

---

### 9. Dedup

| Campo | Valor |
|-------|-------|
| **Funções** | `deduplicatePaoShiftCoverage` |
| **Arquivos** | `pao-shift-dedup.ts` |
| **Entrada** | Múltiplos PAOs no mesmo turno/dia |
| **Saída** | Remove extras (mantém menor senioridade) |
| **Contadores** | `recordRateioUnassignment` |
| **Turnos** | Sim |
| **Pré-aloc** | Não admin; pode quebrar proteção T8 (`bypassT8Protection`) |
| **Rateio** | Sim (reduz doador) |
| **Cobertura** | Sim (pode abrir gap → repair) |
| **Próximo** | `closeStructurePreservingGaps` / `runFinalCoveragePipeline` |

Chamado em `[11b]` e duas vezes em `[13]`.

---

### 10. V4 enforce (meta proporcional)

| Campo | Valor |
|-------|-------|
| **Funções** | `enforceProportionalTurnTargets` → `enforceMinimumTurnTargets` + `enforceTargetTurnTargets`; audit: `auditV4Transfers` |
| **Arquivos** | `enforce-minimum-turn-targets.ts`, `v4-transfer-audit.ts`, `assignment-eligibility.ts` |
| **Entrada** | `ScheduleRateioContext` sincronizado; doadores acima target; receptores abaixo min/target |
| **Saída** | Transferências same-day T6/T7/T8; `EnforceTurnTargetsReport` |
| **Contadores** | assign/unassign + `syncRateioCountsFromWorkspace` |
| **Turnos** | Sim |
| **Pré-aloc** | Não — skip `isLockedByAdmin` |
| **Rateio** | **Sim — propósito central** |
| **Cobertura** | Preservada (`transferStateValid` exige zero gaps) |
| **Próximo** | `blockOptimizer` / novo ciclo repair |

Chamado em `[11d]`, `[12b]` e dentro de `[13]`.

---

### 11. Block optimizer

| Campo | Valor |
|-------|-------|
| **Funções** | `BlockOptimizer.optimize`, `findWorkBlocks`, `isBlockWorkDay`, `tryMoveShift`, `trySwapShifts` |
| **Arquivos** | `block-optimizer.ts`, `motor-v3-planning.ts` |
| **Entrada** | Grid atual; apenas T6/T7 móveis |
| **Saída** | `BlockOptimizerReport` |
| **Contadores** | assign/unassign; valida `violatesRateioMax/Min` |
| **Turnos / Dias trab.** | **Conflita** — `isBlockWorkDay` inclui ND, VOO, cadastros no score de bloco |
| **Pré-aloc** | Não |
| **Rateio** | Sim |
| **Cobertura** | Preservada |
| **Próximo** | V4 pós-optimizer → `runFinalCoveragePipeline` |

---

### 12. Repair final

| Campo | Valor |
|-------|-------|
| **Funções** | `runFinalCoveragePipeline`, `repairAllCoverageGapsFinal`, `operationalBalancer.balance`, `ScheduleRepairEngine.repair`, `closeStructurePreservingGaps` |
| **Arquivos** | `real-schedule-engine.ts`, `repair-all-coverage-gaps-final.ts`, `operational-balancer.ts`, `schedule-repair-engine.ts` |
| **Entrada** | Workspace pós-optimizer |
| **Saída** | Gaps preenchidos ou T8 emergencial; rollback se gap persiste |
| **Contadores** | Todos; `overflowEvents` |
| **Turnos** | Sim |
| **Pré-aloc** | Geralmente não; emergency usa `coverageEmergency=true` |
| **Rateio** | Sim — cobertura > rateio |
| **Cobertura** | **Sim — prioridade máxima** |
| **Próximo** | `validateSchedule` |

Sequência `[13]`: `finalizeT8NdBlocks` → dedup → T8 repair → V4 → `optimizeEmergencyIsolatedT8` (snapshot) → `repairAllCoverageGapsFinal` ×3 → `validateNoCoverageGaps`.

---

### 13. Auditoria final

| Campo | Valor |
|-------|-------|
| **Funções** | `buildStructuralMetrics`, `buildEmployeeDiagnostics`, `buildTurnRateioAudit`, `validateSchedule`, `runFinalCoverageGate`, `buildGenerationInsights`, `buildExtendedSummary` |
| **Arquivos** | `real-schedule-audit.ts`, `real-schedule-employee-diagnostics.ts`, `turn-rateio-audit.ts`, `rules/engine.js`, `rules/coverage-gate.js` |
| **Entrada** | `ws.toScheduleContext()`, violations acumuladas |
| **Saída** | `GenerationResult`, `RealMotorReport` |
| **Contadores** | Somente leitura |
| **Próximo** | Persistência |

---

### 14. Persistência

| Campo | Valor |
|-------|-------|
| **Funções** | `scheduleRepo.upsertGeneratedMonth`, `clearForRegeneration`, `saveAssignments`, `saveGeneratedPreAllocations`, `saveViolations` |
| **Arquivos** | `generate-schedule.use-case.ts`, `infrastructure/repositories/schedule.repository.ts` |
| **Entrada** | `assignments`, `allocations`, `violations` |
| **Saída** | Registro mês status `GENERATED` |
| **Pré-aloc** | `skipPersistKeys` protege labels manuais |
| **Próximo** | Resposta API |

---

## Duplicidade de contadores

| Contador | Onde | O que conta | Risco |
|----------|------|-------------|-------|
| `countRateioTurns` | `pao-rateio-shifts.ts` | T6+T7+T8+T9 do grid | **Fonte canônica (grid)** |
| `currentTurnCounts` | `schedule-rateio-context.ts` | T6+T7+T8+T9 | Incremental + sync; pode driftar entre syncs |
| `currentT6/T7/T8/T9Counts` | idem | Por turno | idem |
| `countAllocatedTurns` | `real-schedule-turn-rateio.ts` | Alias → `countRateioTurns` | OK se grid atualizado |
| `workCount` | `generation-workspace.ts` | Shifts em `planned` **sem T9** | **≠ rateio turn count** |
| `countWorkDays` | `generation-workspace.ts` | Alias → `countAllocatedTurns` | Nome enganoso (“workdays” = turnos) |
| `countMotorWorkDays` | `real-schedule-workdays.ts` | `countWorkdayBreakdown.total` (só turnos rateio) | Separado de voo/cadastros no total |
| `countAllocatedPrimaryTurns` | `pao-rateio-shifts.ts` | T6+T7+T8 (sem T9) | Usado em paths legados |
| `allocatedTurns` (relatório) | `computeTurnRateio` | `currentTurnCount(ctx)` pós-sync | Depende de sync |
| `overflowEvents` | `ScheduleRateioContext` | Emergências acima do max | Append-only |
| `V3BlockMaterializeAudit` | `v3-block-materialize-audit.ts` | Plan/mat/desc blocos | Só diagnóstico; não alimenta rateio |
| `blockOptimizerReport.metrics` | `block-optimizer.ts` | Blocos/isolados | Score próprio; não sincroniza ctx |

### Pontos críticos de divergência

1. **`workCount` vs `countRateioTurns`:** `workCount` exclui T9; rateio inclui T9. Usados em `completePaoAgenda`, repair, priorização.
2. **Incremental vs sync:** Edição direta em `planned` sem `tryAssignShift`/`unassignShift` desincroniza `rateioContext` até `syncRateioCountsFromWorkspace`.
3. **Metas float vs int:** `targetTurnCounts` (float proporcional) vs `turnTarget` inteiro em `distributeProportionalIntegerTargets`.
4. **Optimizer vs rateio:** `isBlockWorkDay` trata ND/VOO/cadastros como dia de bloco; rateio só T6–T9.
5. **Metas vs materialização:** `IndividualTarget.target` = T6/T7 restantes pós-T8; blocos planejados podem descartar turnos (audit V3) sem atualizar meta até residual/V4.

---

## Funções que confundem dias trabalhados com turnos

| Função | Arquivo | Problema |
|--------|---------|----------|
| `countWorkDays` | `generation-workspace.ts` | Nome “workdays”; implementação = `countAllocatedTurns` (T6–T9) |
| `countMotorWorkDays` | `real-schedule-workdays.ts` | “Work days” = turnos rateio no grid |
| `isBlockWorkDay` | `block-optimizer.ts` | ND, VOO, SIM, CURSO, CMA, OUTRO contam no bloco |
| `findWorkBlocks` / score | `block-optimizer.ts` | Métricas misturam alocações operacionais com turnos |
| `workTargetForGroup` / `MONTHLY_WORKDAY_TARGET` | `real-schedule-targets.ts` | Meta 20 dias trabalhados convive com rateio de turnos |
| `allocateFlightsForWorkdayDeficit` | `real-schedule-flights.ts` | Preenche meta de dias via `countMotorWorkDays` |
| `tryAssignShift` budget | `generation-workspace.ts` | `workCount + ND + folgas ≤ dias mês` |
| `buildEmployeeDiagnostics` | `real-schedule-employee-diagnostics.ts` | Reporta `allocatedTurns` e `actualWorkdays` lado a lado |

**Regra desejada:** turnos = T6+T7+T8+T9; dias trabalhados = turnos + voo + cadastros (ND **não** é turno nem dia trabalhado).

---

## Etapas que podem sobrescrever decisões anteriores

| Etapa | O que sobrescreve | Proteção |
|-------|-------------------|----------|
| `deduplicatePaoShiftCoverage` | Turnos duplicados | Mantém PAO mais antigo; bypass T8 |
| `enforceProportionalTurnTargets` | Turno doador → receptor mesmo dia | Admin lock; rollback em falha |
| `blockOptimizer` | Posição T6/T7 | Admin lock, T8, cobertura, rateio min/max |
| `operationalBalancer` | VOO, folgas, turnos 6x1 | VOO de entrada protegido |
| `repairAllCoverageGapsFinal` | Pode exceder max rateio | `coverageEmergency`, `overflowEvents` |
| `optimizeEmergencyIsolatedT8` | T8 isolado → bloco | Rollback snapshot se gap persiste |
| `finalizeT8NdBlocks` | Folgas geradas → ND | Pré-aloc protegida |
| `trimShiftsForMinimumFolgas` | Remove T6/T7 | Só se `!realV1ManualCommonFolga` |
| `closeStructurePreservingGaps` | Re-aloca cobertura | Pode chamar `completePaoAgenda` |

**Protegidos:** `lockedAllocations`, `isLockedByAdmin`, `isNdOverrideProtected`, `isInputFlightDay`.

---

## ScheduleGenerationState (estado oficial proposto)

Implementação inicial: `backend/src/domain/schedule/schedule-generation-state.ts`

```typescript
interface ScheduleGenerationState {
  stage: PipelineStage;
  assignments: GeneratedAssignment[];
  preAllocations: GeneratedAllocation[];
  coverage: CoverageSnapshot;
  rateioContext: ScheduleRateioContext | null;
  blockPlan: EmployeeBlockPlan[] | null;
  diagnostics: GenerationDiagnostics;
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
}
```

**Regra:** nenhuma etapa mantém contador próprio divergente — leitura/escrita via `buildScheduleGenerationState` + `syncRateioContext` antes de cada checkpoint.

Validações: `schedule-generation-validators.ts`

- `validateAfterPlanning`
- `validateAfterMaterialization`
- `validateAfterResidual`
- `validateAfterV4Enforce`
- `validateBeforeSave`

---

## Proposta de refatoração (ordem segura)

### Fase A — Observabilidade (concluída parcialmente)

- [x] V3 block materialize audit
- [x] V4 transfer audit
- [x] Turn rateio audit
- [x] `ScheduleGenerationState` + validadores entre etapas
- [x] Teste integração jul/2026

### Fase B — Fonte única de contadores (sem mudar algoritmo)

1. **`getTurnCounts(uuid)`** — sempre `countRateioTurns(ws, uuid)`; deprecar leituras diretas de `currentTurnCounts` fora de hot paths.
2. **`syncRateioContext()`** obrigatório após qualquer mutação que não passe por `tryAssignShift`/`unassignShift`.
3. Renomear `countWorkDays` → `countRateioTurnsFromGrid` (alias temporário).
4. Documentar `workCount` como “turnos principais sem T9”.

### Fase C — Pipeline com checkpoints

1. Extrair `RealScheduleEngine.runStage(stage, state)` com validação após cada etapa.
2. Migrar `GenerationWorkspace` mutações para receber `ScheduleGenerationState` como view.
3. Falhar fast em `errors` CRÍTICOS entre etapas (modo debug).

### Fase D — Corrigir algoritmos (após diagnóstico V3)

1. Materialização V3 — spacing/slot sem perder turnos planejados.
2. Alinhar meta pós-materialização com residual.
3. Block optimizer — separar score estrutural de contagem rateio.

### Fase E — Persistência

1. `validateBeforeSave` no `GenerateScheduleUseCase` antes de `upsertGeneratedMonth`.
2. Rejeitar persist se CRÍTICO (configurável).

---

## Modo REAL_V1

`realV1ManualCommonFolga = true` (padrão atual):

- Folga comum, FA e voos **não** auto-gerados
- FS gerada (`planFolgaSocial`)
- Vários paths de repair de folgas desativados
- Voos déficit omitidos

---

## Referências de código

| Componente | Arquivo |
|------------|---------|
| Orquestrador | `real-schedule-engine.ts` |
| Workspace | `generation-workspace.ts` |
| Rateio | `schedule-rateio-context.ts`, `pao-rateio-shifts.ts` |
| Metas | `real-schedule-turn-rateio.ts`, `pao-turn-availability.ts` |
| Blocos V3 | `demand-planning-blocks.ts`, `demand-planning-materialize.ts` |
| V4 | `enforce-minimum-turn-targets.ts` |
| Validadores | `schedule-generation-validators.ts` |
| Estado | `schedule-generation-state.ts` |
| Persistência | `generate-schedule.use-case.ts` |

Documento legado (motor antigo): `backend/docs/schedule-engine-slices.md` — **não** descreve o path REAL_V1 de produção.
