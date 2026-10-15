# Espelho de férias no portal do colaborador

Hotpatch de produção (2026-10-15): calendário de pedidos **aprovados** e **pendentes** em `/portal/ferias`.

- API: `GET /portal/vacations/calendar?year=&month=`
- UI: `ferias-calendario.js?v=3` no `index.html` — espelho compacto, centralizado e só leitura (badge FÉRIAS/PEND, sem clique). O resumo **Pedidos neste mês** permanece.
