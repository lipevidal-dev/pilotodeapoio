# Backup do Motor de Geração — V1

## Metadados

| Campo | Valor |
|-------|-------|
| **Data/fase** | 2026-06-05 — Fase backup antes de reescrita futura |
| **Classe** | `ScheduleGenerationEngineV1` |
| **Arquivo** | `backend/src/domain/schedule/schedule-generation-engine-v1.ts` |
| **Instância exportada** | `scheduleGenerationEngineV1` |

## Objetivo

Preservar o motor de geração de escala **exatamente como estava** no momento do backup, para referência e comparação antes de uma eventual reescrita em novo motor.

## Motor ativo (produção)

O sistema continua usando o motor atual:

- **Classe:** `ScheduleGenerationEngine`
- **Arquivo:** `backend/src/domain/schedule/schedule-generation-engine.ts`
- **Uso:** `GenerateScheduleUseCase` importa `ScheduleGenerationEngine` do arquivo acima.

**Não há flag de seleção de engine.** O V1 não substitui o motor ativo.

## Importante

- O arquivo `schedule-generation-engine-v1.ts` **não deve ser evoluído** daqui para frente.
- Correções e novas regras devem ocorrer no motor ativo (`schedule-generation-engine.ts`) ou em um **novo motor** (ainda não criado).
- O V1 compartilha as mesmas dependências em tempo de execução que o motor ativo (não foram duplicadas).

## Dependências diretas do pipeline V1

O método `generate()` do motor orquestra chamadas a estes módulos (não copiados nesta fase):

| Arquivo | Papel no pipeline |
|---------|-------------------|
| `generation-workspace.ts` | Workspace: bloqueios, T8/T8/ND, cobertura T6/T7/T8, APAO, folgas |
| `schedule-repair-engine.ts` | Reparo local de furos de cobertura |
| `generation-insights.ts` | Insights e cenário impossível |
| `generation-summary.ts` | Resumo estendido da geração |
| `generation-types.ts` | Tipos `GenerationInput`, `GenerationResult` |
| `../rules/engine.js` | `validateSchedule` |
| `../rules/coverage-gate.js` | `runFinalCoverageGate` |
| `../rules/constants.js` | Constantes (ex.: `IDEAL_PAO_REST_COUNT`) |

### Dependências indiretas (via workspace / validação)

| Arquivo | Papel |
|---------|-------|
| `generation-context.ts` | Contexto para validadores |
| `schedule-repair-engine.ts` | Reparo (já listado) |
| `operational-labels.ts` | Labels e bloqueios operacionais |
| `operational-summary.ts` | Resumo operacional pós-geração |
| `../rules/validators.ts` | Regras de validação (T8, folgas, FP, etc.) |
| `../rules/eligibility.ts` | Elegibilidade `canWork` |
| `available-for-flight.ts` | Dias disponíveis para voo |

## Como importar o V1 (referência / testes)

```typescript
import {
  ScheduleGenerationEngineV1,
  scheduleGenerationEngineV1,
} from "../../domain/schedule/schedule-generation-engine-v1.js";

const engine = new ScheduleGenerationEngineV1();
// ou
const result = scheduleGenerationEngineV1.generate(input);
```

## Escopo desta fase

- Apenas cópia do orquestrador (`schedule-generation-engine.ts` → `-v1.ts`).
- Sem alteração de lógica, frontend, Prisma, Docker ou regras operacionais.
- Sem migration de banco.
