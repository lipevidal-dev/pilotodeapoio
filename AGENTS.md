# AGENTS.md

## Cursor Cloud specific instructions

### Production vs git branch

- The live product runs on **https://www.pcoordenador.com.br** (VPS `/opt/pilotodeapoiov2`).
- Branch `clean-motor-reset` is **not** a full mirror of production (portal, trocas, férias pendentes, etc. are richer on the VPS).
- Prefer **targeted SCP + `docker compose --env-file .env.prod -f docker-compose.prod.yml build <service>` + `up -d`**. Never wipe VPS files with a full sync from this branch.

### Férias no portal (produção)

- Pedidos de **FÉRIAS pendentes** já ficam **visíveis para todos** os colaboradores na escala (`portal-schedule.filter.ts` — exceção de PENDING para FERIAS).
- Ao solicitar Férias no portal, o colaborador responde em sequência:
  1. “Gostaria de adiantamento do 13º salário?” (Sim/Não)
  2. “Gostaria de vender 10 dias das férias?” (Sim/Não)
- Admin aprova **independentemente**: período (`POST /portal/requests/approve|reject`), 13º e venda (`POST /portal/requests/vacation-extra` com `extra`: `THIRTEENTH_ADVANCE` | `SELL_TEN_DAYS`).
- Colunas em `Vacation`: `thirteenth_advance_*`, `sell_ten_days_*` (+ enum `VacationExtraStatus`).
- UI admin: diálogo na escala e cartão “Solicitações pendentes” em Cadastros → Férias.

### Serviços úteis

- Compose: `docker compose --env-file .env.prod -f docker-compose.prod.yml`
- Containers: `backend` (API `:3333`), `admin` (nginx `:8080`), `db` (Postgres).
- Login API usa campo `login` (não `email`).
