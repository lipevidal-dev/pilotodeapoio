# Resumo operacional fora da tela

O `index.html` de produção tinha um CSS (`schedule-expand-hot-style`) que, com
**Mostrar resumo** ligado:

- tirava `position: sticky` da coluna de resumo
- deixava a grade com `width: max-content` e `overflow-x: visible`

A coluna “Resumo operacional” ia para depois do dia 31, fora da área visível.
A barra de rolagem ficava na página, não na grade.

`fix-resumo.sh` troca esse bloco: a grade rola por dentro e o resumo fica
preso na borda direita.
