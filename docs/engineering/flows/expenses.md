# Financeiro: lançamento de despesas e pendências de auditoria

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

Superfície complementar: [sessão de importação](../../../src/app/api/financial/import-sessions/%5BsessionId%5D/route.ts) autoriza e valida ações `save`/`finalize`, podendo efetivar/reabrir itens e fechar importação por serviços financeiros. Conferir esse handler quando o pedido partir de extrato/importação; o fluxo de cartão tem endpoints próprios. Gatilhos de candidatos Uber e sincronização SFTP estão em [jobs e gatilhos](../runtime-surfaces.md).

As [páginas de despesas](../../../src/app/dashboard/financial/expenses/page.tsx), [novo lançamento](../../../src/app/dashboard/financial/expenses/new/page.tsx), [importação](../../../src/app/dashboard/financial/expenses/import/page.tsx) e [pendências](../../../src/app/dashboard/financial/expenses/pending-audit/page.tsx) são entradas do grupo. [`ExpensesPage`](../../../src/features/financial/pages/expenses-page.tsx) carrega despesas, transações, planos de contas e centros de resultado via [`useFinancialCollection`](../../../src/features/financial/hooks/use-financial-collection.tsx). Esse hook usa `getDocs` no SDK cliente; quando falha, tenta [`GET /api/financial/data`](../../../src/app/api/financial/data/route.ts), que verifica permissão por caminho e lê a coleção inteira. A consulta de despesas desta página não possui filtro/limite no hook; medir volume e frequência antes de alterá-la.

No [`ExpenseForm`](../../../src/features/financial/components/expenses/expense-form.tsx), `handleSaveDraft` cria ou atualiza um rascunho em `expenses`. O envio final `onSubmit` monta os campos contábeis e de competência. Edição simples usa `updateDoc`; edição da série consulta `recurrenceGroupId`, escolhe ocorrências e usa `writeBatch`. Nova despesa usa `setDoc` com `obligationId` derivado do ID. Nova recorrência monta várias ocorrências e executa `setDoc` com `Promise.all`, sem transação conjunta; falha parcial pode deixar apenas parte da série. Após salvar uma despesa real, a tela tenta conciliar provisão e, se a origem for importação ou caixa de entrada, atualiza o vínculo correspondente **depois** da escrita principal.

Na [`PendingAuditExpensesPage`](../../../src/features/financial/pages/pending-audit-expenses-page.tsx), `handleLinkImportedExpense` marca a despesa como paga e depois marca a transação como resolvida em duas chamadas `updateDoc` separadas. O filtro da tela combina despesas vindas de compras e transações importadas; o vínculo parcial exige reconciliação manual. O [pagamento](../../../src/features/financial/components/pay-expense-dialog.tsx) e as [rotas de liquidação](../../../src/app/api/financial/expenses/%5BexpenseId%5D/settlement/route.ts) têm contratos próprios e precisam ser lidos antes de qualquer mudança em estado `paid`.

Na listagem, despesas com `plannedPaymentMethodType: credit_card` e identidade de ciclo ativa são apresentadas dentro da fatura correspondente por [`groupExpensesByCardStatement`](../../../src/features/financial/lib/expense-card-statement-groups.ts). Uma compra parcelada contribui em cada fatura apenas com a parcela daquele ciclo, e os filtros de competência/vencimento avaliam as ocorrências das faturas em vez de esconder parcelas futuras pelo vencimento da primeira. O lançamento continua sendo a despesa real de origem; a fatura representa o agrupamento e a obrigação de caixa, não uma segunda despesa.

## Dados e acesso

### Navegação financeira — etapa local de 2026-09-26

Despesas permanece entrada direta. O grupo **Conciliação e fechamento** reúne Fechamento de caixa, Vendas e recebimentos, Extratos bancários e Faturas de cartão de crédito. **Fechamento mensal não está implementado nem aparece como placeholder**. Depósitos seguem na navegação interna do fechamento, com entrada alternativa preservada para perfil somente de depósitos; antecipações continuam acessíveis em Vendas e recebimentos. As permissões anteriores de cada fluxo são mantidas, inclusive restrição administrativa de PDV × Stone e antecipações; o layout financeiro continua exigindo `financial.view`.

O [destino canônico de extratos](../../../src/app/dashboard/financial/reconciliation/bank-statements/page.tsx) usa [BankStatementsPage](../../../src/features/financial/pages/bank-statements-page.tsx), `PageContainer` e `PageHeader`, e só monta o `FinancialImportPage` compartilhado com `audits.view`. Não existe novo motor, coleção, listener ou API. Importação/edição/efetivação continuam condicionadas às permissões específicas do importador e do servidor/regras existentes. Consultas completas legadas permanecem dívida prévia, não uma nova convenção.

