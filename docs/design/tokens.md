# Tokens

Definidos em `src/app/globals.css` (bloco “Guia de design do Coala”) e expostos no `tailwind.config.ts`.

## Namespace

Todos os tokens do guia usam o prefixo **`--ds-`**. O projeto já tem tokens shadcn em HSL com nomes como `--accent`, `--border` e `--background`; o guia não sobrescreve esses nomes.

No Tailwind (`theme.extend.colors.ds`), as chaves são curtas e não repetem o nome completo da variável:

| Variável CSS | Classe Tailwind |
|---|---|
| `--ds-bg-page` · `--ds-bg-topbar` | `bg-ds-page` · `bg-ds-topbar` |
| `--ds-surface` · `-warm` · `-input` · `-muted` · `-seg` | `bg-ds-surface` · `bg-ds-warm` · `bg-ds-input` · `bg-ds-muted` · `bg-ds-seg` |
| `--ds-surface-dark` · `-dark-hover` | `bg-ds-dark` · `bg-ds-dark-hover` |
| `--ds-border` · `-border-input` · `-divider` · `-border-footer` | `border-ds-border` · `border-ds-border-input` · `border-ds-divider` · `border-ds-border-footer` |
| `--ds-ink` · `-ink-2` · `-ink-muted` · `-ink-faint` | `text-ds-ink` · `text-ds-ink-2` · `text-ds-ink-muted` · `text-ds-ink-faint` |
| `--ds-ink-on-dark` · `-2` · `-muted` · `-sub` | `text-ds-on-dark` · `text-ds-on-dark-2` · `text-ds-on-dark-muted` · `text-ds-on-dark-sub` |
| `--ds-indicator-zero` | `text-ds-indicator-zero` |
| `--ds-accent` · `-hover` · `-ink` · `-ink-hover` · `-soft` · `-row` | `bg-ds-accent` · `bg-ds-accent-hover` · `text-ds-accent-ink` · `text-ds-accent-ink-hover` · `bg-ds-accent-soft` · `bg-ds-accent-row` |
| `--ds-accent-kicker-dark` | `text-ds-accent-kicker` |
| `--ds-modal-accent` · `-soft` · `-ink` | `bg-ds-modal` / `border-ds-modal` · `bg-ds-modal-soft` · `text-ds-modal-ink` |
| status `--ds-{ok,warn,danger,info,neutral}` e `-bg` | `text-ds-ok` · `bg-ds-ok-bg` etc. |
| `--ds-alert-*` · `--ds-confirm-*` · `--ds-disabled` | `bg-ds-alert-bg` · `border-ds-alert-border` · `text-ds-alert-ink` · equivalentes de `confirm` · `bg-ds-disabled` |
| raios `--ds-r-*` | `rounded-ds-pill` · `-sm` · `-md` · `-btn` · `-btn-lg` · `-card` · `-card-lg` · `-modal` · `-panel` |
| sombras `--ds-shadow-*` | `shadow-ds-lift` · `-menu` · `-modal` · `-panel` · `-cta` · `-side` |
| fontes | `font-ds` (Inter Tight) · `font-ds-mono` (JetBrains Mono) |
| movimento | `ease-ds-lift` |

`rounded-ds-pill` e `--ds-indicator-zero` já estão implementados. O token antigo `ink-step` não existe; use `ink-muted`.

## Cores v4

