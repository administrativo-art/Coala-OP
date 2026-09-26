# Solicitações de pagamento e Banco Inter

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** criação, autorização interna, envio, atualização bancária e pós-pagamento traçados no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Matching de extrato e variantes de recuperação ainda exigem revisão complementar.

## Entrada e percurso

A [tela de solicitações](../../../src/app/dashboard/financial/payment-requests/page.tsx) chega às [rotas de solicitações](../../../src/app/api/financial/payment-requests/route.ts). `GET` exige `financial.view` e `paymentRequests.view`; `POST` exige `paymentRequests.create`, valida o corpo por [schema](../../../src/features/financial/payment-requests/schemas.ts) e bloqueia criação direta de pagamentos de ASO, férias e desligamento. Esses três tipos surgem dos fluxos protegidos de RH. A [caixa financeira](financial-inbox.md) possui entrada própria para pagamento por código de barras.

1. [`createPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) cria a solicitação e vincula despesa quando aplicável. A autorização interna usa [`POST /api/financial/payment-requests/[id]/authorize`](../../../src/app/api/financial/payment-requests/%5Bid%5D/authorize/route.ts), que exige `paymentRequests.authorize`; o serviço avança de `awaiting_financial_authorization` para `ready_to_submit`, registra evento e, em alguns tipos de RH, atualiza notificação.
2. Para desligamento e ASO, a autorização interna chama [`submitPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) na mesma requisição. Para outros tipos, a [rota de envio](../../../src/app/api/financial/payment-requests/%5Bid%5D/submit/route.ts) aciona essa função separadamente. O serviço coloca a solicitação em `submitting` por transação e registra evento antes de falar com o Inter.
3. No trilho de código de barras, o serviço procura pagamento anterior no Inter pela linha digitável e valor; se não houver, envia. Grava código bancário, estado, débito esperado e estado da mensagem da caixa (somente para origem `financial_inbox`) em transação. No trilho Pix, confere se o cadastro do favorecido mudou e envia com chave de idempotência. A resposta pode exigir aprovação no banco, agendar ou iniciar processamento. [Serviço](../../../src/features/financial/payment-requests/service.server.ts).
4. [`refreshPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) e a [rota de atualização](../../../src/app/api/financial/payment-requests/%5Bid%5D/refresh/route.ts) observam o estado posterior. A atualização de fontes como RH, compras, despesa e caixa ocorre em [`completeSource`](../../../src/features/financial/payment-requests/service.server.ts). O pedido interno, o aceite do Inter e a liquidação/conciliação são estados distintos.

## Retorno bancário e comprovante

[`refreshPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) consulta novamente o Inter. Para código de barras, pagamento indicado pelo banco passa a `awaiting_statement`; divergência de valor bloqueia baixa. Para Pix, confere valor e documento do recebedor contra o snapshot/hash do favorecido. Divergência é registrada para revisão; não é prova de pagamento concluído.

[`reconcileExpectedBankDebit`](../../../src/features/financial/inter-statement-sync.server.ts) reserva uma trava de dez minutos, confere despesa, solicitação, origem e valor, e prepara a liquidação pelo extrato. Um batch atualiza despesa, transação, evento bancário, débito esperado, pedido e, para origem `financial_inbox`, mensagem da caixa, com precondição de versão no débito esperado. Divergência mantém revisão pendente; conciliação compatível prepara o pós-pagamento. A escolha do candidato de extrato ainda precisa de conferência detalhada antes de alterar matching.

