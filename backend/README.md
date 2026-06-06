# Backend — Escala Piloto de Apoio v2

Fundação do backend (Fase 2): API HTTP, Prisma, PostgreSQL e arquitetura em camadas. O **domínio de regras** (Fase 1) permanece puro, sem Prisma/HTTP.

## Stack

- Node.js 20+
- TypeScript
- Fastify (HTTP)
- Prisma ORM
- PostgreSQL
- Vitest (testes de domínio)

## Arquitetura

```
src/
├── domain/           # Regras puras (sem Prisma, HTTP, WS)
├── application/      # Casos de uso e serviços
├── infrastructure/   # Prisma, repositórios, mappers
├── interfaces/       # Controllers, rotas, DTOs
└── tests/            # Testes Fase 1 (domínio)
```

Fluxo de validação:

```
POST /schedules/validate
  → interfaces (DTO + Zod)
  → application/validate-schedule.service
  → domain/rules (engine)
```

## Instalação

```bash
cd backend
npm install
cp .env.example .env
# Edite DATABASE_URL no .env
```

## Docker (recomendado — Fase 3)

Na **raiz** do monorepo (`pilotodeapoiov2/`):

```bash
docker compose up --build
```

API: http://localhost:3334/health (com `.env` `API_HOST_PORT=3334`) — detalhes em [../infra/docker/README.md](../infra/docker/README.md).

### Erro P3009 (migration falhou no Docker)

Se o backend reinicia em loop com `P3009` / `20250604230000_violation_levels`:

**Reset DEV (recomendado):**

```powershell
docker compose down
docker volume rm pilotodeapoiov2_piloto_pg_data
docker compose up -d --build
```