Despesas preserva Cobranças recebidas, Autorizações bancárias, Novo lançamento, Importar extrato e acesso a Faturas. O atalho Extratos e o upload enviam ao destino central; após upload usam o ID da sessão criada e preservam filtros locais da lista para retorno. A página antiga `expenses?view=audits` e a rota `expenses/import` redirecionam mantendo sessão/ledger. Retorno é restrito ao caminho local de Despesas, sem protocolos externos ou ciclo para a auditoria. O workspace não é montado em duplicidade na aba de despesas.

O importador exibe controles de upload também na forma embutida canônica, respeitando `audits.import`; diálogos `uploadOnly` continuam sem barra completa. O botão legado “Sincronizar bancos”, sem handler, foi retirado em vez de apresentar uma ação que não executa nada. Nenhum dado ou regra de conciliação foi migrado por essa reorganização.

Regressões de roteamento/contexto/permissão estrutural: [testes de navegação](../../../tests/unit/financial-reconciliation-navigation.test.ts). O [teste HTTP local](../../../tests/e2e-api/financial-navigation.test.mts) verifica redirecionamentos reais e resposta dos destinos, sem navegador, credenciais, leitura ou escrita financeira. Após `npm run build`, executar `node --import tsx --test tests/e2e-api/financial-navigation.test.mts` num worktree sem arquivos `.env*`; ele abre e encerra seu próprio servidor loopback com projeto fictício `demo-coala-financial-navigation`. Não equivale a homologação visual nem a revisão integral dos escritores financeiros. Teste em observação, sem alteração do workflow de publicação.

| Dado | Operação e controle observado |
| --- | --- |
| `expenses` | CRUD no banco financeiro pelo SDK cliente; [regras financeiras](../../../firestore.financial.rules) distinguem `view/create/edit/delete` e validam plano de contas e individualização conforme operação. Outras permissões também podem ler, como DRE e auditoria. |
| `transactions` | Listagem e vínculo de importação; atualização em passo separado do documento de despesa. [Regras financeiras](../../../firestore.financial.rules) controlam leitura e escrita por ação. |
| `payments`, obrigações e ajustes | Escrita de pagamento e obrigação passa por API, conforme [regras financeiras](../../../firestore.financial.rules); conferir [serviço de obrigações](../../../src/features/financial/obligations/service.server.ts) antes de alterar liquidação. |

## Dependências e verificação

Despesas alimentam [DRE](dre.md), [fluxo de caixa](cash-flow.md), [solicitações de pagamento](payment-requests.md), [compras](purchasing-order-receipt.md) e [caixa de entrada](financial-inbox.md). Para alteração funcional, conferir série, competência, rateio, provisão, importação, baixa/pagamento e permissões de leitura/escrita. Referências de teste: [séries](../../../tests/unit/financial-expense-series.test.ts), [provisões](../../../tests/unit/financial-expense-provisions.test.ts), [centro de resultado](../../../tests/unit/financial-expense-reference-center.test.ts) e [agrupamento de cartão](../../../tests/unit/financial-expense-card-statement-groups.test.ts). `npm run check` passou na verificação anterior do mapa (2026-09-25); não demonstra consistência ponta a ponta entre despesas, transações, provisão e obrigação. O rastreamento dos ramos está complementado abaixo; verificação integrada pendente.

## Liquidação, importação e variantes rastreadas

[`PayExpenseDialog`](../../../src/features/financial/components/pay-expense-dialog.tsx) distingue registrar pagamento por `/expenses/{id}/payments` de criar pedido bancário por `/payment-requests`. A [API de pagamentos reportados](../../../src/app/api/financial/expenses/[expenseId]/payments/route.ts) exige financeiro+`expenses.pay`, valida schema e chama [`registerReportedPayment`](../../../src/features/financial/obligations/service.server.ts). Transação usa ID por despesa/chave idempotente, rejeita rascunho/cancelada/reconciliada, valida previsão ligada, plano de encargos e principal maior que zero. Lê vínculos/ajustes da obrigação, recalcula saldo, grava obrigação/pagamento/vínculo/ajustes e projeções da despesa. Pagamento reportado e `MATCHED` pelo extrato são estados distintos. A [rota settlement](../../../src/app/api/financial/expenses/[expenseId]/settlement/route.ts) consulta o resumo e vínculos; não é a escrita de pagamento.

