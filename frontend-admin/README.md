# Frontend Admin — Escala Piloto de Apoio v2



Painel operacional Angular para o motor de escala (Fase 6 / 6.1).



## Pré-requisitos



- Node.js 20+

- Backend rodando em **http://localhost:3334** (`GET /health` deve responder)



## Instalação



```powershell

cd frontend-admin

npm install

```



## Como rodar

### Modo desenvolvimento (hot reload)

```powershell
npm start
```

Abre em **http://localhost:4201** (porta fixa no `angular.json`). Requer backend em **http://localhost:3334**.

### Modo Docker (recomendado para visualizar sem npm start)

Na raiz do projeto:

```powershell
copy .env.example .env
docker compose up -d --build
```

Admin: **http://localhost:4201** — container `piloto_apoio_admin` (Nginx + build de produção).  
API: **http://localhost:3334/health**

Variável de porta: `ADMIN_HOST_PORT=4201` no `.env` da raiz.



## Build



```powershell

npm run build

```



Saída em `dist/escala-pao-admin/browser/`.

### Docker

| Arquivo | Função |
|---------|--------|
| `Dockerfile` | Build Angular + imagem Nginx Alpine |
| `nginx.conf` | SPA fallback `index.html`, cache de assets, proxy API (comentado) |
| `.dockerignore` | Exclui `node_modules`, `dist` |

A API em produção aponta para `http://localhost:3334` (`src/environments/environment.production.ts`) — o browser acessa o backend pela porta publicada no host.



## Testes



```powershell

npm test

```



## Navegação (menu lateral)

| Seção | Itens |
|-------|-------|
| **Principal** | Dashboard, Geração de Escala |
| **Cadastros Operacionais** | Férias, Folgas Pedidas, Voos, Simulador, Curso, CMA, Outros |
| **Configurações** | Funcionários, Cargos (Funções), Turnos |

## Telas

| Rota | Conteúdo |
|------|----------|
| `/dashboard` | Status da API, versão, teste de conexão, resumo do mês atual |
| `/escala` | Geração, violações, publicação e **grade operacional mensal** |
| `/cadastros/ferias` | Férias — `GET/POST/DELETE /vacations`, batch delete |
| `/cadastros/folgas-pedidas` | Folgas pedidas (FP) — `GET/POST/DELETE /requested-day-offs`, batch delete |
| `/cadastros/voos` | Voos — `GET/POST/DELETE /flight-assignments`, batch delete |
| `/cadastros/simulador` | Simulador — `GET/POST/DELETE /simulators`, batch delete |
| `/cadastros/curso` | Curso — `GET/POST/DELETE /courses`, batch delete |
| `/cadastros/cma` | CMA — `GET/POST/DELETE /cmas`, batch delete |
| `/cadastros/outros` | Outras alocações — `GET/POST/DELETE /other-operational-allocations`, batch delete |
| `/funcionarios` | CRUD de funcionários — `GET/POST/PUT/DELETE /employees` |
| `/configuracoes/cargos` | Cargos (Funções) — `GET/POST/PUT/DELETE /roles` |
| `/configuracoes/turnos` | Turnos — `GET/POST/PUT/DELETE /shifts` |

## Gestão de turnos (Fase 6.5)

Menu **Configurações → Turnos**:

- Listar, criar, editar, ativar/inativar e excluir turnos
- Exclusão bloqueada com histórico (`409 SHIFT_HAS_OPERATIONAL_HISTORY`) — inativar em vez de excluir
- Turnos inativos não entram em novas gerações (motor filtra `active: true`)

## Grade operacional (Fase 6.2)

Visualização estilo planilha operacional aérea:

| Eixo | Conteúdo |
|------|----------|
| **Linhas** | Funcionários agrupados por PAO / APAO |
| **Colunas** | Dias do mês (01–31) + resumo por funcionário |
| **Células** | Turnos (cor única azul) e labels (F, FS, FA, FP, Férias, Voo, Sim, Curso, CMA, Outro, ND) |

### Componentes

| Componente | Pasta | Função |
|------------|-------|--------|
| `ScheduleGridComponent` | `components/schedule-grid/` | Grade principal com scroll horizontal |
| `ScheduleCellComponent` | `components/schedule-cell/` | Célula colorida por tipo |
| `ScheduleLegendComponent` | `components/schedule-legend/` | Legenda fixa de cores |
| `EmployeeSummaryComponent` | `components/employee-summary/` | Totais T6/T7/T8/F/Férias/Voo |

### Utilitários

- `utils/schedule-cell.mapper.ts` — monta grade a partir da API (sem recalcular motor)
- `utils/schedule-grid.filter.ts` — filtros PAO/APAO/funcionário
- `services/schedule-export.service.ts` — preparação para export PDF/PNG/Excel (futuro)

### Cores das células (Fase 6.5)

| Código | Cor |
|--------|-----|
| **Turnos** (T6, T7, T8, T1–T4, etc.) | **Azul padrão único** (`SHIFT_DEFAULT_COLOR`) |
| ND | Cinza |
| F (folga) | Vermelho |
| FS | Verde |
| FA | Verde escuro |
| FP | Roxo |
| Férias | Azul claro |
| Voo | Laranja (GOL) |
| Simulador | Cinza |
| Curso | Amarelo |
| CMA | Azul escuro |
| Outro | Marrom |

