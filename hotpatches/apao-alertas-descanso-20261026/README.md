# Alertas de descanso APAO (produção)

Não reconstrua a imagem `admin`. O fonte no VPS não fecha `ng build`.

O `apply.sh` só:

1. sobe o container existente, se estiver parado (`up -d --no-build`)
2. copia `apao-alertas.js` para o nginx
3. coloca o script no `index.html` com `?v=2`

No VPS, como root:

```bash
curl -fsSL "https://raw.githubusercontent.com/lipevidal-dev/pilotodeapoio/cursor/alertas-descanso-apao-326e/hotpatches/apao-alertas-descanso-20261026/apply.sh" | bash
```

Se o site estiver fora do ar depois da tentativa de rebuild:

```bash
cd /opt/pilotodeapoiov2
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-build admin
```

Depois rode o `apply.sh` de novo. Hard-refresh em `/escala`.
