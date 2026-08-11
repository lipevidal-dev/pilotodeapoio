# Férias no portal — adiantamento 13º e venda de 10 dias

Implementado em produção (`/opt/pilotodeapoiov2`) em 2026-08-11.

## Comportamento

1. Férias pendentes na escala são visíveis para **todos** os colaboradores.
2. Ao enviar solicitação de Férias, dois popups sequenciais perguntam sobre adiantamento do 13º e venda de 10 dias.
3. Admin aprova/rejeita **separadamente**: período, 13º e venda.

## API

- `POST /portal/requests` aceita `thirteenthAdvanceRequested` e `sellTenDaysRequested` (boolean).
- `POST /portal/requests/vacation-extra` body: `{ vacationId, extra: "THIRTEENTH_ADVANCE"|"SELL_TEN_DAYS", decision: "APPROVE"|"REJECT" }`.
- `GET /portal/requests/pending` inclui férias com período ou extras ainda `PENDING`, com campos de status.

## Migração

Ver `docs/vacation-extras-migration.sql`.
