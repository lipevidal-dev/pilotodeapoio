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

### Dashboard (produção)

Métricas em `frontend-admin/.../dashboard-analytics.util.ts` (client-side a partir de `GET /schedules/:y/:m` + prefs mensais):

- KPI **Alocações do mês** = quantidade de voo + simulador + demais pré-alocações
- KPI **Prefs. portal atendidas** = percentual único (`matched/total`)
- Doughnut **Composição** = Turnos × Folgas × Pré-alocações
- Barra **Média de turnos por colaborador** (Geral/PAO/APAO)
- Linha **Equilíbrio diário** = turnos + folgas/férias + pré-alocações por dia
- Barra **Colaboradores e turnos realizados**

### Escala — preferência ao lado do nome

Na página **Escala** (somente **ADMIN**), o turno preferido do mês aparece em **vermelho** ao lado do nome, ex.: `Luccas Flávio` + vermelho `(T6)`. Colaboradores no portal não veem. Fonte: `GET /employees/monthly-shift-preferences/:year/:month`.

### Serviços úteis (produção VPS)

- Compose: `docker compose --env-file .env.prod -f docker-compose.prod.yml`
- Containers: `backend` (API `:3333`), `admin` (nginx `:8080`), `db` (Postgres).
- Login API em **produção** usa campo `login` (não `email`).

### Cloud agent — ambiente local deste repo (`clean-motor-reset`)

- Stack local via `docker compose up -d` na raiz (já mapeia API **3334**, Postgres **5434**, admin **4201**).
- `backend/.env` deve apontar `DATABASE_URL` para `localhost:5434` quando rodar Node no host.
- Login da API **neste branch/local**: campo `email` (ex.: `admin@escala.local` / `changeme`).
- Lint efetivo do backend: `npm run typecheck` (não há script eslint). Frontend: `npm run build`.
- Testes: `npm test` no backend — vários suites `_legacy`/módulos ausentes falham ao importar nesta branch; isso é pré-existente. Preferir suites Clean atuais.
- Dev hot-reload: `npm run dev` no backend; `npm start` no frontend-admin (porta 4201 — conflita com o container `admin` se ambos estiverem up).
- Produção (`pcoordenador.com.br`) é mais rica que este branch; ver avisos no topo deste arquivo.
