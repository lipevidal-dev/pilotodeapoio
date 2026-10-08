# CMTE / FCF

A faixa recolhível da escala passa a se chamar **CMTE / FCF**. Entram nela quem está marcado como comandante (`isCmte`) e quem está com Cargo FCF (`isFcf`). A ordem continua PAO, depois essa faixa, depois APAO.

O arquivo publicado é `chunk-CMTEFCF1.js`. O `index.html` só troca `main-APAOREV10.js` por `main-APAOREV11.js` e mantém o CSS do resumo.

No servidor, como root:

```sh
curl -fsSL "https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/cmte-fcf-grupo-e58d/hotpatches/cmte-fcf-20261008/apply-cmte-fcf.sh?v=1" | sh
```

A linha de sucesso é `cmte-fcf ok: divisao CMTE / FCF`. Depois feche a aba da escala e abra de novo. A faixa começa recolhida: o título fica CMTE / FCF e o chevron abre os nomes.
