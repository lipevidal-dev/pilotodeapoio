# Decisões técnicas — Escala Piloto de Apoio v2

Registro de decisões para a migração. Itens marcados **PENDENTE** exigem alinhamento com operação/RH antes da implementação.

---

## Decisões já tomadas (fase 0)

| ID | Decisão | Motivo |
|----|---------|--------|
| D-001 | **Não reescrever** o sistema na fase 0 | Reduzir risco; extrair regras da v1 primeiro |
| D-002 | Estrutura monorepo com `backend`, dois frontends, `mobile`, `infra` | Separação clara de deploy e equipes |
| D-003 | Documentar regras v1 em `regras-extraidas-v1.md` antes de código | Contrato de migração |
| D-004 | Preservar **siglas e cores** da v1 na v2 | Paridade com planilha Excel e PDF operacional |
| D-005 | Adotar **fluxo unificado** (motor v2) como fluxo oficial | Evita divergência README vs UI da v1 |
| D-006 | Não portar `_archive/scratch` nem `extracted_scheduler.py` | Código experimental / obsoleto |
| D-007 | Portar `tests/test_rules.py` como contrato de regressão | Única garantia automatizada forte da v1 |
| D-008 | **P-001 calibrado:** PAO com **10 folgas ideais**; **11 permitido** (WARNING); &lt;10 ou &gt;11 = CRITICAL | Alinha validação com operação Excel |
| D-029 | **Dia vazio = DISPONÍVEL PARA VOO** (INFO) — não bloqueia publicação | Dias livres são candidatos a voo, não erro |
| D-009 | **P-002 fechado:** APAO nunca sozinho — PAO cobrindo a janela do turno | `canWork` + `ApaoRequiresPaoRule` na fase 1 |

---

## Decisões pendentes

### Negócio / regras

| ID | Status | Decisão |
|----|--------|---------|
| **P-001** | **ACEITO (calibrado)** | PAO: **10 folgas = ideal** (OK); **11 folgas = permitido** (WARNING, não bloqueia publicação); **&lt;10 ou &gt;11 = CRITICAL**. Motor prioriza 10 e usa 11 só quando necessário. Folgas computáveis = F + FS + FA + FP. |
| **P-002** | **ACEITO** | **APAO nunca fica sozinho.** Toda alocação de APAO em turno exige **≥1 PAO cobrindo a mesma janela horária** — enforce na alocação (`canWork`) e na validação (`ApaoRequiresPaoRule`). |
| P-003 | PAO FCF e T9 | A) Remover T9 B) Manter exceções FCF | Workshop com operação |
| P-004 | Heal FS/FAG | A) Manter heal em writes B) Regra declarativa só na validação | **B** longo prazo; **A** curto prazo para paridade rápida |

### Stack

| ID | Pergunta | Opções | Recomendação inicial |
|----|----------|--------|----------------------|
| P-010 | Linguagem backend | A) Python (port direto) B) Node C) .NET | **A** — menor custo de port das regras |
| P-011 | Banco produção | A) PostgreSQL B) SQLite | **A** prod; SQLite só dev/test |
| P-012 | API | A) REST OpenAPI B) GraphQL | **A** — CRUD de escala é resource-oriented |
| P-013 | Frontend | A) React+TS B) Vue C) Manter Streamlit interno | **A** ou **B** para cliente/admin |
| P-014 | Auth | A) JWT local B) SSO empresa | Definir com TI cliente |

### Dados

| ID | Pergunta | Opções | Recomendação inicial |
|----|----------|--------|----------------------|
| P-020 | Path do DB v1 na migração | Import único vs sync contínua | Import único na cutover |
| P-021 | Modelo `(Original: …)` | Manter string vs colunas novas | Colunas `promoted_from` na v2 |

### Infra

| ID | Pergunta | Opções | Recomendação inicial |
|----|----------|--------|----------------------|
| P-030 | Hospedagem | On-prem Docker vs cloud | Docker Compose mínimo em `infra/docker` |
| P-031 | Backups | Mesmo padrão v1 (pasta) vs S3/pg_dump | pg_dump agendado + retenção |

---

## Decisões derivadas da análise v1 (riscos → ação)

| Risco v1 | Ação v2 |
|----------|---------|
| `scheduler.py` monolítico | Extrair `ScheduleEngine` ≤500 linhas por módulo |
| assignments + allocations | Serviço `DayState` unifica leitura; writes transacionais |
| Streamlit cache no repo | Remover; cache só na borda se necessário |
| Bypass `coverage_emergency` | Log obrigatório + flag na resposta da API |
| Testes em arquivo DB | `:memory:` ou fixtures por teste no CI |

---

## Critérios de aceite da migração

1. Suite portada de `test_rules.py` **100% verde** contra API/domínio v2.  
2. Export PDF de um mês real v1 vs v2 — **diff visual** aceito pelo operador.  
3. Import de `escala.db` v1 — funcionários, turnos, mês corrente sem perda de FP/FÉRIAS.  
4. Geração de junho (ou mês piloto acordado) — zero violações **CRÍTICA/ALTA** nas 22 regras.  
5. Documentação de operação atualizada (fluxo único, sem passo 3 órfão).

---

## Histórico

