# Depósitos de caixa: lote, cobrança Inter e conciliação

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de depósitos](../../../src/app/dashboard/financial/cash-deposits/page.tsx) consulta [`GET /api/financial/cash-deposits`](../../../src/app/api/financial/cash-deposits/route.ts). A rota exige visão de depósitos, carrega lotes, ajustes, cobranças Inter, saldos de moedas e sessões de contagem elegíveis. Filtra a resposta por workspace, unidade e, para sessão física, pessoa responsável ou permissão de gestão de sessões de outros. A composição dos lotes parte de [fechamentos de caixa](cash-closures.md) pelo [repositório](../../../src/features/financial/cash-deposits/repository.server.ts).

[`POST /api/financial/cash-deposits/[batchId]/issue`](../../../src/app/api/financial/cash-deposits/%5BbatchId%5D/issue/route.ts) valida vencimento, workspace e permissão de emissão no lote; chama [`issueInterCobrancaForBatch`](../../../src/features/financial/cash-deposits/inter-service.server.ts). A emissão prepara a cobrança, fala com o Inter e guarda código/estado local. A [rota de atualização](../../../src/app/api/financial/cash-deposits/%5BbatchId%5D/refresh/route.ts) consulta a cobrança já emitida com permissão de visão. O [webhook Inter](../../../src/app/api/webhooks/inter/cobranca/route.ts) exige segredo, valida o payload, arquiva evento bruto e chama [`handleInterWebhookItem`](../../../src/features/financial/cash-deposits/inter-service.server.ts), que deduplica e reconcilia cobrança/lote e lançamentos. Há [configuração de webhook](../../../src/app/api/financial/cash-deposits/inter/webhook/route.ts) separada, com permissão de emissão.

## Dados, autorização e impacto

| Local | Efeito observado |
| --- | --- |
| `cashDepositBatches`, itens, filas e ajustes no banco financeiro | Composição, status, vínculo com fechamento e acertos. [Repositório](../../../src/features/financial/cash-deposits/repository.server.ts). |
| `interCobrancas`, `interCobrancaEvents`, `interWebhookRawEvents` | Solicitação, eventos idempotentes e payload recebido. [Serviço](../../../src/features/financial/cash-deposits/inter-service.server.ts), [webhook](../../../src/app/api/webhooks/inter/cobranca/route.ts). |
| `transactions`, `bankAccounts`, `cashClosures` e sessões de contagem | Lançamento e reconciliação após liquidação. [Serviço](../../../src/features/financial/cash-deposits/inter-service.server.ts). |

**Inferência de impacto:** emissão externa e estado local não formam transação única; reemissão e refresh devem considerar cobrança já existente no Inter. Reabrir um fechamento pode alterar a composição do lote e criar ajuste. A listagem agrega várias coleções antes de filtrar parte da resposta; mudanças em escopo de unidade e volume devem conferir custo e exposição de dados na consulta.

## Verificação e limites

Os [testes de alocação](../../../tests/unit/cash-deposit-allocation.test.ts), [conciliação](../../../tests/unit/cash-deposit-reconciliation.test.ts) e [cobrança Inter](../../../tests/unit/inter-cobranca.test.ts) são pontos de partida. Para mudanças, verificar idempotência do webhook, boleto já emitido, liquidação repetida, unidade restrita, lote alterado por reabertura e lançamento contábil. Este guia não executou cobrança ou webhook real.

## Composição, moedas e cancelamento rastreados

O [repositório](../../../src/features/financial/cash-deposits/repository.server.ts) aloca um operador aprovado pendente por vez em transação, por workspace/unidade e ordem de aprovação. Reencontrar item já alocado repara o vínculo sem duplicar. `decideCashDepositAllocation` separa não elegível, valor que exige divisão manual e capacidade do lote; ao exceder capacidade fecha o lote e cria próximo com sequência da fila. `splitOversizedCashClosure` trata divisão explícita. Ajustes de reabertura são finalizados e alocados por funções próprias, preservando vínculo com fechamento original.

`prepareCashDepositCoinHold` só aceita estados anteriores à emissão (`open`, `locked`, `failed`, `cancelled`), inteiro não negativo até total físico. Transação reduz total do boleto pelo valor separado, atualiza saldo pendente de moedas, item e evento; impede retirar moedas já trocadas. `registerCashCoinExchange` valida valor/saldo e chave idempotente: mesma chave com conteúdo divergente é rejeitada. Debita moedas e acrescenta cédulas ao lote aberto compatível ou a um novo lote, com evento transacional.

A [rota cancel](../../../src/app/api/financial/cash-deposits/[batchId]/cancel/route.ts) exige permissão de cancelamento, workspace e motivo de até 50 caracteres. [`cancelInterCobrancaForBatch`](../../../src/features/financial/cash-deposits/inter-service.server.ts) exige cobrança aceita, bloqueia paga, registra intenção, solicita cancelamento externo e faz refresh. Se a chamada falhar, consulta estado; pagamento confirmado prevalece sobre tentativa de cancelamento. A resposta local não é prova de estorno bancário. Emissão incerta tem recuperação por `seuNumero`, evitando presumir que timeout significa cobrança não criada.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