Legenda exibe **Turnos** com uma única cor (não lista T6/T7/T8 separadamente).

### Painel de violações (Fase 6.5)

Na tela `/escala`, o painel exibe apenas **CRITICAL** e **WARNING**. Violações **INFO** (ex.: DISPONÍVEL PARA VOO) permanecem na API/backend, mas não são renderizadas na UI.

### Filtros e navegação

- Ano / mês
- Funcionário
- Tipo PAO / APAO
- “Somente selecionado”
- Mês anterior / próximo / Hoje / Recarregar

### Exportação (futuro)

`ScheduleExportService.prepareExportPayload()` já estrutura dados para PDF, PNG e Excel — implementação nas próximas fases.



## Tema visual GOL (Fase 6.1)



Identidade corporativa inspirada na GOL Linhas Aéreas — painel operacional, não site comercial.



### Arquivos de tema



| Arquivo | Função |

|---------|--------|

| `src/styles/theme-gol.scss` | Variáveis CSS, cards, tabelas, KPIs, badges |

| `src/app/theme/gol-preset.ts` | Preset PrimeNG (laranja como cor primária) |

| `src/styles.scss` | Carrega o tema global (`@use`) |



### Variáveis principais (`:root`)



| Variável | Uso |

|----------|-----|

| `--gol-orange` | Cor principal, botões, item ativo do menu |

| `--gol-orange-dark` | Hover / destaque |

| `--gol-gray-dark` | Menu lateral, cabeçalhos de tabela |

| `--gol-gray-medium` | Textos secundários |

| `--gol-gray-light` | Fundo da área de conteúdo |

| `--gol-white` | Cards e topo |

| `--status-critical` | Violações CRITICAL |

| `--status-warning` | WARNING |

| `--status-info` | INFO / GENERATED |

| `--status-success` | PUBLISHED / online |



### Logo



Placeholder atual:



```

src/assets/brand/logo-gol-placeholder.svg

```



Referenciado no menu lateral (`admin-layout.component.html`). Para usar a logo oficial da GOL:



1. Substitua o arquivo acima (mesmo nome) **ou** altere o `src` da `<img>` no layout.

2. Mantenha proporção horizontal (~280×52 px recomendado).

3. Não é necessário alterar backend nem rotas.



Texto alternativo exibido: **GOL | Escala PAO**.



## Serviços

- `ApiHealthService` — `/health`
- `EmployeeService` — `/employees`
- `ScheduleService` — generate, publish, get month, get published
- `VacationService` — `/vacations`
- `RequestedDayOffService` — `/requested-day-offs`
- `FlightAssignmentService` — `/flight-assignments`
- `SimulatorService`, `CourseService`, `CmaService`, `OtherOperationalAllocationService` — cadastros rotulados (`/simulators`, `/courses`, `/cmas`, `/other-operational-allocations`)

## Cadastros operacionais (Fase 6.3)

Menu **Cadastros Operacionais** — alimenta o motor antes de gerar escala:

| Cadastro | Integração motor |
|----------|------------------|
| Férias | `CalendarRepository.listVacationDaysForMonth` |
| FP aprovada | `listApprovedDayOffForMonth` |
| Voo | `listFlightDaysForMonth` |
| Simulador / Curso / CMA / Outros | Bloqueios rotulados por recurso dedicado (`PreAllocation` no banco) |

Exclusões pedem confirmação; cadastros com tabela suportam exclusão em lote. Visual GOL: tabelas `gol-table`, checkbox de seleção à direita (antes de Excluir), botões laranja.

## Calendário operacional GOL (Fase 6.3.4)

Componente `OperationalCalendarComponent` (`components/operational-calendar/`):

| Modo | Uso |
|------|-----|
| `single` | Uma data |
| `multiple` | FP, voos, pré-alocações, férias avançado |
| `range` | Férias período contínuo |

**Drag and select:** clique, arraste até outra data e solte — todas as datas do intervalo são selecionadas (sem duplicar). Preview laranja durante o arrasto.

**Utilitário** `date-range-utils.ts` — converte datas avulsas em períodos contínuos para férias.

| Cadastro | Modo calendário | Endpoint batch |
|----------|-----------------|----------------|
| Férias | `multiple` + drag | `POST /vacations/batch` (agrupa em períodos contínuos) |
| FP | `multiple` + drag | `POST /requested-day-offs/batch` |
| Voos | `multiple` + drag | `POST /flight-assignments/batch` |
| Simulador / Curso / CMA / Outros | `multiple` + drag | `POST /{resource}/batch` |

**Visual GOL:** laranja na seleção, hover suave, cabeçalho cinza antracite, fins de semana diferenciados, dia atual com contorno, botões Hoje/Limpar.

**UX:** contador, chips, resumo, limpar seleção, validação sem datas, loading ao salvar.

## Environment



`src/environments/environment.ts`:



```ts

apiBaseUrl: 'http://localhost:3334'

```



## Limitações



- Sem autenticação JWT

- Sem WebSocket

- Sem frontend-cliente nem mobile

- CRUD de funcionários: apenas listagem + criação

- Visualização da escala: tabela agrupada por dia (sem calendário)

- Logo: placeholder SVG (trocar manualmente pela oficial)

- Tema inspirado na GOL; não é identidade oficial homologada



## Stack



Angular 19, PrimeNG 19, PrimeIcons, PrimeFlex.