| Data | Autor | Alteração |
|------|-------|-----------|
| 2026-06-04 | Migração fase 0 | Documento inicial + estrutura de pastas |
| 2026-06-04 | Fase 1 | P-001/P-002 fechados; núcleo de regras em `backend/` (TypeScript + Vitest) |
| 2026-06-04 | Fase 2 | Fastify + Prisma/PostgreSQL; camadas domain/application/infrastructure/interfaces |
| 2026-06-04 | Fase 3 | Docker Compose (`db` + `backend`); portas configuráveis via `.env` |
| 2026-06-04 | Fase 4 | Git documentado (5 repos planejados); `nginx.dev.conf`; Piloto 3334/5434 vs NamMed 3333/5432 |
| 2026-06-04 | Fase 5 | Motor `ScheduleGenerationEngine` + `GenerateScheduleUseCase`; status `GENERATED`; publicação `PUBLISHED` |
| 2026-06-04 | Fase 5.1 | Severidades CRITICAL/WARNING/INFO; repair engine; publish guard 409 |
| 2026-06-04 | Fase 5.2 | Cenário-base 6 PAO + 3 APAO; `planT8CoverageRotating`; summary estendido; 52 testes |
| 2026-06-04 | Fase 5.3 | Cenários difíceis (férias, FP, VOO, equipe reduzida); `generation-insights`; 62 testes |

---

## Fase 5 — Geração automática e publicação (ACEITO)

| ID | Decisão | Detalhe |
|----|---------|---------|
| D-010 | Escala **gerada** ≠ **publicada** | `GENERATED` = rascunho operacional após motor; `PUBLISHED` = visível ao cliente |
| D-011 | Cliente só lê `PUBLISHED` | `GET /schedules/published/:year/:month` — sem CRUD de escala |
| D-012 | Admin usa `GET /schedules/:year/:month` | Inclui `GENERATED` e validação em memória |
| D-013 | Regeneração bloqueada se `PUBLISHED` | HTTP 409; exige fluxo futuro de arquivar/despublicar |
| D-014 | Motor inicial heurístico | `backend/src/domain/schedule/schedule-generation-engine.ts` — não port do `scheduler.py` monolítico |

### Fase 5.1 — Anti-furo + repair (ACEITO)

| ID | Decisão |
|----|---------|
| D-015 | `CRITICAL` bloqueia publicação; `WARNING`/`INFO` não |
| D-016 | Coverage gate final com `COVERAGE_MISSING_T6/T7/T8` |
| D-017 | `ScheduleRepairEngine` após geração (até 200 rodadas) |
| D-018 | ~~Folgas PAO reservadas antes da cobertura~~ **SUPERADO em 5.2** — cobertura T6/T7/T8 tem prioridade; folgas após cobertura |
| D-019 | Frontend adiado até escala publicável sem furo crítico |

### Fase 5.2 — Prova de escala realista (ACEITO)

| ID | Decisão | Detalhe |
|----|---------|---------|
| D-020 | Cenário-base fixo para testes | 6 PAO (Alpha–Foxtrot) + 3 APAO; junho/2026; fixture `realistic-fixtures.ts` + seed `db:seed:realistic` |
| D-021 | T8 mensal em pares rotativos | `planT8CoverageRotating`: blocos T8/T8/ND em janelas de 2 dias cobrindo o mês; reparo só completa furos |
| D-022 | ND fora do mês planejado | Par T8/T8 terminando no último dia do mês não exige ND dentro do mês (ND pode ser dia 1 do mês seguinte) |
| D-023 | Summary estendido na geração | Métricas de cobertura, severidade e uso de equipe em `POST /schedules/generate` |
| D-024 | Mapper DB ↔ domínio | `buildContextFromDbParts` usa IDs sequenciais alinhados às alocações (correção publicação) |

**Resultado junho/2026 (cenário-base):** geração com `criticalCount = 0`, cobertura diária T6/T7/T8, 10–11 folgas por PAO, dias livres como DISPONÍVEL PARA VOO (INFO), publicação permitida.

**Limites ainda aceitos (Fase 5.3):** meses com muitas pré-alocações, equipes &lt; 6 PAO, otimização de carga/folgas sociais, performance do repair em meses grandes.

**Impossível vs motor:** 1 PAO + 1 APAO → `coverageMissingCount &gt; 0` (impossível). 6 PAO com críticas T8/folgas após 5.2 → tratar como bug/heurística, não relaxar regra.

### Fase 5.3 — Cenários difíceis (ACEITO)

| ID | Decisão | Detalhe |
|----|---------|---------|
| D-025 | Suite `schedule-hard-scenarios.test.ts` | Férias, FP, ocupações, equipe 3 PAO, classificação WARNING para social/monofolga |
| D-026 | `generation-insights.ts` | `impossibleScenario`, `mainBlockingReasons`, suggestions consolidadas |
| D-027 | Orçamento mensal PAO | `work + ND + 10 folgas ≤ dias do mês`; folgas antecipadas se ≥5 bloqueios (férias) |
| D-028 | Reparo respeita 12h | `coverageEmergency` não ignora descanso mínimo entre turnos |

**Performance:** geração baseline tipicamente &lt; 3s após cache de gaps no workspace; cenários com férias ~0,3–0,5s.

### Pendências futuras (pós Fase 5.3)

- Frontend admin (gerar, revisar violações, publicar)
- Frontend cliente (filtro mês/funcionário, somente leitura)
- Auth JWT nos endpoints de escala
- Despublicar/arquivar mês
- Motor: otimização global, troca entre dias mais agressiva
- WebSocket para atualização em tempo real na sala de escala

---

*Atualizar este arquivo a cada decisão fechada (status: ACEITO / REJEITADO / SUPERADO).*
