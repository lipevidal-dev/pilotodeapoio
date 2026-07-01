# Escala Piloto de Apoio v2

**Versão atual:** `1.0.0` — ver [CHANGELOG.md](docs/CHANGELOG.md) e tag Git `v1.0.0`.

Reescrita profissional do sistema de escala PAO/APAO.

Versão anterior (referência funcional): `pilotodeapoio` (v1 Streamlit).

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| [docs/regras-extraidas-v1.md](docs/regras-extraidas-v1.md) | Regras de negócio extraídas da v1 |
| [docs/arquitetura-v2.md](docs/arquitetura-v2.md) | Arquitetura alvo e fases |
| [docs/decisoes-tecnicas.md](docs/decisoes-tecnicas.md) | Decisões técnicas |
| [docs/versionamento-git.md](docs/versionamento-git.md) | Git orquestrador + repos por módulo |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Histórico de releases |

## Estrutura

```
pilotodeapoiov2/          # Git orquestrador (docs, infra, compose)
├── docs/
├── backend/              # Git separado — API + domínio + Prisma
├── frontend-cliente/     # Git separado — Angular (futuro)
├── frontend-admin/       # Git separado — Angular admin (Fase 6)
├── mobile/               # Git separado — Flutter (futuro)
└── infra/
    ├── docker/
    └── nginx/
```

## Portas locais (Felipe)

| Projeto | API | PostgreSQL |
|---------|-----|------------|
| NamMedV2 | 3333 | 5432 |
| **Piloto de Apoio v2** | **3334** | **5434** |

Configure em `.env` (copie de [.env.example](.env.example)). Health: **http://localhost:3334/health**

## Domínios locais (Nginx — preparado)

| Host | Destino futuro |
|------|----------------|
| `api.localhost` | Backend (proxy → `localhost:3334`) |
| `cliente.localhost` | Angular cliente |
| `admin.localhost` | Angular admin |

Ver [infra/nginx/README.md](infra/nginx/README.md) e [infra/nginx/nginx.dev.conf](infra/nginx/nginx.dev.conf). Nginx ainda **fora** do Docker Compose.

## Produção (visão futura)

| URL | App |
|-----|-----|
| `https://seudominio.com` | frontend-cliente |
| `https://admin.seudominio.com` | frontend-admin |
| `https://api.seudominio.com` | backend |

## Fases concluídas

| Fase | Entrega |
|------|---------|
| 0 | Documentação + estrutura |
| 1 | Domínio de regras + testes — [backend/README.md](backend/README.md) |
| 2 | API + Prisma + PostgreSQL |
| 3 | Docker Compose — [infra/docker/README.md](infra/docker/README.md) |
| 4 | Git documentado + Nginx/domínios — [docs/versionamento-git.md](docs/versionamento-git.md) |
| 5.x | Geração, publicação, cenários-base e difíceis — [backend/README.md](backend/README.md) |
| **6** | **Admin Angular** — [frontend-admin/README.md](frontend-admin/README.md) |
| **6.1–6.3** | Tema GOL, grade operacional, cadastros (férias/FP/voo/pré-aloc.) |

### Admin (Fase 6 / 6.4)

| Item | Valor |
|------|-------|
| URL local | http://localhost:4201 |
| API | http://localhost:3334 |

**Modo desenvolvimento** (hot reload):

```powershell
cd frontend-admin
npm install
npm start
```

**Modo Docker** (Nginx, sem `npm start`):

```powershell
copy .env.example .env
docker compose up -d --build
# Admin: http://localhost:4201
# API:    http://localhost:3334/health
```

Telas: Dashboard, Funcionários, Geração de Escala (grade operacional), **Cadastros** (férias, FP, voos, pré-alocações). Sem JWT, WebSocket ou frontend-cliente nesta fase.

### Docker

```powershell
copy .env.example .env
docker compose up -d --build
docker compose ps
docker compose down
docker compose logs -f backend
docker compose logs -f admin
```

Serviços: `piloto_apoio_db`, `piloto_apoio_backend`, `piloto_apoio_admin`.

**Erro P3009** (backend em restart): migration `violation_levels` com nome de tabela incorreto no volume antigo. Reset DEV:

```powershell
docker compose down
docker volume rm pilotodeapoiov2_piloto_pg_data
docker compose up -d --build
```

Detalhes: [infra/docker/README.md](infra/docker/README.md#como-resolver-p3009-em-ambiente-local).

### Versionamento Git (sem push automático)

Repositórios **ainda não inicializados**. Quando for versionar:

```powershell
# Ver orientação completa
docs\versionamento-git.md
```

Ordem sugerida: `git init` em `backend/` → depois raiz (ou submódulos).

## Próximo passo sugerido

- **Fase 7:** frontend-cliente Angular + autenticação JWT
- Otimização do motor (cenários com 1 PAO) se necessário antes de produção
