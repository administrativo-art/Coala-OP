# Handoff: Análise de vendas (redesign)

## Overview
Tela **Análise de vendas** do Coala (rota real `/dashboard/stock/analysis/sales`).
Mostra KPIs, ranking de produtos, combos (cesta de compras), Curva ABC e um
"Painel" com 7 análises: faturamento (geral + por quiosque com metas),
faturamento por colaborador, comparativo diário, quantidade por produto por
quiosque (com detalhamento por operador), mix por linha, evolução Top 5 e
fluxo por horário, além do comparativo de quantidade mensal por quiosque.

## About the Design Files
Os arquivos deste bundle são **referências de design feitas em HTML/React (Babel in-browser)**
— protótipos que mostram o visual e o comportamento pretendidos, **não** código de
produção para colar. A tarefa é **recriar este design no codebase existente**
(`Coala-OP`, que é **Next.js + React + TypeScript + Tailwind + shadcn/ui + Recharts**),
usando os componentes e padrões já estabelecidos.

> ⚠️ Esta tela **já existe** no codebase: `src/components/sales-analysis-dashboard.tsx`.
> Este handoff é um **redesign** dela. O objetivo é aplicar o novo layout/estilo
> (tipografia Plus Jakarta Sans, cards `rounded-xl ring-1`, abas full-width, KPIs,
> seções com cabeçalho `border-b` + ícone) **mantendo toda a lógica de dados real**
> (`useSalesReports`, `useGoals`, `useKiosks`, etc.). Não troque a fonte de dados —
> só a camada de apresentação.

## Fidelity
**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos e interações são finais.
Recrie pixel-a-pixel usando os componentes shadcn já existentes (`Card`, `Tabs`,
`Select`, `Table`, `Badge`, `Popover`) e Recharts para os gráficos.

## Layout geral
- **Shell:** sidebar de ícones (68px) à esquerda + topbar fixa (56px) com título
  "Análise de Consumo", busca, data/hora, ações. Conteúdo centralizado em
  `max-w-[1280px]`, padding `px-6 py-7`.
- Botão de voltar "Voltar para gestão de estoque" (pill `bg-zinc-100`, ícone seta).
- Título `text-[30px] font-extrabold` + subtítulo `text-[13px] text-zinc-500`.

### Barra de filtros (Card `p-4`, flex wrap, items-end, gap-5)
- **Quiosque**: `<Select>` 200px — "Todos os quiosques" + lista de quiosques.
- **Período prático**: ToggleGroup — Ontem · Hoje · Mês Atual · Mês Passado · Intervalo.
  (Intervalo revela 2 inputs `type=date`.)
- **Evolução Mensal**: ToggleGroup — Período · Por Mês.
- Abaixo: badges do ano (`2026`) e do rótulo do período ("Este Mês").

### KPIs (grid 5 colunas, gap-4)
Cards `rounded-xl ring-1 p-4`: Total de cupons · Produtos vendidos (+ variação
`▼/▲ x% vs anterior`) · Faturamento (R$) · Ticket médio (R$ "por cupom") ·
Top Produto (nome + "N un").

### Abas (grid 4, container `rounded-xl bg-zinc-100/70 p-1.5`)
Painel · Ranking · Combos · Curva ABC. Aba ativa = `bg-white shadow-sm`. Ícone + label.

## Seções da aba "Painel" (na ordem)
Cada seção tem cabeçalho: `<Icon> + <h3 text-[12px] font-bold uppercase tracking-wider text-zinc-500>` com `border-b pb-2 mb-4`.

1. **Faturamento do mês** — blocos `Card`. "Geral" (sem metas) + um por quiosque
   (com metas). Cada bloco: grid 3 (Mês corrente/Semana/Hoje, com `divide-x` e
   variação colorida) + grid 2 metas (Meta alvo / Meta UP com "% atingido"
   verde≥100 / amarelo≥70 / vermelho).
2. **Faturamento por colaborador** — tabelas agrupadas por quiosque (Colaborador,
   Faturamento mês, Meta alvo, % Alvo, Meta UP, % UP).
3. **Comparativo Diário** — gráfico de barras (melhor=verde, pior=vermelho,
   hoje=índigo, demais=cor da marca) + linha de média tracejada; tabela diária
   com Unidades, Cupons, Faturamento, Ticket Médio, Variação, Top Produto e rodapé "Média".
