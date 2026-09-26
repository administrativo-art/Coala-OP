# Jobs, gatilhos e webhooks

Mapa transversal da etapa 8, baseado nos exports de [Functions](../../functions/src/index.ts) e nos handlers locais. Agenda declarada não comprova deploy, configuração de segredo, entrega do evento ou execução bem-sucedida. Todos os exports têm linha própria no [inventário](surface-inventory.md); leia somente o grupo relevante abaixo.

## Chamadas agendadas que atravessam Functions e API

| Fonte do agendamento | Destino e efeito | Contrato a preservar |
| --- | --- | --- |
| [cashClosureDailySync](../../functions/src/cash-closure-jobs.ts) | `/api/jobs/cash-closures/daily-sync`, [fechamentos](flows/cash-closures.md) | URL configurada, segredo de job e limite/tratamento por unidade no handler. |
| [cashDepositDailyReconciliation](../../functions/src/cash-deposit-reconciliation-job.ts), [interCobrancaReconciliation](../../functions/src/inter-cobranca-jobs.ts) | `/api/jobs/cash-deposits/reconcile`, `/api/jobs/inter/cobrancas/reconcile`, [depósitos](flows/cash-deposits.md) | Conciliação de estado bancário; não equivale à autorização humana para novo pagamento. |
| [interPaymentReconciliation](../../functions/src/inter-payment-jobs.ts), [interStatementSync](../../functions/src/inter-statement-jobs.ts) | `/api/jobs/inter/reconcile`, `/api/jobs/inter/statements/sync`, [pagamentos](flows/payment-requests.md), [caixa](flows/cash-flow.md) | Pagamentos em estado pendente, extratos, retry e cursores próprios; segredo validado antes do processamento. |
| [financialInboxMaintenance](../../functions/src/financial-inbox-jobs.ts) | `/api/jobs/financial-inbox/maintenance`, [caixa documental](flows/financial-inbox.md) | Retenção e manutenção; compartilha `INTER_RECONCILIATION_SECRET` no handler atual. Separação de credenciais não presumida. |
| [stonePortfolioDailySync](../../functions/src/stone-portfolio-job.ts) | `/api/financial/stone-portfolio-cron`, [recebíveis](flows/receivables-stone.md) | Bearer de sincronização; não usar endpoint de job como API autenticada de usuário. |
| `reconcileGeneratedDocumentRetention` em [index.ts](../../functions/src/index.ts) | [job de retenção](../../src/app/api/jobs/documents/retention-reconcile/route.ts) | Bearer próprio; handler chama reconciliação de até 50 colaboradores. Ver [documentos](flows/employee-documents.md). |

As URLs desses disparadores são configuração: a correspondência indicada deve ser confirmada na implantação sem revelar valores de segredos. Esta rodada conferiu fontes; não consultou configuração de produção.

## Processamento direto por Functions

| Família / exports | Fonte e efeito | Limite da evidência |
| --- | --- | --- |
| `hourlyPdvSync`, `reconcilePdvSalesHistory`, `syncGoalsForRange` | [index.ts](../../functions/src/index.ts), [PDV](flows/pdv-sync.md), [metas](flows/goals.md): ingestão, conciliação e reprocessamento por período | Agendado e Callable têm entradas diferentes; autenticação da Callable não é proteção de um cron. |
| `createUser`, `deleteUser`, `terminateUser`, `reactivateUser`, `onUserProfileChange`, `onProfileChange` | [index.ts](../../functions/src/index.ts), [pessoas](flows/people-access.md): Auth, documento, claims e propagação de perfil | Mudança de perfil tem efeitos assíncronos; não há commit global entre Auth e bancos. |
| `syncRhAccessCache`, `syncFromBizneo`, `manualSyncFromBizneo`, `syncBizneoUsersMonthly`, `onFieldUpdate`, `checkFieldMapConsistency` | [sync RH](../../functions/src/rh/sync.ts), [campos](../../functions/src/rh/field-update.ts), [consistência](../../functions/src/rh/propagation.ts), [RH/Bizneo](flows/rh-bizneo.md) | Importação Bizneo está desabilitada por constante em `index.ts` e `rh/sync.ts`; export não prova atividade. |
| `scheduledDateAlerts`, `scheduledProfileCompletion`, `vacationWorkflowDailyAlerts` | [automações RH](../../functions/src/rh/automations.ts), [alertas de férias](../../functions/src/vacation-alerts.ts) | Alertas e chamadas externas dependem de configuração; não foram enviados nesta rodada. |
| `onTermination`, `lgpdScheduledCleanup`, `cleanupExpiredActionLogs`, `cleanupExpiredEmployeeDocumentBatches` | [retenção RH](../../functions/src/rh/termination.ts), [index.ts](../../functions/src/index.ts) | Exclusão/anonimização e limpeza de Storage exigem política e controle de falha próprios; não executar para testar o mapa. |
| `checklistDailyGenerate`, `checklistEscalateTasks`, `checklistMarkOverdue` | [index.ts](../../functions/src/index.ts), [formulários](flows/forms.md), [tarefas](flows/tasks.md) | Geração, escalonamento e vencimento têm estados e agendas separados. |
| `expireQuotations`, `onReceiptStatusChange` | [index.ts](../../functions/src/index.ts), [compras](flows/purchasing-order-receipt.md) | O gatilho de recibo grava estado no pedido fora da transação HTTP original; mudanças de status afetam ambos os caminhos. |
| `recalculateMinimumStock` | [recalculo](../../functions/src/stock-min-recalc.ts), [análise de estoque](flows/stock-analysis.md) | Rotina agendada e consultas de UI não têm a mesma carga. |
| `cashClosureSummaryWritten`, `cashClosureSummaryReinforcement` | [projeções](../../functions/src/cash-closure-summaries.ts), [fechamentos](flows/cash-closures.md) | Projeção por evento e reforço agendado; conferir atraso antes de comparar resumo com fonte. |
| `uberSftpDailySync`, `uberExpenseCandidateWritten`, `uberTransactionCandidateWritten` | [jobs Uber](../../functions/src/uber-sftp/jobs.ts), [despesas](flows/expenses.md) | SFTP depende de `UBER_SFTP_ENABLED`, padrão falso; gatilhos não comprovam importação externa bem-sucedida. |