[`finishPaidPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) usa lease de pós-pagamento, gera/guarda comprovante quando ausente, anexa-o à caixa/despesa ou atualiza a origem e registra conclusão. `completeSource` propaga resultados para ASO, desligamento, férias, compras, despesa e recibo conforme `sourceType`. A origem e Storage são efeitos separados; passos persistidos permitem retomada, mas exigem teste de falha entre operações.

O [job Inter](../../../src/app/api/jobs/inter/reconcile/route.ts) autentica por segredo de job e consulta filas limitadas: até 10 estados bancários, 5 pós-pagamentos e 5 envios interrompidos. Reagenda falhas com atraso e encaminha `submitting` antigo para revisão. O [webhook bancário](../../../src/app/api/webhooks/inter/banking/route.ts) confere segredo, identifica solicitação, registra evento com hash e chama a mesma atualização. Não se deve usar este levantamento para executar pagamentos reais.

## Dados, permissão e impacto

| Local | Efeito observado |
| --- | --- |
| `bankPaymentRequests`, eventos, `expenses`, `payments`, `transactions`, `expectedBankDebits` no banco financeiro | Solicitação, vínculos, trilha, débito esperado e conciliação. [Serviço](../../../src/features/financial/payment-requests/service.server.ts). |
| Banco Inter | Envio Pix ou código de barras, consulta anterior e atualização de estado. [Serviço](../../../src/features/financial/payment-requests/service.server.ts). |
| `onboardingProcesses`, `terminationProcesses`, pedidos de compra e recibos | Fontes atualizadas após pagamento quando a origem corresponde. [Serviço](../../../src/features/financial/payment-requests/service.server.ts). |

**Inferência de impacto:** a chamada ao Inter fica entre transações locais. Uma falha depois do aceite externo pode deixar o pedido local em `failed`; o código tenta recuperar pagamento de código de barras antes de reenviar e bloqueia divergência que exige reconciliação manual. Alterar transições ou retry precisa preservar essas guardas. A autorização interna pode disparar o envio bancário em ASO e desligamento; por isso, a permissão de autorização é uma ação sensível.

## Verificação e limites

Conferir os [testes de segurança da caixa](../../../tests/unit/financial-inbox-payment-safety.test.ts) e os testes do módulo financeiro pertinentes à ação modificada. Para mudanças, verificar origem RH protegida, permissões de criar/autorizar/enviar, favorecido alterado, reenvio Pix/código de barras, resposta com aprovação no banco, transição para débito esperado e atualização da fonte. Este levantamento não executou pagamento nem ambiente bancário real.

## Seleção do extrato e recuperação rastreadas

[`findExpectedBankDebitMatch`](../../../src/features/financial/payment-requests/expected-bank-debits.ts) considera apenas saída e candidato ainda não usado. Referência bancária comum única tem precedência; múltiplas referências elegíveis geram ausência de match. Sem referência, exige candidato único com diferença até 5 centavos e até cinco dias da data esperada. A referência direta não dispensa a validação posterior de valor/origem em `reconcileExpectedBankDebit`.

[`syncInterStatement`](../../../src/features/financial/inter-statement-sync.server.ts) tenta débito esperado, lançamento bancário existente e só depois sugestão de despesa. Carregamento incompleto de candidatos fornece conjunto vazio e indicadores de cobertura, evitando match sobre uma fração silenciosa. `registerEntry` usa ID por conta/ID externo e evento na mesma transação; evento existente reaproveita vínculo. Erro de conciliação marca evento como `expected_bank_debit_review` ou `expected_bank_debit_retry`, mantém extrato registrado e permite nova tentativa. Conjuntos de IDs usados evitam reaproveitar candidato na mesma execução; lease e precondição protegem a aplicação posterior. Sugestão de despesa não é autorização de pagamento. Com isso, retorno bancário, extrato e pós-pagamento têm fronteiras e recuperação identificadas; testes integrados ficam na etapa 2.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Boleto anexado diretamente à despesa

O [painel da despesa](../../../src/features/financial/components/expenses/expense-boleto-panel.tsx) envia PDF privado/imutável de até 10 MB por [POST de boleto](../../../src/app/api/financial/expenses/[expenseId]/boleto/route.ts). Operador confirma dados; servidor valida linha de 47 dígitos, valor, vencimento, CNPJ e compatibilidade com despesa única elegível. Storage precede a transação de metadados/auditoria em `expenseBoletoAttachments/{expenseId}`. Download autenticado usa metadados canônicos e workspace.

[POST boleto/payment](../../../src/app/api/financial/expenses/[expenseId]/boleto/payment/route.ts) prepara solicitação determinística `expense_boleto`, rail `barcode`, estado `awaiting_financial_authorization`. Exige permissões de despesas e criar/ver solicitações; autorização/envio são etapas separadas. [Serviço da origem](../../../src/features/financial/payment-requests/expense-boleto.server.ts) e [pagamentos](../../../src/features/financial/payment-requests/service.server.ts) revalidam antes de enviar. Atualização de mensagem da caixa é exclusiva da origem `financial_inbox`; envio/agendamento não prova pagamento.

Fontes adicionais: [procedimento existente](../expense-boleto-direct-payment.md), [unitário](../../../tests/unit/financial-payments/expense-boleto.test.ts), [teste HTTP](../../../tests/e2e-api/expense-boleto.test.mts). Nenhuma operação bancária ou execução desse teste HTTP faz parte da integração documental.

## Datas e apresentação do agendamento

A [apresentação](../../../src/features/financial/payment-requests/presentation.ts) distingue vencimento, data solicitada e data confirmada pelo banco; a data bancária confirmada tem precedência na apresentação do agendamento. A [tela](../../../src/features/financial/payment-requests/payment-requests-page.tsx) inicia na seleção de não pagos. Conferir [testes de apresentação](../../../tests/unit/financial-payment-presentation.test.ts) ao alterar filtros ou datas; não confundir agendamento com liquidação.
