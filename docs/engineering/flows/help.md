# Central de ajuda

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** grupo `help` traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. A conferência editorial do conteúdo com os módulos descritos permanece pendente.

## Entrada e comportamento

[`/dashboard/help`](../../../src/app/dashboard/help/page.tsx) é uma página cliente de conteúdo local. A constante `helpTopics` no próprio arquivo contém perguntas, respostas e uma tabela; o componente renderiza acordeões e cards. A página não envia requisições de API, não grava dados e não chama integração externa. O [layout do dashboard](../../../src/app/dashboard/layout.tsx) fornece a checagem geral de sessão e redireciona para login quando a pessoa não está autenticada; a página de ajuda não acrescenta permissão específica.

## Contratos e impacto

Mudanças nesta página afetam somente a apresentação e o texto de ajuda. **O texto não é fonte de regra aprovada:** algumas respostas descrevem outras áreas (estoque, preços, escalas), e essas afirmações precisam ser conferidas no fluxo correspondente antes de serem tratadas como comportamento vigente. Para alterar uma regra operacional, localizar o [grupo técnico](../flow-coverage.md) correspondente e conferir o código; para alterar apenas a explicação, revisar a precisão editorial do tópico.

## Verificação

Conferir renderização de todos os tópicos e navegação por teclado do acordeão. Não há teste específico identificado para o conteúdo desta página neste levantamento. A validação de cada resposta perante o módulo de origem ainda é necessária antes de marcar este grupo `Verificado`.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
