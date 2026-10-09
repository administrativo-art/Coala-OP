# Listas e linhas

## `LiftRow`
- Repouso: fundo transparente (o card já é branco), padding 13px 18px, divisória inferior 1px #f1eee8, `position: relative`, cursor pointer.
- **Hover (a linha sai da lista)**: `transform: translateY(-3px) scale(1.012)`, fundo #fff, raio 14, `--ds-shadow-lift`, `z-index: 3`.
- Transição: `transform .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease, border-radius .18s ease, background .18s ease`.
- Em tabela: `scale(1.006)`.
- **O contêiner não pode ter `overflow: hidden`**, senão a sombra e o lift são cortados.
- Selecionada (painel aberto): fundo #fbf3f6 + `box-shadow: inset 3px 0 0 #a6325b`.
- Respeitar `prefers-reduced-motion`: sem transform, só fundo e sombra.

## Comportamento
- A linha inteira é o alvo do clique e abre o `SidePanel`. Clicar em outra linha troca o conteúdo do painel.
- Sem ícones de ação na linha. Exceção: o checkbox de seleção em massa (com `stopPropagation`).
- Ações em massa: barra fixa no rodapé da tela com contagem e ações; nunca no fim da lista.

## Lote (Controle de Estoque)
Uma linha: [lote em mono 12.5/700 + StatusPill] · [quiosque 13/600 / local 12 #6e737a] · [VALIDADE kicker + data em mono] · [quantidades 19/800 + unidade 12 #5f646c] · "›".
Reserva: abaixo, separada por borda tracejada, com "Reserva ativa · N" (12/800 #1d4ed8) e pills de destino ("Em processamento" quando ainda não há destino).
Quantidades: se `unit` = un e `packageSize` = 1, mostrar só "N unidades"; senão, "total na unidade" + "N embalagens". Mostrar caixas se houver `multiplo_caixa`. Converter g→kg e ml→L acima de 1000.

## Agrupamento
- Título do grupo: caixa alta 19/800, total em #a6325b à direita, conversões em pills #e6e3dc separadas por "→".
- Totais equivalentes (302 un = 302 unidades) aparecem uma vez só.
- Ordem dos lotes: validade mais próxima primeiro; sem validade por último.

## Card de produto
Fundo #fff, borda #e3dfd6, raio 18. Cabeçalho com miniatura 44×44 (raio 12), nome 15.5/800 e uma linha de especificação: "Marca · Embalagem com Nunid · 1 Caixa = N … · EAN …".

## Vazio
- Sem dados: texto + ação principal.
- Sem resultado por filtro: só texto, em caixa tracejada (#d6d2c8), raio 18.
