# Docker — PostgreSQL + Backend + Admin (Fase 3 / 6.4)

Compose na **raiz do projeto**: `pilotodeapoiov2/docker-compose.yml`

## Serviços

| Serviço | Container | Porta host (padrão doc) | Descrição |
|---------|-----------|-------------------------|-----------|
| `db` | `piloto_apoio_db` | 5432 ou **5434** | PostgreSQL 16 |
| `backend` | `piloto_apoio_backend` | 3333 ou **3334** | API Node.js + Prisma |
| `admin` | `piloto_apoio_admin` | **4201** | Angular admin (Nginx) |

### Credenciais PostgreSQL

| Campo | Valor |
|-------|--------|
| Database | `piloto_apoio_v2` |
| User | `piloto` |
| Password | `piloto_dev` |
| URL (dentro da rede Docker) | `postgresql://piloto:piloto_dev@db:5432/piloto_apoio_v2?schema=public` |

Volume persistente: `piloto_pg_data`

## Portas no host — NamMedV2 vs Piloto de Apoio v2

| Projeto | API (host) | PostgreSQL (host) |
|---------|------------|-------------------|
| **NamMedV2** (outro repo) | 3333 | 5432 |
| **Piloto de Apoio v2** (este) | **3334** | **5434** |

No ambiente local do Felipe, Piloto usa **3334/5434** para não conflitar com NamMedV2.

**Dentro do Docker** (rede `pilotodeapoiov2_default`):

- Backend → `db:5432` (`DATABASE_URL` no compose)
- API escuta **3333** dentro do container; o host publica `API_HOST_PORT` (ex.: 3334)

Copie `.env.example` → `.env` na raiz:

```env
POSTGRES_HOST_PORT=5434
API_HOST_PORT=3334
ADMIN_HOST_PORT=4201
```

Health: `http://localhost:3334/health` (com o `.env` acima).  
Admin: `http://localhost:4201` (build Angular + Nginx no container `admin`).

Se as portas 5432/3333 estiverem livres, pode usar os valores padrão do `docker-compose.yml` (`${POSTGRES_HOST_PORT:-5432}`).

## Subir os containers

Na raiz do repositório:

```powershell
cd C:\Users\Felipe Vidal\Desktop\AI\escala\pilotodeapoiov2
copy .env.example .env
docker compose up --build
```

Em segundo plano:

```powershell
docker compose up --build -d
```

Na primeira subida o backend executa automaticamente:

1. Espera o PostgreSQL (`pg_isready`)
2. `prisma migrate deploy`
3. `prisma db seed` (idempotente)
4. `npm start` na porta **3333**

## Derrubar

```powershell
docker compose down
```

Parar e remover volumes (apaga dados do banco):

```powershell
docker compose down -v
```

## Logs

```powershell
docker compose logs -f backend
docker compose logs -f db
```

Últimas linhas:

```powershell
docker compose logs --tail=100 backend
```

## Testar healthcheck

### API

```powershell
curl http://localhost:3333/health
```

Resposta esperada (JSON): `status: "ok"`, `service: "escala-pao-backend"`.

No PowerShell sem curl:

```powershell
Invoke-RestMethod http://localhost:3333/health
```

### PostgreSQL (health do container)

```powershell
docker inspect --format='{{.State.Health.Status}}' piloto_apoio_db
```

Deve retornar `healthy` após alguns segundos.

Teste manual dentro do banco:

```powershell
docker exec -it piloto_apoio_db psql -U piloto -d piloto_apoio_v2 -c "\dt"
```

## Acessar o banco

**Via container:**

```powershell
docker exec -it piloto_apoio_db psql -U piloto -d piloto_apoio_v2
```

**Via host (porta 5432 exposta):**

- Host: `localhost`
- Port: `5432`
- User / Password / DB: conforme tabela acima

Ferramentas GUI: DBeaver, pgAdmin, etc., usando os mesmos dados.

## Comandos úteis

```powershell
# Rebuild só do backend
docker compose build backend

# Reiniciar backend sem rebuild
docker compose restart backend

# Migrations manualmente no container
docker exec -it piloto_apoio_backend npx prisma migrate deploy

# Seed manual
docker exec -it piloto_apoio_backend npx prisma db seed

# Shell no backend
docker exec -it piloto_apoio_backend sh

# Status dos serviços
docker compose ps
```

## Windows — `docker-entrypoint.sh`

O script usa finais de linha **LF** (Unix). O Dockerfile remove CRLF com `sed` no build.

Se o entrypoint falhar com `$'\r': command not found`:

1. Confirme `.gitattributes` em `backend/docker-entrypoint.sh` (`eol=lf`)
2. No Git: `git add --renormalize backend/docker-entrypoint.sh`
3. Rebuild: `docker compose build --no-cache backend`

Alternativa local (Git Bash / WSL):

```bash
sed -i 's/\r$//' backend/docker-entrypoint.sh
```

## Como resolver P3009 em ambiente local

Erro típico no log do backend:

```
Error: P3009
The `20250604230000_violation_levels` migration ... failed
```

### Causa (Fase 6.4.1)

A migration `20250604230000_violation_levels` referenciava a tabela `rule_violations`, mas o `init` criou `"RuleViolation"` (PascalCase). O PostgreSQL retornava `42P01: relation "rule_violations" does not exist` e a migration ficava marcada como **falha** em `_prisma_migrations`, bloqueando novas execuções.

**Correção no código:** migration atualizada para `"RuleViolation"`.

### Opção A — Reset limpo (recomendado em DEV)

Apaga o volume PostgreSQL e reaplica migrations + seed do zero:

```powershell
docker compose down
docker volume rm pilotodeapoiov2_piloto_pg_data
docker compose up -d --build
docker compose ps
```

Confirme: `piloto_apoio_db` healthy, `piloto_apoio_backend` e `piloto_apoio_admin` UP.

### Opção B — Manter dados (após correção da migration)

Marca a migration falha como revertida e reaplica:

```powershell
docker compose down
docker compose run --rm --no-deps backend npx prisma migrate resolve --rolled-back 20250604230000_violation_levels
docker compose up -d --build
```

Se `migrate deploy` ainda falhar, use a Opção A.

### Verificação

```powershell
Invoke-RestMethod http://localhost:3334/health
# Admin: http://localhost:4201
```

O entrypoint do backend exibe estas instruções no log quando `migrate deploy` falha. O serviço `backend` usa `restart: on-failure:5` para evitar loop infinito.

## Desenvolvimento sem Docker

Continue usando `backend/.env.example` com `localhost:5432` e `npm run dev` — ver [backend/README.md](../../backend/README.md).

## Admin em Docker (Fase 6.4)

O serviço `admin` faz build do Angular (`frontend-admin/Dockerfile`) e serve em Nginx na porta 80 do container, mapeada para `ADMIN_HOST_PORT` no host.

```powershell
docker compose up -d --build
docker compose ps
# piloto_apoio_db, piloto_apoio_backend, piloto_apoio_admin — UP
```

O admin no browser chama a API em `http://localhost:3334` (`environment.production.ts`). CORS do backend já inclui `http://localhost:4201`.

**Desenvolvimento sem Docker:** `cd frontend-admin && npm start` (porta 4201, hot reload).

## O que ainda não está no Compose

- Frontend cliente
- Nginx reverso unificado no host (`infra/nginx/`)
- WebSocket (`/ws/admin`, `/ws/client`)
