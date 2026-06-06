# Versionamento Git — Escala Piloto de Apoio v2

Este documento orienta o modelo **orquestrador + repositórios por módulo**, sem publicar remoto automaticamente.

## Estado atual (Fase 4)

| Caminho | Repositório Git (`.git`) |
|---------|---------------------------|
| `pilotodeapoiov2/` (raiz) | **Não inicializado** |
| `backend/` | **Não inicializado** |
| `frontend-cliente/` | **Não inicializado** |
| `frontend-admin/` | **Não inicializado** |
| `mobile/` | **Não inicializado** |

A estrutura de pastas e código das Fases 0–3 já existe; falta apenas `git init` (local) quando você decidir versionar.

---

## Modelo recomendado

### 1. Repositório raiz (orquestrador)

**Caminho:** `pilotodeapoiov2/`

**Responsabilidade:**

- `docker-compose.yml`
- `.env.example` (portas, variáveis Compose)
- `docs/` (regras, arquitetura, decisões, este arquivo)
- `infra/` (docker, nginx — configuração compartilhada)
- Pastas vazias ou stubs: `frontend-cliente/`, `frontend-admin/`, `mobile/`
- Referência aos submódulos (opcional) ou apenas documentação de URLs dos remotes

**Não deve conter** (ou deve ignorar via `.gitignore`):

- `node_modules/`, `dist/`, `.env`
- Código duplicado do backend inteiro *se* backend for repo separado — ver estratégia abaixo

### 2. Repositórios por módulo

| Repo | Pasta | Conteúdo principal |
|------|-------|-------------------|
| Backend | `backend/` | API, Prisma, domínio, testes |
| Cliente | `frontend-cliente/` | Angular (futuro) |
| Admin | `frontend-admin/` | Angular (futuro) |
| Mobile | `mobile/` | Flutter (futuro) |

Cada um com **próprio** `.gitignore`, `README.md` e ciclo de release independente.

### Estratégias de vínculo raiz ↔ módulos

**A) Submódulos Git (recomendado para equipe e deploys separados)**

Na raiz, após criar remotes vazios (GitHub/GitLab):

```powershell
cd pilotodeapoiov2
git init
git submodule add <url-backend> backend
git submodule add <url-frontend-cliente> frontend-cliente
# ...
```

**B) Repositórios irmãos na mesma pasta pai (mais simples no início)**

```
escala/
├── pilotodeapoiov2/     # git init só docs + infra + compose
├── pilotodeapoiov2-backend/   # clone separado (opcional renomear backend/)
```

**C) Monorepo único (um só `.git` na raiz)**

Um commit engloba tudo. Mais simples no começo; menos isolamento por módulo.

Para este projeto, a meta declarada é **orquestrador + módulos** → preferir **A** ou manter pastas no mesmo disco com **dois níveis**: `git init` na raiz para infra/docs e `git init` dentro de `backend/` (dois repos no mesmo tree — Git aninhado só funciona se a raiz **ignorar** `backend/` ou usar submodule).

**Prática segura com dois `git init` no mesmo tree:**

- Raiz versiona: `docs/`, `infra/`, `docker-compose.yml`, `.env.example`, README
- Raiz **não** rastreia `backend/` (adicionar `backend/` ao `.gitignore` da raiz) **OU** usar submodule
- `backend/` tem seu próprio `.git` e ignora o pai

---

## Quando commitar em cada repositório

| Evento | Onde commitar |
|--------|----------------|
| Regra de domínio, teste Vitest | `backend/` |
| Prisma schema / migration | `backend/` |
| Dockerfile / entrypoint | `backend/` |
| docker-compose, portas NamMed vs Piloto | **raiz** |
| nginx.dev.conf, domínios | **raiz** (`infra/nginx/`) |
| Documentação de negócio (regras v1) | **raiz** (`docs/`) |
| Novo app Angular cliente | `frontend-cliente/` |
| Novo app Angular admin | `frontend-admin/` |
| App Flutter | `mobile/` |

---

## Padrão de commits (Conventional Commits — PT ou EN)

Formato sugerido:

```
<tipo>(<escopo>): <descrição curta>

Corpo opcional: porquê, impacto, breaking changes.
```

| Tipo | Uso |
|------|-----|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Só documentação |
| `chore` | Tooling, deps, gitignore |
| `refactor` | Refatoração sem mudar comportamento |
| `test` | Testes |
| `build` | Docker, CI, build |
| `perf` | Performance |

Exemplos:

```
feat(backend): expor GET /employees com Prisma
docs(infra): documentar portas 3334/5434 e conflito NamMedV2
chore(root): adicionar nginx.dev.conf para api.localhost
fix(domain): APAO sem PAO na janela do turno
```

---

## Ordem recomendada de commits (primeira vez)

### Repositório `backend/`

1. `chore: estrutura inicial e domínio de regras (fase 1)`
2. `feat: API Fastify, Prisma e repositórios (fase 2)`
3. `build: Dockerfile e entrypoint para Docker (fase 3)`
4. `chore: atualizar vitest 4.x e lockfile`

### Repositório raiz `pilotodeapoiov2/`

1. `docs: regras v1, arquitetura v2 e decisões técnicas`
2. `build: docker-compose PostgreSQL + backend`
3. `docs: versionamento git e portas locais NamMed vs Piloto`
4. `infra: nginx.dev.conf e README de domínios`

### Frontends / mobile (quando existirem)

1. `chore: scaffold Angular`
2. `feat: tela de escala mensal`
3. …

---

## O que nunca versionar

| Item | Motivo |
|------|--------|
| `.env` | Segredos e URLs locais |
| `node_modules/` | Reinstalável |
| `dist/`, `build/` | Artefato de compilação |
| `piloto_pg_data` / volumes Docker | Dados de banco locais |
| `*.db` SQLite de testes | Dados efêmeros |
| Credenciais reais, tokens | Segurança |
| `.env` com senha de produção | Segurança |

Arquivos versionáveis: `.env.example`, `docker-compose.yml`, `prisma/migrations/`, `nginx.dev.conf`.

---

## Comandos iniciais (local — sem push)

```powershell
# Backend
cd backend
git init
git add .
git status
git commit -m "feat: backend v2 com domínio, API, Prisma e Docker"

# Raiz (se backend for repo separado, adicionar backend/ ao .gitignore da raiz antes)
cd ..
git init
git add docs infra docker-compose.yml .env.example README.md .gitignore
git add frontend-cliente frontend-admin mobile
git commit -m "docs: orquestração piloto apoio v2 e infra docker/nginx"
```

**Não executar** `git push` até remotes e revisão estarem definidos.

---

## Checklist antes do primeiro push (futuro)

- [ ] Remotes criados (vazio ou com README)
- [ ] `.env` fora do índice (`git status` limpo de segredos)
- [ ] `npm test` e `docker compose` OK na máquina de referência
- [ ] Documentar URL da API em cada frontend (`environment.ts`)
- [ ] Branch `main` protegida no hosting (opcional)

---

## Referências no monorepo

- [README.md](../README.md) — visão geral e portas
- [infra/docker/README.md](../infra/docker/README.md) — Docker Fase 3
- [infra/nginx/README.md](../infra/nginx/README.md) — domínios Fase 4
