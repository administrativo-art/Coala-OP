# Estado atual × destino

Retrato do worktree `Coala-OP-design-guide`, branch `feat/design-guide-tokens-20261007`, em 07/10/2026.

## Entregue neste PR do guia

| Peça | Estado |
|---|---|
| Tokens | Namespace `--ds-*`, paleta v4 e classes Tailwind aditivas |
| Botões | Variantes novas sem alterar `default`, `secondary`, `ghost` ou `link` |
| Guia vivo | `/dashboard/design`, renderizado apenas para administrador autenticado |
| Padrões | `ControlPanel`, `FilterChips`, `Segmented`, `LiftRow`, `SidePanel`, `InlineConfirm` e `WizardModal` demonstráveis |
| Status | `StatusPill` com variantes semânticas e helper de validade |
| Contrato visual | documentação em `docs/design/`, marcadores `data-ui` e teste unitário permanente |
| Lint | hex proibido como erro em `patterns/`, `design/` e `StatusPill`; legado permanece em aviso |

`ControlPanel` e `WizardModal` são implementações isoladas do guia. Eles não significam que Cadastros, Estoque, Financeiro ou os modais reais já foram migrados.

## Adoção posterior (08/10/2026, ainda sem commit)

Barra lateral do Coala One e da Programação do Instagram no padrão flutuante e recolhida, painel escuro com chips que vira faixa ao rolar, painel de post em etapas com prévia no celular e a lista detalhada de posts. Detalhes em [barra-lateral.md](barra-lateral.md) e [cabecalho-e-etapas.md](cabecalho-e-etapas.md). Sem validação visual em navegador nem E2E executado; `validacao-visual.md` não foi preenchido para essas telas.

## Fora deste PR

- alterar `PageContainer`, `PageHeader`, `BackButton`, `safeReturnTo` ou o histórico do Next;
- substituir `CadastrosHero` ou unificar painéis escuros operacionais;
- migrar diálogos nativos legados;
- migrar Estoque, Financeiro, DP ou qualquer cadastro real;
- remover `PageContainer surface`;
- executar validação visual de uma tela operacional.

Esses itens são etapas futuras de adoção e exigem inventário, implementação e testes próprios. O alvo de longo prazo para estrutura e navegação está em `estrutura-e-navegacao.md`; ele não descreve o comportamento atual de todas as telas.

O handoff v5 também detalha `safeReturnTo`, `NavigationTracker`, fixtures autenticados de Playwright, seed de Estoque e a migração dos diálogos nativos qualificados. Essas correções foram preservadas como referência de adoção, mas não autorizam mudanças nesses fluxos dentro do PR isolado do guia.

## Acessibilidade entregue nos padrões isolados

| Componente | Contrato |
|---|---|
| `Segmented` | `radiogroup`, roving `tabIndex`, setas, Home e End |
| `InlineConfirm` | `role="group"`, pergunta nomeada, anúncio polido, foco inicial em Cancelar e retorno opcional por ref |
| `LiftRow` | Enter/Espaço na linha pura; `interactive={false}` para linhas com controles filhos; foco rosa |
| `SidePanel` | Radix Dialog, nome/descrição, Esc, foco preso e retorno ao acionador |
| `WizardModal` | Radix Dialog, × nomeado, stepper com `aria-current`, confirmação inline ao descartar |

Testes DOM com Testing Library não foram acrescentados porque essas dependências não existem no projeto. O contrato de navegação pura e os invariantes de fonte são cobertos por `tests/unit/design-guide-contract.test.ts`. Quando uma tela real adotar os componentes, teclado e foco devem ganhar teste de componente ou E2E no ambiente autenticado.

## Decisões

- Fechadas: `0001` (rosa em páginas e índigo em modais) e `0002` (`--ds-bg-page` #f0eee9).
- Abertas e funcionais: `0003` (Todos os quiosques) e `0004` (permissão de transferência). Não afetam o guia isolado e não foram decididas neste trabalho.