## Endpoints de job fora de `/api/jobs`

[Scheduler de formulários](../../src/app/api/forms/scheduler/route.ts) aceita segredo de máquina ou usuário com permissão de geração; valida período/dry-run, chama gerador e depois audita. [Recomputação diária](../../src/app/api/forms/analytics/jobs/recompute-daily/route.ts) e [anonimização](../../src/app/api/forms/analytics/jobs/anonymize-due/route.ts) usam `assertCronSecret`. Ambos modificam dados por **GET**, divergindo da orientação do projeto para GET sem efeitos colaterais. A agenda externa desses endpoints não foi comprovada pelo inventário de Functions.

[Scheduler financeiro](../../src/app/api/financial/analysis-routines/scheduler/route.ts) exige flag `FINANCIAL_ANALYSIS_SCHEDULER_ENABLED=true` e segredo em cabeçalho antes de `runDueFinancialRoutine`. Uma rota existente não significa scheduler ativado.

## Webhooks e consumidores

| Entrada | Autenticação observada | Dados e consumidores / limite |
| --- | --- | --- |
| [Autentique](../../src/app/api/webhooks/autentique/route.ts) | Assinatura do corpo e segredo configurado | Solicitações/documentos de assinatura RH; projeções de aviso/recibo de férias e arquivamento. Ver [assinaturas](flows/onboarding-signatures.md), [aviso](flows/vacation-notice.md), [recibos](flows/vacation-receipts.md). Efeitos sequenciais e download/Storage não são transação global; conferir replay e ordem dos eventos. |
| [Resend](../../src/app/api/webhooks/resend/route.ts) | Verificação Svix do corpo, ID, timestamp e assinatura | Ingestão financeira, resposta da clínica ASO e estados de entrega. Ramos diferentes têm registros e repetição diferentes; a checagem de `processedAt` não prova trava concorrente para todos eles. Ver [inbox](flows/financial-inbox.md), [ASO](flows/onboarding-aso.md), [ativação](flows/onboarding-activation.md). |
| [Inter banking](../../src/app/api/webhooks/inter/banking/route.ts) | Segredo por cabeçalho ou query, comparação constante | Localiza pagamento pelo ID bancário, registra evento e atualiza estado. Ver [solicitações](flows/payment-requests.md); recepção de evento não autoriza iniciar novo pagamento. |
| [Inter cobrança](../../src/app/api/webhooks/inter/cobranca/route.ts) | Segredo por cabeçalho/query; schema de cobrança | Guarda corpo em `interWebhookRawEvents` e encaminha itens à conciliação. O [endpoint de configuração](../../src/app/api/financial/cash-deposits/inter/webhook/route.ts) é administrativo, não o receptor; ele cadastra URL com segredo na query e só devolve URL saneada. Rever exposição em logs/retencão sem registrar o segredo aqui. |
| [Stone Pix](../../src/app/api/webhooks/stone/conciliation/route.ts) | Segredo em cabeçalho; valida documento e payload | POST agenda processamento com `after`, verifica URL de download e tamanho, substitui transações em batches e marca estado. ID de arquivo determinístico não prova exclusão mútua; falha entre exclusões/inclusões pode deixar conteúdo parcial. GET tem contrato próprio. Ver [conciliação](flows/stone-sales-review.md). |

Testes de parsers/segredos e E2Es de API são referências nos guias. A etapa 8 não chamou provedores nem comprovou reentrega real de webhooks, agendas implantadas ou recuperação completa. Achados e prioridade estão na [auditoria](surface-audit.md).

## Geração de orçamentos adicionada na main

`financialBudgetGeneration` em [financial-budget-jobs.ts](../../functions/src/financial-budget-jobs.ts) chama a rota de geração às 03h30 de Belém. Contrato, dados e limites em [orçamentos](flows/financial-budgets.md). Configuração/execução remota não verificadas nesta entrega.