| Token | Valor | Uso |
|---|---|---|
| `--ds-bg-page` | #f0eee9 | Fundo de página |
| `--ds-bg-topbar` | #f3f1ec | Barra superior |
| `--ds-surface` | #ffffff | Cards, tabelas e campos |
| `--ds-surface-warm` | #fffdf9 | Painel lateral e notas |
| `--ds-surface-input` | #faf9f6 | Formulário do modal |
| `--ds-surface-muted` | #f6f4ef | Hover e cabeçalho de tabela |
| `--ds-surface-seg` | #e6e3dc | Trilho segmentado |
| `--ds-surface-dark` | #15151c | Painel de controle e lateral do modal |
| `--ds-surface-dark-hover` | #2a2a35 | Hover do primário escuro |
| `--ds-border` | #e3dfd6 | Bordas gerais |
| `--ds-border-input` | #dcd9d1 | Borda de campo |
| `--ds-divider` | #f1eee8 | Divisória de linhas |
| `--ds-border-footer` | #e6e2da | Divisória de modal |
| `--ds-ink` | #1a1b1f | Texto principal |
| `--ds-ink-2` | #4a4f57 | Rótulos de campo |
| `--ds-ink-muted` | #5f646c | Texto secundário |
| `--ds-ink-faint` | #6e737a | Terciário somente sobre superfícies claras |
| `--ds-ink-on-dark` | #f3f2ee | Texto sobre escuro |
| `--ds-ink-on-dark-2` | #c8c7d0 | Secundário sobre escuro |
| `--ds-ink-on-dark-muted` | #8e8d99 | Kicker e notas sobre escuro |
| `--ds-ink-on-dark-sub` | #a9a8b3 | Especificação sobre escuro |
| `--ds-indicator-zero` | #77768a | Indicador zerado em texto grande |
| `--ds-accent` | #d13670 | Ação principal da página e chip ativo |
| `--ds-accent-hover` | #b8325f | Hover do primário rosa |
| `--ds-accent-ink` | #a6325b | Link, kicker e foco em superfície clara |
| `--ds-accent-ink-hover` | #8e294d | Hover de link |
| `--ds-accent-soft` | #fbe7ef | Seleção suave em página |
| `--ds-accent-row` | #fbf3f6 | Linha selecionada |
| `--ds-accent-kicker-dark` | #f08bb1 | Kicker e foco sobre escuro |
| `--ds-modal-accent` | #5b5bd6 | Seleção e progresso dentro do modal |
| `--ds-modal-accent-soft` | #eeeefc | Seleção suave no modal |
| `--ds-modal-accent-ink` | #3f3fb0 | Texto selecionado no modal |
| `--ds-ok` / `--ds-ok-bg` | #147337 / #e8f5ee | Em dia, ativo e concluído |
| `--ds-warn` / `--ds-warn-bg` | #c2410c / #fff1e6 | Vencendo e pendente |
| `--ds-danger` / `--ds-danger-bg` | #be123c / #ffe4e8 | Vencido, erro e destrutivo |
| `--ds-info` / `--ds-info-bg` | #1d4ed8 / #eef3fe | Reserva e informação |
| `--ds-neutral` / `--ds-neutral-bg` | #5f646c / #eceae5 | Indefinido, desativado e ignorado |
| `--ds-alert-*` | bg #fff7e6 · border #f5d9a3 · ink #6b4500 | Aviso não bloqueante |
| `--ds-confirm-*` | bg #fff1f3 · border #fecdd6 · ink #881337 | Confirmação destrutiva inline |
| `--ds-disabled` | #b9b8c2 | Fundo de controle desabilitado |

Seleção usa rosa em páginas e índigo em modais, conforme `decisoes/0001-cor-de-selecao.md`. O rosa forte aparece uma vez por área; cores de status não são decorativas.

## Contraste verificado

| Par | Razão |
|---|---:|
| branco sobre `accent` | 4,70:1 |
| branco sobre `accent-hover` | 5,74:1 |
| `ink-muted` sobre `bg-page` / `surface` / `neutral-bg` / `surface-seg` | 5,14 / 5,96 / 4,95 / 4,65 |
| `ink-faint` sobre `surface` / `surface-input` / `surface-warm` | 4,78 / 4,54 / 4,70 |
| `ok` sobre `ok-bg` | 5,29:1 |
| `warn` sobre `warn-bg` | 4,68:1 |
| `danger` sobre `danger-bg` | 5,24:1 |
| `info` sobre `info-bg` | 6,03:1 |
| `modal-accent-ink` sobre `modal-accent-soft` | 7,17:1 |
| `accent-ink` sobre `accent-soft` / `bg-page` | 5,51 / 5,61 |
| branco sobre `modal-accent` | 5,37:1 |
| `ink-on-dark-muted` sobre `surface-dark` | 5,55:1 |
| `indicator-zero` sobre `surface-dark` | 4,10:1; permitido porque o indicador tem 34px e peso 800 |

Qualquer par novo deve ser calculado e registrado antes da adoção.

## Tipografia

Inter Tight (`@fontsource-variable/inter-tight`) é a família da interface. JetBrains Mono, carregada em `src/app/layout.tsx`, é usada para lotes, códigos, documentos, datas tabulares e horários; Geist Mono é fallback.

| Papel | Tamanho / peso / tracking |
|---|---|
| Indicador | 34 / 800 / −4% |
| Título da página | 24 / 800 / −2,5% |
| Título de grupo | 19 / 800 / caixa alta |
| Nome do item | 15,5 / 800 |
| Interface | 13–14 / 600–700 |
| Secundário | 12–12,5 / 400 / `ink-muted` |
| Kicker | 10,5 / 800 / +16% / caixa alta |

## Raios, sombras e movimento

- Raios: `pill` 999 · `sm` 9 · `md` 11 · `btn` 12 · `btn-lg` 14 · `card` 18 · `card-lg` 20 · `modal` 26 · `panel` 28.
- Sombras: `lift`, `menu`, `modal`, `panel`, `cta` e `side`; repouso usa borda, não sombra.
- Hover-lift: `--ds-ease-lift` e `--ds-dur`; transformações são removidas com `prefers-reduced-motion`.

## Espaçamento e largura

Escala base: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28 e 36px. As larguras canônicas do `PageContainer` são `compact` 1220px, `default` 1440px, `wide` 1600px e `fluid` sem limite.

Adotar `PageContainer` em toda página interna é um alvo arquitetural. Este PR entrega o guia e não migra as telas operacionais existentes.
