# Unificação: kit de Cadastros × guia (`patterns/`)

Mapa de equivalência medido em 08/10/2026 sobre `src/components/cadastros/cadastros-ui.tsx` e `src/components/patterns/`. Comportamento observado no código; não é decisão aprovada (ver `decisoes/0005-fonte-unica-de-padroes.md`).

## Achado geral

O kit de Cadastros não usa nenhum token `--ds-*`: tem cores em hex dentro das classes. Os hex vêm em parte da paleta v3 e em parte coincidem com a v4 do guia. Por isso "trocar hex por token" não é neutro em tudo: há diferenças visuais reais, listadas abaixo.

## Peça a peça

| Kit (Cadastros) | Guia | Situação | Diferenças medidas |
|---|---|---|---|
| `DetailDrawer` | `SidePanel` + `PanelField` | Diferença de geometria | Kit: flutuante (inset 12px, raio 20), 420px, título 30/800, kicker `#8e8d99`, véu `rgba(24,20,14,.18)`. Guia: altura total, 460px, título 20/800, kicker `--ds-accent-kicker`, véu `--ds-scrim`. O kit embute ações, aviso e hero; o guia só oferece casca e `PanelField`. |
| `DrawerNotice` kind `confirm` e botões "Confirmar/Cancelar" | `InlineConfirm` | Equivalente em função | O guia entrega foco inicial em Cancelar, retorno de foco e `role="group"`. O kit usa `role="alert"` e não move o foco. |
| `ListRow` | `LiftRow` | Quase idêntico | Elevação no hover: kit -2px / scale 1,004; guia -3px / 1,012 (1,006 em tabela). Selecionada: kit `#fbeef3`; guia `--ds-accent-row` (`#fbf3f6`). Kit não respeita `prefers-reduced-motion`; guia sim. Kit recebe `template` de grid e `aria-label`; `LiftRow` não tem `template`. |
| `StatusDot` (ponto + texto) | `StatusPill` | Representações diferentes | Guia: pílula 21px com cinco variantes. Kit: ponto 8px + texto 12,5px. |
| `TagChip` / `DrawerChip` (tons `pink`, `ok`, `warn`, `violet`, `off`) | `StatusPill` | Parcial | Tons do kit em hex próprios (`#fbe7ef`, `#d1fae5`, `#fef3c7`, `#ede9fe`); o guia só tem `ok`, `warn`, `danger`, `neutral`, `info`. `pink` e `violet` não existem no guia. |
| `CadastrosHero` | `ControlPanel` + `FilterChips` + `Segmented` | Diferente | Ação principal: kit `#e0457f` (hover `#c93a6f`); guia `--ds-accent` `#d13670` (hover `#b8325f`). Chip ativo: kit creme `#f3f2ee`; guia rosa `--ds-accent`. Raio: kit 28px; guia `rounded-ds-panel`. O guia não tem busca nem seletor ativo/inativo no painel. `estado-atual.md` diz que o guia não substitui o `CadastrosHero`. |
| `CadastrosTabs` | `ControlIndicator` (parcial) | Diferente | Abas com contagem grande em mono; guia tem indicadores que filtram, sem `role="tablist"`. |
| `ResultsBar` (alternância Lista/Grade) | `Segmented` | Substituível | Só o trilho segmentado; o contador "N de M" não existe no guia. |
| `BulkBar` | — | Só existe no kit | `listas.md` prevê "barra fixa no rodapé", mas não há componente no guia. Candidato a absorção. |
| `SelectBox` | — | Só existe no kit | Caixa de seleção própria, rosa `#a6325b`. |
| `ListShell` / `ListHead` | — | Só existe no kit | O guia descreve o contêiner da lista, sem componente. |
| `GridCard` / `CardGrid` / `CardFooterLabel` | — | Só existe no kit | Sem equivalente no guia. |
| `EmptyResults` | — | Só existe no kit | `listas.md` descreve a caixa tracejada `#d6d2c8`; o kit usa texto + botão sem caixa tracejada. |
| `ListSkeleton`, `SoftPill`, `Mono`, `Chevron` | — | Utilitários | Sem equivalente. |

## Modais

Os modais de Cadastros (`entity-management.tsx`, `entity-ficha-modal.tsx`) usam `Dialog` com classes próprias (1080px, raio 26, fundo `#faf9f6`, stepper próprio). As medidas de casca coincidem com o contrato do `WizardModal`. Nenhum modal de Cadastros usa `WizardModal` hoje. A equivalência de comportamento (foco, descarte, rodapés) **não foi comparada** e fica como lacuna.

## Diferenças que exigem decisão

1. **Cor da ação principal da página:** `#e0457f` (kit) ou `#d13670` (guia v4).
2. **Chip ativo no painel:** creme (kit) ou rosa (guia).
3. **Painel lateral:** flutuante 420px com título grande (kit) ou altura total 460px (guia).
4. **Status na lista:** ponto + texto (kit) ou pílula (guia).
5. **Peças só do kit** (`BulkBar`, `SelectBox`, lista/grade, vazio): entram no guia como padrões novos ou ficam locais.

## Resultado da unificação (08/10/2026)

- `cadastros-ui.tsx` compõe `ControlPanel`, `FilterChips`, `LiftRow`, `SidePanel`, `InlineConfirm`, `Segmented`, `StatusPill` e `Button`. A API pública do kit não mudou.
- `BulkBar` e `SelectBox` viraram `patterns/bulk-bar.tsx` e `patterns/select-box.tsx`. `InlineConfirm` ganhou `loadingLabel`.
- O kit não tem hex solto. O lint trata hex em `src/components/cadastros/` como erro e `tests/unit/design-unification-contract.test.ts` trava a regressão.
- Desvios conscientes: o seletor Ativos/Inativos do painel escuro e o hero do painel lateral continuam locais (o guia não tem equivalente); `EmptyResults` mantém o botão "Limpar filtros" (o guia pede só texto); `ListShell` mantém `overflow-hidden` para a rolagem horizontal, o que corta a sombra do lift nas bordas.

## Pendências

- Modais de Cadastros (`entity-management`, `entity-ficha-modal`, `add-edit-*`) ainda usam `Dialog` com hex próprio, sem `WizardModal`. Falta comparar o comportamento antes de migrar.
- Validação visual com capturas e e2e (`minimum-stock-supply.spec.ts`) não rodaram.
