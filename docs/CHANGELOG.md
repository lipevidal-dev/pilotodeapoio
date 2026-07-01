# Changelog — Escala Piloto de Apoio v2

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

## [1.0.0] — 2026-06-30

Release principal de backup — motor NEXT, admin operacional e escala visual.

### Adicionado

- Turnos em instrução (TI6–TI9) no cadastro e na grade (cor amarela, legenda)
- Exclusão de folga pedida na escala (Shift+clique, confirmação forçada)
- Folga social visual em sábado+domingo (qualquer tipo de folga, cor verde)
- Blocos mínimos de 3 dias consecutivos para T6/T7 no motor NEXT
- Hover detalhado nas células da grade, legenda completa de turnos
- Identidade visual admin (logos, favicon, tema GOL)

### Alterado

- Motor NEXT: cobertura T6/T7 prioriza blocos antes de turnos isolados
- Agrupamento configurável de turnos com piso mínimo de 3 dias (T6/T7)
- Cores das alocações restauradas na grade

### Técnico

- Migration `employee_in_instruction`
- Tag Git: `v1.0.0` / `backup-principal-2026-06-30`
- Branch: `clean-motor-reset`
