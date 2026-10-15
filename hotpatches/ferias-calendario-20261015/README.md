# Espelho de férias no portal do colaborador

Hotpatch de produção (2026-10-15): calendário de pedidos **aprovados** e **pendentes** em `/portal/ferias`.

- API: `GET /portal/vacations/calendar?year=&month=`
- UI: `ferias-calendario.js?v=4` no `index.html` — calendário responsivo, sem título, centralizado e só leitura (badge FÉRIAS/PEND, sem clique). O resumo **Pedidos neste mês** permanece.
