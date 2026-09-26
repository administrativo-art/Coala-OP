# Compras: cotação, pedido, recebimento e estoque

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e sequência

As [páginas de compras](../../../src/app/dashboard/purchasing/orders/page.tsx) e [recebimento](../../../src/app/dashboard/purchasing/receipts/page.tsx) usam a rota coringa [`/api/purchasing/[...path]`](../../../src/app/api/purchasing/%5B...path%5D/route.ts). Ela exige autenticação e escolhe a permissão por recurso/ação em [`canPostPath`](../../../src/app/api/purchasing/%5B...path%5D/route.ts), com regras em [`purchasing-permissions.ts`](../../../src/lib/purchasing-permissions.ts).

1. `POST quotations` cria cotação; `POST quotations/{id}/items` registra itens. `finalize` aceita apenas cotação em rascunho, ao menos um item selecionado, todos pertencentes à cotação e sem item livre ainda não normalizado. Atualiza cotação e itens em batch. [Rota](../../../src/app/api/purchasing/%5B...path%5D/route.ts).
2. `POST orders` cria `purchase_orders`, resolve fornecedor de `entities` quando necessário e valida contas financeiras de lançamento. `POST orders/{id}/confirm` exige status `created`, bloqueia retrocesso financeiro pendente e limita os registros relacionados lidos. No banco principal, um batch confirma o pedido e cria/reutiliza `purchase_receipts` e `purchase_financials`; depois `internalSyncExpense` tenta criar/sincronizar despesas no banco financeiro. [Rota](../../../src/app/api/purchasing/%5B...path%5D/route.ts).
3. O recebimento passa por `start-conference`, `resolve-divergence`, `save-conference`, `start-stock-entry` e `confirm-stock-entry`. A última ação lê pedido e itens, valida destino e insumo base conforme o tratamento do item, converte quantidade, grava lotes e `movementHistory` para entradas de estoque, e pode criar registros patrimoniais. Atualiza itens, recebimento, pedido e valores de `purchase_financials` usando [`computeReceiptFinancialUpdate`](../../../src/lib/purchase-receipt-financials.ts). [Rota](../../../src/app/api/purchasing/%5B...path%5D/route.ts).

## Dados, permissões e efeitos

| Local | Contrato observado |
| --- | --- |
| `quotations`, `purchase_orders`, `purchase_receipts`, `purchase_financials` no banco principal | Estados da cotação, pedido, conferência, estoque e valor confirmado. [Rota](../../../src/app/api/purchasing/%5B...path%5D/route.ts). |
| `expenses` no banco financeiro | Sincronização após confirmação e atualização posterior; conferir despesa de mercadoria e frete separadamente. [Rota](../../../src/app/api/purchasing/%5B...path%5D/route.ts). |
| `lots`, `movementHistory`, `assets`, `assetMovements` | Entradas operacionais dependem do tratamento do item: estoque, uniforme, patrimônio ou sem entrada. [Rota](../../../src/app/api/purchasing/%5B...path%5D/route.ts), [tratamento](../../../src/lib/purchasing-item-treatment.ts). |

**Comportamento na main:** confirmação executa `internalSyncExpense` após o batch principal e captura falha em log. A despesa de mercadoria nova usa ID aleatório; frete tem ID derivado do pedido. Não há `financialSyncStatus`/serviço de recuperação da correção local anterior. Bancos principal e financeiro não compartilham transação.

`confirm-stock-entry` lê recebimento/itens/pedido e monta um batch; as leituras não pertencem a uma transação que serialize confirmações concorrentes. Há guardas locais com `stockedAt` e consulta de bens existentes, mas não comprovam idempotência concorrente. Limites e rollback testados no worktree anterior não estão certificados nesta versão.

## Verificação e limites

Os [testes de finanças do recebimento](../../../tests/unit/purchase-receipt-financials.test.ts) e de [despesas de compras](../../../tests/unit/purchase-financial-expenses.test.ts) cobrem cálculos puros. Para mudanças no percurso, verificar permissões de cada ação, confirmação repetida, frete separado, divergência, parcial, tratamento do item, lote, patrimônio, movimento e sincronização financeira. Este guia não prova que todas as variantes de cancelamento/retrocesso mantêm os mesmos saldos.

## Divergência, cancelamento e retrocesso rastreados

Na [rota de compras](../../../src/app/api/purchasing/[...path]/route.ts), `getReceiptItemStatus` considera zero pendente, falta parcial e quantidade/preço/justificativa divergente (tolerâncias 0,001 em quantidade e 0,01 em preço). `resolve-divergence` distingue manter saldo pendente/reposição, encerrar falta/desconto, devolver excesso, bonificação e aceitar cobrança; atualiza quantidades/valor confirmado e pendência de entrada. Os tratamentos operacionais incluem estoque, uniforme, patrimônio e componente sem novo lote; [patrimônio](assets.md) detalha origem e controle de repetição.

`orders/{id}/revert-stage` valida motivo e limite de vínculos; bloqueia evidência de pagamento/solicitação bancária e vínculo financeiro arquivado. A transação principal aplica `getPurchaseStageReversalBlockReason`, retrocede confirmado → criado e cancela recebimentos/financeiros relacionados, guardando evento e reversão financeira pendente. Em seguida cancela despesas no banco financeiro; erro preserva `financialReversalStatus: pending` e responde 202 com aviso. Repetir retoma a reversão financeira sem recriar o evento principal. Reconﬁrmação impede continuar enquanto essa pendência existe.

`orders/{id}/cancel` exige motivo e bloqueia entrada de estoque já identificada por `receivedAt`/recebimento `stocked`. Um batch principal cancela pedido, recebimentos/itens e `purchase_financials`; outro batch financeiro cancela despesas com observação. Não há commit único entre bancos nem movimentação inversa automática. A guarda de pagamento do retrocesso não deve ser presumida nesse ramo de cancelamento. `quotations/{id}/cancel` altera a cotação; não equivale a cancelar pedidos gerados. Essas diferenças são achados para teste/política, não alterações realizadas no produto.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
