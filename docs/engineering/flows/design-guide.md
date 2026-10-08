# Guia de design

**Estado:** grupo `design-guide` criado junto do handoff de design de 2026-10-07; contratos estáticos e unitários conferidos e validação visual do guia aceita pelo solicitante. A adoção permanece futura e segmentada por módulo.

## Entrada e comportamento

[`/dashboard/design`](../../../src/app/dashboard/design/page.tsx) renderiza [`DesignGuide`](../../../src/components/design/design-guide.tsx), página cliente que mostra os componentes isolados do guia (botões, `StatusPill`, `Segmented`, `FilterChips`, `LiftRow`, `SidePanel`, `InlineConfirm`, `ControlPanel` e `WizardModal`) com variantes e estados demonstrativos. Não envia requisições, não grava dados e não chama integração externa.

Durante o carregamento da autenticação, a página apresenta estado neutro. Depois, o conteúdo é renderizado somente quando `isDefaultAdmin` é verdadeiro; demais perfis veem a mensagem de restrição. Essa guarda cliente não é apresentada como autorização de operação: a rota não contém dados nem ações de negócio.

## Contratos e impacto

Os tokens `--ds-*` ficam em `src/app/globals.css` e `tailwind.config.ts`. As variantes novas de `Button` são aditivas: `default`, `secondary`, `ghost`, `link` e demais variantes existentes não mudaram. A regra escrita está em [`docs/design`](../../design/README.md). O guia não implica que os componentes já sejam usados por Cadastros, Estoque, Financeiro, DP ou modais operacionais.

## Verificação

- Teste dirigido: [`tests/unit/design-guide-contract.test.ts`](../../../tests/unit/design-guide-contract.test.ts) cobre navegação do segmentado, ausência de hex solto, marcadores `data-ui` e preservação aditiva das variantes de botão.
- ESLint aplica erro de hex apenas aos componentes novos do guia e mantém o legado em aviso.
- Validação visual do guia aceita pelo solicitante em 07/10/2026. Foco real no DOM e bloqueio por perfil não possuem teste automatizado de navegador nesta entrega; a rota não contém dados nem ações de negócio.
