# Caixa financeira: recebimento, análise e vínculo

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

O [webhook Resend](../../../src/app/api/webhooks/resend/route.ts) encaminha e-mails destinados à caixa financeira para [`ingestFinancialEmail`](../../../src/features/financial/inbox/ingest.server.ts). A função evita duplicidade pelo ID do e-mail, busca conteúdo e anexos no provedor, arquiva `.eml` e anexos permitidos em Storage, classifica a mensagem e grava `financialInboxMessages/{id}` com evento `EMAIL_RECEIVED` no mesmo batch. Mensagem de marketing pode ser ignorada automaticamente; mensagem com link e sem documento arquivado fica `document_pending`. A análise automática posterior roda separadamente e registra falha em evento.

A [tela da caixa](../../../src/features/financial/inbox/financial-inbox-page.tsx) consulta [`GET /api/financial/inbox`](../../../src/app/api/financial/inbox/route.ts) com filtros, busca e cursor. A [consulta](../../../src/features/financial/inbox/repository.server.ts) limita a página a 50, usa índice de busca quando disponível e informa quando a busca limitada foi truncada. A rota exige autenticação e `financial.view` + `financial.inbox.view` (ou administrador padrão), restringindo pelo `workspace_id`.

| Ação | Guarda e efeito observados |
| --- | --- |
| Abrir e revisar | [`GET/PATCH /api/financial/inbox/[id]`](../../../src/app/api/financial/inbox/%5Bid%5D/route.ts) confere workspace; descarte exige `financial.inbox.discard`. [Repositório](../../../src/features/financial/inbox/repository.server.ts). |
| Analisar | [`POST /api/financial/inbox/[id]/analyze`](../../../src/app/api/financial/inbox/%5Bid%5D/analyze/route.ts) exige `financial.inbox.analyze` e chama [workflow](../../../src/features/financial/inbox/workflow.server.ts), que compara despesa, provisão, obrigação e pedidos bancários existentes. |
| Vincular ou criar despesa | [`POST /api/financial/inbox/[id]/link`](../../../src/app/api/financial/inbox/%5Bid%5D/link/route.ts) exige `financial.inbox.link` e permissões de criação/edição de despesas; o [workflow](../../../src/features/financial/inbox/workflow.server.ts) vincula à despesa existente ou cria a sugerida e ajusta obrigação. |
| Preparar pagamento por código de barras | [`POST /api/financial/inbox/[id]/payment`](../../../src/app/api/financial/inbox/%5Bid%5D/payment/route.ts) exige permissões de caixa, despesa e solicitação de pagamento; chama [serviço de pedidos](../../../src/features/financial/payment-requests/service.server.ts). Preparar não autoriza a execução bancária. |

## Descarte, arquivamento e restauração

[`bulk-review`](../../../src/app/api/financial/inbox/bulk-review/route.ts) aceita de 1 a 50 IDs e somente estado `ignored`, exigindo `financial.view`, `inbox.view` e `inbox.discard`. [`reviewFinancialInboxMessages`](../../../src/features/financial/inbox/repository.server.ts) lê todos os documentos selecionados dentro de uma transação, confere workspace e elegibilidade, e grava resolução/estado com evento. Mensagem vinculada ou com pedido de pagamento pode tornar a seleção inteira conflitante. Reabrir como `pending_review` exige estado anterior `ignored`.

A [rota de manutenção](../../../src/app/api/jobs/financial-inbox/maintenance/route.ts) confere token de job por comparação constante, aceita `dry-run` como padrão e lote até 400. [`maintainFinancialInbox`](../../../src/features/financial/inbox/maintenance.server.ts) atualiza índices/versão de resolução e arquiva tratados em lote de até 200, com releitura transacional e evento. A [política implementada](../../../src/features/financial/inbox/retention-policy.ts) arquiva `ignored`, `identified` e `reconciled` sem atualização há seis meses; calcula elegibilidade de expurgo em um, seis ou dez anos conforme classe. **Esse código calcula data de elegibilidade; o job observado não apaga os arquivos. Os prazos são comportamento do código, não aprovação jurídica ou de negócio.**

A [restauração](../../../src/app/api/financial/inbox/[id]/restore/route.ts) exige as mesmas permissões de descarte. Em transação, confere workspace e `archivedFromStatus`, restaura estado anterior, limpa metadados de retenção e cria evento. Atualizar `updatedAt` passa a influenciar a próxima elegibilidade de arquivamento. Conferir a política desejada antes de alterar esse comportamento.

## Dados e dependências

`financialInboxMessages` guarda estado, classificação, anexos, vínculos, resolução e eventos; Storage guarda originais e anexos. O [workflow](../../../src/features/financial/inbox/workflow.server.ts) também lê/escreve `expenses` e `financialObligations`, de modo que a caixa interfere em obrigações e pagamentos. O [job de manutenção](../../../src/app/api/jobs/financial-inbox/maintenance/route.ts) cuida de tarefas posteriores; suas condições devem ser conferidas quando se alterar retenção ou estados. A [revisão em lote](../../../src/app/api/financial/inbox/bulk-review/route.ts) também altera resoluções.

**Inferência de impacto:** arquivamento em Storage ocorre antes do batch que cria a mensagem; falha entre os dois pode deixar arquivo órfão. A análise automática ocorre depois da gravação e pode falhar independentemente. Alterar classificação, vínculo ou descarte requer preservar rastreabilidade e impedir que uma mensagem descartada volte a criar obrigação ou pedido.

## Verificação e limites

Os [testes de segurança de pagamento da caixa](../../../tests/unit/financial-inbox-payment-safety.test.ts), [retenção](../../../tests/unit/financial-inbox-retention.test.ts) e [resolução](../../../tests/unit/financial-inbox-resolution-contract.test.ts) passaram em execução dirigida: 22/22. Parte desses testes verifica estrutura de código; eles não demonstram uma integração real de banco/Storage/provedor. Para mudanças, conferir duplicidade de webhook, anexos acima do limite, workspace, permissões distintas de análise/vínculo/descarte, busca paginada, idempotência da criação de despesa e separação entre pedido e autorização bancária. Não houve execução de webhook real ou conciliação bancária neste levantamento.

## Preparação de pagamento e exceções rastreadas

[`POST /inbox/{id}/payment`](../../../src/app/api/financial/inbox/[id]/payment/route.ts) exige, além de visão financeira/caixa, edição de despesa e visão/criação de pedidos de pagamento. [`createInboxBarcodePaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) confere workspace, ausência de liquidação/pagamento bancário prévio, mensagem principal `linked`, despesa vinculada, código normalizado, vencimento, agendamento não passado e valor inteiro positivo. Recusa agendar depois de vencimento ainda futuro. Pedido pré-existente pela mesma origem é retornado.

Cria pedido de ID determinístico, muda mensagem para `awaiting_authorization` e grava `BANK_PAYMENT_PREPARED` no mesmo batch. Corrida de criação trata `already-exists` relendo pedido. Evento adicional do pedido ocorre depois; falha desse evento não desfaz a preparação. Preparação não executa banco. Autorização, envio, refresh, conciliação e comprovante seguem [solicitações de pagamento](payment-requests.md). Descarte/arquivo/restauração preservam essas restrições; mensagem secundária/ignorada não pode preparar outro pagamento pelo estado `linked` exigido. Os testes já executados de retenção/resolução/segurança não representam teste real do banco.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
