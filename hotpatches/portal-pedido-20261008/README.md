# Pedido do funcionário: Folga pedida, Férias e Outro

O menu do dia no portal deixa de oferecer Voo e Reunião de assuntos. Férias e Outro enviam e-mail para os administradores que têm e-mail cadastrado. O campo de observações permanece.

No servidor, como root:

```sh
curl -fsSL "https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/portal-pedido-tres-opcoes-e58d/hotpatches/portal-pedido-20261008/apply-portal-pedido.sh?v=1" | sh
```

Linha de sucesso: `portal-pedido ok: menu com folga, ferias e outro`.

O script troca o main para `main-APAOREV13.js` e o chunk do portal. O backend reinicia para carregar o aviso por e-mail.
