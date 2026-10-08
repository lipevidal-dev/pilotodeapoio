# Checkbox de agrupamento separado do espaçamento

O número de agrupamento e o número de espaçamento deixam de compartilhar o checkbox `pao_espacamento_turnos`.

Configuração já salva sem a chave nova herda o estado do espaçamento. Um valor salvo de agrupamento permanece.

T8 continua no texto `T8 · T8 · ND`. A linha do checkbox de agrupamento fica em branco nesse turno.

No servidor, como root:

```sh
curl -fsSL "https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/motor-agrupamento-checkbox-e58d/hotpatches/motor-agrupamento-20261008/apply-agrupamento.sh?v=1" | sh
```

Linha de sucesso: `agrupamento ok: checkbox separado do espacamento`.

O script renomeia `main-APAOREV11.js` para `main-APAOREV12.js` e o chunk do motor. O CSS do resumo no `index.html` não é reescrito. O backend é reiniciado para carregar o `dist`.