[`ImportPage`](../../../src/features/financial/pages/import-page.tsx) mantém sessão e itens auditáveis, confirma/classifica, efetiva selecionados e permite reabrir com motivo. `finalizeAuditedItems` distingue vínculo a despesa existente, criação/classificação, rateio e vínculo de compra; grava transações/despesas e eventualmente `purchase_financials` em chamadas separadas. `effectuateItem`/`reopenEffectuatedItem` e encerramento/descarte de sessão não devem ser confundidos com pagamento no banco. Efeitos parciais exigem retomar pelo item/sessão e conferir vínculos, não repetir indiscriminadamente a importação. Cartões usam [importação versionada própria](card-statements.md).

Recorrência, rateio, provisão e exclusão precisam preservar os vínculos de obrigação/extrato; permissões das escritas diretas vêm das regras financeiras. A sequência de cada família e suas fronteiras foram localizadas; concorrência, recuperação entre bancos e equivalência contábil continuam verificações pendentes.

## Exclusão e vínculos preservados pelo chamador

`handleDelete` na [página de despesas](../../../src/features/financial/pages/expenses-page.tsx) bloqueia na interface despesas de origem `purchasing`, encaminhando o cancelamento ao pedido. Nos demais casos chama `deleteDoc` de `expenses` e atualiza a lista. Esse handler não estorna pagamento nem exclui obrigação/transação vinculada. A autorização efetiva da remoção é a regra financeira; testar registros pagos/vinculados e acesso direto antes de alterar essa operação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Boleto anexado diretamente à despesa

O [painel da despesa](../../../src/features/financial/components/expenses/expense-boleto-panel.tsx) envia PDF privado/imutável de até 10 MB por [POST de boleto](../../../src/app/api/financial/expenses/[expenseId]/boleto/route.ts). Operador confirma dados; servidor valida linha de 47 dígitos, valor, vencimento, CNPJ e compatibilidade com despesa única elegível. Storage precede a transação de metadados/auditoria em `expenseBoletoAttachments/{expenseId}`. Download autenticado usa metadados canônicos e workspace.

[POST boleto/payment](../../../src/app/api/financial/expenses/[expenseId]/boleto/payment/route.ts) prepara solicitação determinística `expense_boleto`, rail `barcode`, estado `awaiting_financial_authorization`. Exige permissões de despesas e criar/ver solicitações; autorização/envio são etapas separadas. [Serviço da origem](../../../src/features/financial/payment-requests/expense-boleto.server.ts) e [pagamentos](../../../src/features/financial/payment-requests/service.server.ts) revalidam antes de enviar. Atualização de mensagem da caixa é exclusiva da origem `financial_inbox`; envio/agendamento não prova pagamento.

Fontes adicionais: [procedimento existente](../expense-boleto-direct-payment.md), [unitário](../../../tests/unit/financial-payments/expense-boleto.test.ts), [teste HTTP](../../../tests/e2e-api/expense-boleto.test.mts). Nenhuma operação bancária ou execução desse teste HTTP faz parte da integração documental.

## Projeção de pagamento e consulta do orçamento

A [regra de exibição](../../../src/features/financial/lib/expense-display-state.ts) reconhece `payment_found_pending_document`/`PENDING_DOCUMENT` antes de calcular atraso. Esse estado indica pagamento confirmado ligado a uma previsão ainda sem valor real de despesa, não prova ausência de anexo. A interface mostra “Pagamento confirmado · conferir despesa”; valor liquidado entra em pago e apenas o restante estimado permanece aberto. Cancelamento e reconciliação prevalecem sobre projeções antigas. Nenhum status persistido é reescrito por esta correção.

Previsões com `budgetMigration` ficam fora da listagem operacional e podem ser consultadas no filtro Canceladas. A [comparação de orçamento](financial-budgets.md) reúne planejado, despesas e composição; o link `?expense=<id>&competence=<mês>` seleciona e expande a despesa na consulta, respeitando acesso existente. [Testes permanentes](../../../tests/unit/financial-expense-display-state.test.ts) cobrem pagamento integral/parcial, cancelamento, vencimento e migração.

Na seleção de competência, o cabeçalho mostra quantidade e soma das obrigações filtradas. Cada semana recebe numeração cronológica e total próximo às datas/quantidade, mantendo a numeração ao inverter a ordenação. Sem vencimento permanece separado, sem número de semana. Totais incluem uma entrada por fatura agrupada e seguem os mesmos filtros da lista; não somam novamente as compras internas da fatura. [Regressão de totais e semanas](../../../tests/unit/financial-expense-list.test.ts) conserva centavos e confirma a soma mensal. Nenhuma consulta adicional.
