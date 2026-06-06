# Nginx — domínios e roteamento (Fase 4)

Configuração **preparatória**. O Nginx **não** entra no `docker-compose` nesta fase.

Arquivo principal: [nginx.dev.conf](./nginx.dev.conf)

## Desenho alvo

### Produção (futuro)

| URL pública | Destino |
|-------------|---------|
| `https://seudominio.com` | `frontend-cliente` (Angular build estático ou SSR) |
| `https://admin.seudominio.com` | `frontend-admin` |
| `https://api.seudominio.com` | `backend` (Node/Fastify) |

TLS no Nginx (Let's Encrypt ou certificado corporativo). CORS no backend alinhado aos domínios reais.

### Desenvolvimento local (Felipe / NamMed coexistindo)

| Acesso | Destino atual | Observação |
|--------|---------------|------------|
| `http://localhost:3334` | Backend Piloto | Direto, sem Nginx |
| `http://localhost:5434` | PostgreSQL Piloto | Host → container |
| `http://api.localhost` | Backend via Nginx | Proxy → `127.0.0.1:3334` |
| `http://cliente.localhost` | Angular cliente (futuro) | Proxy → `127.0.0.1:4200` |
| `http://admin.localhost` | Angular admin (futuro) | Proxy → `127.0.0.1:4201` |

**NamMedV2** (outro projeto) continua em **3333** (API) e **5432** (Postgres).  
**Piloto de Apoio v2** usa **3334** e **5434** no host — ver [../docker/README.md](../docker/README.md).

Dentro da rede Docker do Piloto, o backend sempre fala com `db:5432` (porta interna do container).

## Arquivo hosts (Windows)

Editar como administrador: `C:\Windows\System32\drivers\etc\hosts`

```
127.0.0.1 api.localhost
127.0.0.1 cliente.localhost
127.0.0.1 admin.localhost
```

## Como usar o `nginx.dev.conf` (quando quiser testar)

1. Instalar Nginx no Windows (ou WSL).
2. Incluir o arquivo no `nginx.conf` principal:

```nginx
include C:/Users/Felipe Vidal/Desktop/AI/escala/pilotodeapoiov2/infra/nginx/nginx.dev.conf;
```

3. Subir backend: `docker compose up -d` (porta **3334** no `.env`).
4. Validar:

```powershell
curl http://api.localhost/health
# deve espelhar http://localhost:3334/health
```

5. Recarregar Nginx: `nginx -s reload`

## Upstreams e portas

Edite os blocos `upstream` em `nginx.dev.conf` se mudar portas no `.env`:

| Upstream | Porta padrão Piloto (Felipe) |
|----------|------------------------------|
| `piloto_backend` | 3334 |
| `piloto_frontend_cliente` | 4200 (futuro) |
| `piloto_frontend_admin` | 4201 (futuro) |

## Path prefix `/api` (alternativa)

Alguns times preferem um único `localhost` com:

- `/` → cliente  
- `/admin` → admin (ou subdomínio)  
- `/api` → backend  

Há um bloco comentado no final de `nginx.dev.conf` como ponto de partida.

## Docker + Nginx (fase futura)

Quando integrar ao Compose:

- Serviço `nginx` na frente de `backend`, `frontend-cliente`, `frontend-admin`
- Upstreams usam nomes de serviço: `http://backend:3333` (porta **interna** do container)
- Volume montando `infra/nginx/nginx.dev.conf` → `/etc/nginx/conf.d/default.conf`

Não implementado na Fase 4.

## O que esta fase não inclui

- Angular cliente/admin
- WebSocket (`/ws/admin`, `/ws/client`)
- TLS / certificados
- Autenticação JWT no gateway

## Referências

- [docs/versionamento-git.md](../../docs/versionamento-git.md)
- [README raiz](../../README.md)