**Manter dados:** `prisma migrate resolve --rolled-back 20250604230000_violation_levels` — ver seção completa em [../infra/docker/README.md](../infra/docker/README.md#como-resolver-p3009-em-ambiente-local).

## Prisma

```bash
npm run prisma:generate
npm run prisma:migrate      # requer PostgreSQL ativo
npm run db:seed
```

Migração inicial versionada: `prisma/migrations/20250604120000_init/`.

### Exclusão de funcionários

- **DELETE físico** permitido apenas se não houver: escalas (`ScheduleAssignment`), férias, FP, voos ou pré-alocações.
- Com histórico: HTTP **409** `{ code: "HAS_OPERATIONAL_HISTORY" }` — inative via `PUT { active: false }`.
- Motor de geração usa somente `active: true` (`listActiveEmployees`).

## Execução

```bash
npm run dev      # API com hot reload (tsx)
npm start        # dist/main.js após build
```

API padrão: `http://localhost:3333`

## Testes e build

```bash
npm test
npm run typecheck
npm run build
```

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Saúde da API |
| GET | `/employees` | Lista funcionários |
| GET | `/employees/:id` | Detalhe |
| POST | `/employees` | Cria `{ name, type: PAO\|APAO, active? }` |
| PUT | `/employees/:id` | Atualiza |
| DELETE | `/employees/:id` | Remove físico **somente** sem histórico operacional; com histórico → **409** `HAS_OPERATIONAL_HISTORY` (use `active: false`) |
| GET | `/shifts` | Lista turnos (`?activeOnly=true` opcional) |
| GET | `/shifts/:id` | Detalhe do turno |
| POST | `/shifts` | Cria turno `{ code, name, startTime, endTime, roleType, active?, displayOrder?, mandatoryCoverage?, requiresT8PairNd? }` |
| PUT | `/shifts/:id` | Atualiza (inclui `active: false` para inativar) |
| DELETE | `/shifts/:id` | Remove físico **somente** sem histórico em `schedule_assignments`; com histórico → **409** `SHIFT_HAS_OPERATIONAL_HISTORY` |
| GET | `/vacations` | Lista férias |
| POST | `/vacations` | Cria `{ employeeId, startDate, endDate, notes? }` |
| POST | `/vacations/batch` | Cria vários períodos `{ employeeId, periods[{ startDate, endDate }], notes? }` → `{ created, skipped, items, skippedPeriods }` |
| DELETE | `/vacations/:id` | Remove férias |
| GET | `/requested-day-offs` | Lista folgas pedidas (FP) |
| POST | `/requested-day-offs` | Cria `{ employeeId, date, status?, notes? }` |
| POST | `/requested-day-offs/batch` | Cria várias FPs `{ employeeId, dates[], status, notes? }` → `{ created, skipped, items, skippedDates }` |
| DELETE | `/requested-day-offs/:id` | Remove FP |
| GET | `/flight-assignments` | Lista voos |
| POST | `/flight-assignments` | Cria `{ employeeId, date, description?, source? }` |
| POST | `/flight-assignments/batch` | Cria vários voos `{ employeeId, dates[], description?, source? }` → `{ created, skipped, items, skippedDates }` |
| DELETE | `/flight-assignments/:id` | Remove voo |
| GET | `/preallocations` | Lista (`?scheduleMonthId=` ou `?year=&month=`) |
| POST | `/preallocations` | Cria pré-alocação (SIMULADOR, CURSO, CMA, VOO, OUTRO) |
| POST | `/preallocations/batch` | Cria várias `{ year, month, employeeId, dates[], label, notes? }` → `{ created, skipped, items, skippedDates }` |
| DELETE | `/preallocations/:id` | Remove |
| POST | `/schedules/validate` | Valida `ScheduleContext` |
| POST | `/schedules/generate` | Gera escala do mês (motor + persistência) |
| POST | `/schedules/:id/publish` | Publica escala `GENERATED` → `PUBLISHED` |
| GET | `/schedules/published/:year/:month` | **Cliente:** só escala publicada |
| GET | `/schedules/:year/:month` | **Admin:** escala gerada ou publicada + validação |

### Fase 5 — Geração e publicação

- **Gerada (`GENERATED`):** resultado do motor; admin revisa violações e pendências.
- **Publicada (`PUBLISHED`):** visível no endpoint do cliente; **não** pode ser regenerada sem arquivar/despublicar (409).
- **Cliente (futuro):** apenas leitura via `GET /schedules/published/:year/:month` — sem edição.
- **Admin:** cadastros operacionais (Fase 6.3), geração, revisão, publicação.

### Fase 6.3 — Cadastros operacionais (motor)

Dados consumidos em `POST /schedules/generate` via `CalendarRepository`:

| Tabela | Efeito na geração |
|--------|-------------------|
| `Vacation` | Bloqueia dias (label FÉRIAS) |
| `RequestedDayOff` (APPROVED) | Bloqueia dia (FOLGA PEDIDA) |
| `FlightAssignment` | Bloqueia dia (VOO) |
| `PreAllocation` (mês) | Pré-bloqueio por label (SIMULADOR, CURSO, CMA, etc.) |

Status `ScheduleMonth`: `DRAFT` → `GENERATED` → `PUBLISHED` → `ARCHIVED`.

#### POST `/schedules/generate`

```json
{ "year": 2026, "month": 6 }
```

Resposta (exemplo):

```json
{
  "scheduleMonthId": "uuid",
  "status": "GENERATED",
  "assignmentsCreated": 120,
  "allocationsCreated": 40,
  "violations": [],
  "summary": { "valid": false, "coverageGaps": 0, "blockingViolations": 2 },
  "success": false,
  "suggestions": ["Revise pré-alocações..."]
}
```

#### POST `/schedules/:id/publish`

Altera status para `PUBLISHED`. Idempotente se já publicado.

#### Fase 5.1 — Anti-furo e publicação blindada

**Severidades (`RuleViolation.severity`):**

| Nível | Efeito |
|-------|--------|
| `CRITICAL` | Bloqueia `POST /schedules/:id/publish` (HTTP 409) |
| `WARNING` | Permite publicar; exige revisão admin |
| `INFO` | Somente informativo |

**Códigos críticos de cobertura:** `COVERAGE_MISSING_T6`, `COVERAGE_MISSING_T7`, `COVERAGE_MISSING_T8`.

**Ordem do motor (5.2):** bloqueios → `planT8CoverageRotating` (pares T8/T8 + ND) → T6/T7/T8 → folgas → ajuste 10 folgas (só T6/T7) → recobertura → APAO → `ScheduleRepairEngine` → validação + coverage gate.

**Publicação bloqueada (409):**

```json
{
  "code": "PUBLISH_BLOCKED_CRITICAL_VIOLATIONS",
  "message": "A escala possui violações críticas e não pode ser publicada.",
  "criticalViolations": []
}
```

#### Fase 5.3 — Cenários difíceis

Testes em `src/tests/schedule-hard-scenarios.test.ts` e fixtures em `src/tests/hard-scenarios-fixtures.ts`:

| Cenário | Expectativa |
|---------|-------------|
| 1 PAO 15 dias férias | 0 CRITICAL com 6 PAO restantes |
| 2 PAOs férias sobrepostas | 0 CRITICAL ou `impossibleScenario` + `mainBlockingReasons` |
| 3 FPs | sem turno no dia da FP |
| VOO / SIMULADOR / CURSO | dia bloqueado, sem turno |
| 3 PAO + 2 APAO | publicação bloqueada, `impossibleScenario` |
| SEM FOLGA SOCIAL / MONOFOLGA | WARNING, não CRITICAL |

`summary` inclui `impossibleScenario`, `mainBlockingReasons`, `generationMs`.

#### Fase 5.2 — Cenário-base realista

**Equipe mínima de prova:** 6 PAO (Alpha–Foxtrot) + 3 APAO (1–3), mês **junho/2026**, turnos T6/T7/T8 (PAO) e T1–T4 (APAO).

**Seed dev:**

```bash
npm run db:seed:realistic
```

O seed legado (`npm run db:seed`) permanece para testes antigos.

**Resultado esperado no cenário-base:** `summary.criticalCount === 0`, `coverageMissingCount === 0`, `daysWithFullCoverage === 30`, publicação permitida.

**`summary` em POST `/schedules/generate`:** `totalAssignments`, `totalViolations`, `criticalCount`, `warningCount`, `infoCount`, `coverageMissingCount`, `employeesUsed`, `paosUsed`, `apaosUsed`, `daysInMonth`, `generatedAt`, opcionalmente `workloadByEmployee`, `shiftsByCode`, `daysWithFullCoverage`.

**Escala impossível vs erro do motor:** com 1 PAO o mês não fecha cobertura (`coverageMissingCount > 0`) — impossibilidade matemática. Com 6 PAO e violações T8/folgas, é falha heurística do motor (Fase 5.3).

**Testes:** `src/tests/schedule-realistic.test.ts` (6 cenários). Debug local: `npx tsx scripts/debug-realistic.ts`.

#### Limitações do motor (v0 + 5.2)

- Heurística + reparo local; não é otimização global.
- Com poucos PAOs ainda pode restar furos após reparo.
- Não replaneja pré-alocações protegidas (férias, FP, voo, admin).
- ND após par T8/T8 no **último par do mês** pode cair no mês seguinte (não gera CRITICAL fora do mês planejado).
- Frontend só após motor estável (ver `docs/decisoes-tecnicas.md`).

## Exemplo: POST `/schedules/validate`

```json
{
  "year": 2026,
  "month": 6,
  "employees": [
    { "id": 1, "name": "PAO SILVA", "role": "PAO", "seniority": 1 },
    { "id": 4, "name": "APAO LIMA", "role": "APAO", "seniority": 1 }
  ],
  "shifts": [
    { "code": "T6", "role": "PAO", "name": "T6", "startTime": "06:00", "endTime": "14:00" },
    { "code": "T7", "role": "PAO", "name": "T7", "startTime": "14:00", "endTime": "22:00" },
    { "code": "T8", "role": "PAO", "name": "T8", "startTime": "22:00", "endTime": "06:00" },
    { "code": "T2", "role": "APAO", "name": "T2", "startTime": "06:00", "endTime": "12:00" }
  ],
  "assignments": [
    { "employeeId": 1, "employeeName": "PAO SILVA", "workDate": "2026-06-10", "shiftCode": "T6" },
    { "employeeId": 4, "employeeName": "APAO LIMA", "workDate": "2026-06-10", "shiftCode": "T2" }
  ],
  "allocations": []
}
```

Resposta:

```json
{
  "valid": false,
  "violations": [ { "severity": "ALTA", "ruleCode": "FURO COBERTURA PAO", "message": "...", "date": "...", "employee": "-", "detail": "..." } ],
  "summary": { "total": 12, "critica": 0, "alta": 10, "media": 2, "baixa": 0 }
}
```

## Seed

Após migrate:

```bash
npm run db:seed
npm run db:seed:realistic   # 6 PAO + 3 APAO (cenário-base Fase 5.2)
```

Cria:

- Turnos T6, T7, T8 (PAO) e T1–T4 (APAO)
- `db:seed`: PAO Exemplo 1/2, APAO Exemplo 1/2
- `db:seed:realistic`: PAO Alpha–Foxtrot, APAO 1–3
- Usuário `admin@escala.local` (senha dev: `changeme` — trocar em produção)
- `ScheduleMonth` do mês corrente

## WebSocket e Docker

Não implementados nesta fase. Ver:

- `src/interfaces/websocket/README.md`
- `docker/README.md`
- `.env.example` (`WS_*`, `CORS_ORIGINS` para Angular)

## Decisões de domínio (Fase 1)

- P-001: PAO com **10 folgas ideais** (11 permitido com WARNING; &lt;10 ou &gt;11 = CRITICAL)
- Dia livre PAO = **DISPONÍVEL PARA VOO** (INFO, não bloqueia publicação)
- **Turnos:** CRUD em `/shifts`; motor usa apenas `active: true`; exclusão bloqueada com histórico operacional
- P-002: **APAO nunca sozinho** (`ApaoRequiresPaoRule` + `canWork`)

## Modelos Prisma

`User`, `Employee`, `Shift`, `ScheduleMonth`, `ScheduleAssignment`, `PreAllocation`, `RuleViolation`, `Vacation`, `RequestedDayOff`, `FlightAssignment` — ver `prisma/schema.prisma`.
