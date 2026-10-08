# Seleção e filtros

## Segmentado (`Segmented`)
Trilho #e6e3dc, padding 3px, raio 11. Opção: 32px de altura, padding 0 14px, 13/700, raio 9. Ativa: fundo #fff, texto `--ds-ink`, `0 1px 2px rgba(0,0,0,.08)`. Inativa: transparente, #5f646c.
Para 2 ou 3 opções exclusivas que mudam a visualização (Cards/Tabela, Lista/Grade, tipo de baixa). Troca imediata.

## Chips de categoria (`FilterChips`, sobre o painel escuro)
34px, padding 0 14px, raio 999, 13/700. Inativo: borda rgba(255,255,255,.12), texto #c8c7d0. Ativo: fundo e borda #d13670, texto #fff.
A contagem fica dentro do chip (11.5/800). Um ativo por vez; "Todas" sempre primeiro. A contagem respeita busca, quiosque e status, mas não a própria categoria.

## Indicadores-filtro (painel escuro)
Grade de 5 colunas. Número 34/800 conforme o `tone` semântico (`warning`, `danger`, `info`, `neutral`); valor zero usa `--ds-indicator-zero` #77768a. Rótulo 13/700.
Clicável quando corresponde a um filtro. Ativo: borda inferior de 2px na cor do indicador, fundo rgba(255,255,255,.05) e o texto "filtrando".

## Filtros ativos
Pills removíveis ao lado da contagem de resultados: 26px, borda #e3dfd6, fundo #fff, 12/700, "×" em #6e737a.

## Escolha em formulário (modais)
Pill 40px, mínimo 56–64px de largura, 14/700. Ativa: 2px #5b5bd6, fundo #eeeefc, texto #3f3fb0. Inativa: 1px #dcd9d1, fundo #fff, texto #4a4f57.
Unidades com sigla usam quadrados fixos de 120×120 (sigla + nome completo).

## Menu suspenso
Largura 230–260px, padding 6, raio 14, borda #e3dfd6, `--ds-shadow-menu`. Item: 36–38px, raio 9, 13px. Item atual: fundo #fbe7ef, peso 700, "✓" em #a6325b. Hover: #f6f4ef. Kicker opcional 10.5/800 caixa alta #6e737a.
