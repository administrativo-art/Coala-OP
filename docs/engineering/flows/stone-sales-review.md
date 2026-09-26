# Stone: consulta de antecipações e comparação PDV × Stone

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Antecipações (`stone`)

A [página de antecipações](../../../src/app/dashboard/financial/stone-anticipations/page.tsx) monta [`AnticipationWorkspace`](../../../src/features/financial/agent/anticipation-workspace.tsx). O usuário seleciona vínculo, StoneCode, data e uma pergunta guiada. A tela carrega vínculos e catálogos paginados em [`/api/financial/stone-mappings`](../../../src/app/api/financial/stone-mappings/route.ts); editar vínculo usa POST com unidade, conta, códigos, vigência, revisão e justificativa. A consulta usa [`POST /api/financial/agent`](../../../src/app/api/financial/agent/route.ts). A rota exige administrador padrão, limita corpo, chama [`runFinancialAgent`](../../../src/features/financial/agent/service.ts), lê XML da agenda Stone via [`fetchStoneAgendaXml`](../../../src/lib/integrations/stone/agenda-transport.ts) e pode usar priorização por IA somente quando `ENABLE_AI_FEATURES=true`. A tela declara que a consulta não executa antecipação nem lança valores no caixa/DRE; salvar vínculo altera seu cadastro e auditoria.

## Comparação de vendas (`sales-reconciliation`)

A [página PDV × Stone](../../../src/app/dashboard/financial/sales-reconciliation/page.tsx) monta [`SalesReviewPage`](../../../src/features/financial/sales-reconciliation/review-page.tsx), restrita na tela ao administrador padrão. Ela carrega o vínculo oficial, escolhe unidade/StoneCode/dia e chama [`POST /api/financial/pdv-stone-review`](../../../src/app/api/financial/pdv-stone-review/route.ts). A rota repete a autorização de administrador e chama [`queryDailySales`](../../../src/features/financial/sales-reconciliation/query.ts) com fontes PDV, agenda Stone e Pix validado, limitando a duração da consulta. A página confere IDs do vínculo/conta/escopo na resposta e apresenta sugestões de correspondência, divergências e apontamentos de fonte. O resultado é somente leitura; não confirma banco, lança pagamento nem fecha venda automaticamente.

## Dados, dependências e verificação

Os dois fluxos dependem do vínculo Stone/unidade/conta em [`configuration.server.ts`](../../../src/features/financial/agent/configuration.server.ts), das credenciais usadas apenas no servidor e de dados externos que podem chegar atrasados. O [guia de recebíveis](receivables-stone.md) cobre previsões de recebimento, com semântica diferente da comparação diária. `npm run check` passou na verificação anterior do mapa (2026-09-25). Referências iniciais: [autorização de carteira Stone](../../../tests/unit/stone-portfolio-auth.test.ts), [período de recebíveis](../../../tests/unit/stone-receivable-period.test.ts) e [E2E de comparação](../../../tests/e2e/financial/pdv-stone-review.spec.ts). Antes de elevar os grupos, conferir origem Pix, vigência do vínculo, paginação, limite de 500 eventos por fonte, timeouts, dados divergentes e custo de chamadas externas.

## Serviço, vínculos e correspondência rastreados

[`runFinancialAgent`](../../../src/features/financial/agent/service.ts) aceita apenas intenção `review_anticipations`, valida administrador e vínculo novamente no serviço e consulta revisão XML por data de pagamento. Cálculo/linhas são determinísticos; IA recebe apenas contagens e IDs de ações para reordenar a lista permitida, com validação de cardinalidade/IDs e fallback. Não altera valores nem grava caixa/DRE. [`configuration.server`](../../../src/features/financial/agent/configuration.server.ts) lista catálogos por página e salva `stoneMerchantMappings` em transação com revisão esperada, validação de vínculos/vigências e evento de auditoria. Mudança concorrente exige recarregar.

[`queryDailySales`](../../../src/features/financial/sales-reconciliation/query.ts) valida data já publicada, vínculo oficial/filial, coleta PDV e Stone e revalida vínculo após coleta; alteração durante consulta é conflito. [Matching](../../../src/features/financial/sales-reconciliation/matching.ts) usa identificador de provedor, NSU/autorização/terminal e pedido; conflito ou multiplicidade impede correspondência alta. Candidatos por janela/valor podem formar grupos, mas totais iguais sozinhos não resolvem identificação ambígua. Casos distinguem só-PDV/só-Stone, unidade não mapeada/diferente, valor, status e ambiguidades, sempre `pending_review`.

[Pix](../../../src/features/financial/sales-reconciliation/pix-source.server.ts) lê snapshot de `stonePixConciliationFiles` e até 501 linhas em transação somente leitura; máximo aceito 500. [`reviewPixSnapshot`](../../../src/features/financial/sales-reconciliation/pix-source.ts) confere documento/workspace/dia/hash/contagem/unicidade, StoneCode/terminal, IDs de evento/e2e, status pago, valores coerentes e ausência de estorno. Incompleto vira `pending`; registros inválidos são excluídos, não transformados em venda confirmada. A rota tem timeout de 110 segundos. Correspondências não persistem baixas financeiras. Testes de fonte ausente, duplicata, atraso e mudança de vínculo continuam necessários.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