4. **Qtde por Produto por mês — Quiosque** — multi-select (Popover, até 10 produtos);
   por quiosque, tabela Produto → Qtd; linha clicável expande detalhamento por operador (↳).
5. **Mix por Linha de Produto** — pizza + tabela (Linha, Qtd) com bolinhas de cor.
6. **Evolução de vendas — Top 5** — barras agrupadas por mês (legenda Mar/Abr/Mai).
7. **Fluxo por Horário** — por quiosque, barras 0–23h clicáveis; clique abre tabela
   de produtos da hora. Seletor "Todos os produtos" troca métrica (cupons ↔ unidades).
8. **Comparativo de quantidade de produtos vendidos** — por quiosque, barras do
   histórico mensal; seletor de 12 meses (chips); barra do "mesmo mês ano passado"
   em índigo (#6366F1), demais na cor da marca (#E91E8C).

## Abas Ranking / Combos / Curva ABC
- **Ranking**: tabela (#, Produto, Qtd ↑↓ ordenável, %) com 🥇🥈🥉 nos 3 primeiros; busca.
- **Combos**: tabela (#, itens como chips "Nx Produto", Qtd. de cupons); busca.
- **Curva ABC**: tabela (Produto, Qtd, %, Acum., Classe A/B/C como badge). A=sólido escuro, B=cinza, C=outline.

## Interactions & Behavior
- Filtros (quiosque/período) recalculam todas as seções via memo.
- Linhas de produto expandem/colapsam por operador.
- Barras de horário são clicáveis (toggle do detalhe da hora).
- Chips de mês (seção 8) e checkboxes de produto (seção 4) são toggles multi-seleção (limite 10 produtos).
- Animações sutis: `fade-in .18s`, `slide-up .25s`.

## State Management (no redesign HTML — mapeie ao real)
`kioskId`, `preset` (yesterday/today/thisMonth/lastMonth/custom), `range{start,end}`,
`evoMode`, `tab`, `rankingSearch`, `rankSort`, `abcSearch`, `comboSearch`,
`hourlyProduct`, `selectedHour{kioskId,hourStr}`, `productFilter[]`,
`productSelectOpen`, `productSearch`, `expandedRows{}`, `historyMonths[]`.
→ No codebase real esses estados já existem em `sales-analysis-dashboard.tsx`; reaproveite.

## Design Tokens
- **Fonte**: `Plus Jakarta Sans` (400–800); mono `JetBrains Mono` para datas.
- **Cor da marca (accent)**: `#E91E8C` / soft `#fdf2f8` (variável `--accent` / `--accent-soft`).
- **Paleta de gráficos**: `#E91E8C, #6366F1, #10B981, #F59E0B, #EF4444, #8B5CF6, #06B6D4, #84CC16, #F97316, #EC4899`.
- **Semânticas**: positivo `#16a34a`, negativo `#e11d48`, atenção `#ca8a04`, hoje `#6366F1`.
- **Neutros**: texto `#18181b`, secundário `zinc-500`, linhas `zinc-200`, bg `#f6f6f7`.
- **Raio**: cards `rounded-xl` (12px); pills/inputs `rounded-lg` (8px); badges `rounded-md`.
- **Card**: `bg-white ring-1 ring-zinc-200`. **Dark mode** suportado (`bg-zinc-950 ring-zinc-800`).
- **Escalas de texto**: KPI `26px/700`, título seção `12px/700 uppercase`, corpo `13px`, micro `10–11px`.

## Assets
Nenhum asset externo — todos os ícones são SVG inline (vocabulário lucide; o codebase
já usa `lucide-react`) e todos os gráficos são SVG/Recharts. Logo do Coala é um SVG inline simples.

## Files (neste bundle)
- `Coala-Analise-Vendas.html` — entrypoint (shell, sidebar, topbar, tweaks).
- `components/screen-sales.jsx` — a tela completa (filtros, KPIs, abas, 8 seções).
- `components/sales-data.jsx` — dados mock + seletores (estrutura espelha os dados reais).
- `components/sales-charts.jsx` — gráficos SVG (barras, barra+linha, pizza, histórico).
- `components/ui.jsx` — primitivos (Card, Btn, Input, Select, ícones).
- `components/tweaks-panel.jsx` — painel de ajustes (ignorável na implementação real).
- `reference/sales-analysis-dashboard.tsx` — **o componente REAL atual** do codebase (a lógica de dados a preservar).
