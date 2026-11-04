# Observação do colaborador

Campo **Observação** no Editar funcionário. O texto aparece no hover do nome na escala.

Não altera alertas de descanso, trocas, Excel nem cores já publicadas.

O `apply.sh` unificado dos alertas também:

1. cria a coluna `observation` no Postgres (se ainda não existir)
2. registra as rotas `/employees/observations` no backend em execução
3. injeta `employee-observation.js` no admin
