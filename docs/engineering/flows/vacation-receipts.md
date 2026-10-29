# Férias: recebimento e revisão do recibo

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado deste guia:** levantamento do comportamento implementado na base `main` (`3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe`) em 2026-09-25. As afirmações abaixo apontam para código ou teste; elas não aprovam novas regras de negócio. Consulte [registro de regras](../business-rules.md) quando a pergunta for sobre o comportamento desejado.

## Onde começar

| Camada | Fonte | Papel observado |
| --- | --- | --- |
| Tela do RH | [`dp-ferias-profile.tsx`](../../../src/components/dp/dp-ferias-profile.tsx), [`dp-vacation-workflow.tsx`](../../../src/components/dp/dp-vacation-workflow.tsx) | Liga os botões **Abrir arquivo**, **Usar como recibo**, aprovação e correção às ações da API. A lista de seleção mostra apenas documentos ativos; o histórico interno também mostra descartados e substituídos. |
| Portal do contador | [`vacation-accountant/[token]/route.ts`](../../../src/app/api/hr/vacation-accountant/%5Btoken%5D/route.ts), [`receipt-upload.server.ts`](../../../src/features/hr/vacations/receipt-upload.server.ts) | Recebe PDF/JPG/PNG por link com token, valida, grava no Storage e atualiza o fluxo. |
| Seleção e revisão pelo RH | [`vacations/[vacationId]/route.ts`](../../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts), [`schemas.ts`](../../../src/features/hr/vacations/schemas.ts), [`server.ts`](../../../src/features/hr/vacations/server.ts) | Valida a ação, exige acesso de aprovação e registra a transição em transação. |
| Leitura do arquivo | [`receipt-documents/[documentId]/route.ts`](../../../src/app/api/dp/vacations/%5BvacationId%5D/receipt-documents/%5BdocumentId%5D/route.ts), [`server.ts`](../../../src/features/hr/vacations/server.ts) | Exige permissão de visualização ou aprovação, acesso ao colaborador e confere o hash antes de entregar o arquivo. |
| Contrato e escolha sugerida | [`types/index.ts`](../../../src/types/index.ts), [`receipt-documents.ts`](../../../src/features/hr/vacations/receipt-documents.ts) | Define estados, metadados, filtro de documentos ativos e pontuação da sugestão. |

## Percurso observado

1. O portal recebe os arquivos; `uploadVacationReceipt` valida tipo, assinatura binária, tamanho e duplicidade. Grava originais em `hr/vacations/{id}/receipt/original/` no Storage e, em transação, atualiza `dp_vacations/{id}`, `receiptVersions/{documentId}` e um evento em `dp_vacationEvents`. Depois processa as análises. [Fonte](../../../src/features/hr/vacations/receipt-upload.server.ts).
2. A tela lista `activeVacationReceiptDocuments`, que exclui `superseded` e `discarded`. A análise pode indicar `suggestedDocumentId`, mas o botão **Usar como recibo** chama `select_receipt_document`. [Tela](../../../src/components/dp/dp-vacation-workflow.tsx), [seleção](../../../src/features/hr/vacations/receipt-documents.ts).
3. A API valida `documentId` pelo schema e `selectVacationReceiptDocument` exige `dp.vacation.approve` ou administrador padrão, além de acesso ao colaborador. Seleciona um documento disponível, atualiza ponteiros do recibo original e versões e registra `VACATION_RECEIPT_DOCUMENT_SELECTED` na mesma transação Firestore. [Schema](../../../src/features/hr/vacations/schemas.ts), [servidor](../../../src/features/hr/vacations/server.ts).
4. `review_receipt` aceita aprovação ou pedido de correção. Na correção, os arquivos ativos passam a `superseded` e o contador recebe nova solicitação. Na aprovação, são gravados os valores conferidos e o fluxo avança ao pagamento; a preparação do controle financeiro ocorre após a transação. [Schema](../../../src/features/hr/vacations/schemas.ts), [servidor](../../../src/features/hr/vacations/server.ts).

## Contratos a preservar ao alterar este fluxo

- **Seleção não é aprovação.** São ações distintas na rota e no servidor. Fonte: [`route.ts`](../../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts), [`server.ts`](../../../src/features/hr/vacations/server.ts).
- **A sugestão não escolhe sozinha.** A tela pede confirmação do RH e o servidor registra `selectedBy`. Fonte: [`dp-vacation-workflow.tsx`](../../../src/components/dp/dp-vacation-workflow.tsx), [`server.ts`](../../../src/features/hr/vacations/server.ts).
- **Validação e autorização são do servidor.** A rota usa `updateVacationSchema`; as ações sensíveis usam `requireVacationApprovalAccess`. Fonte: [`schemas.ts`](../../../src/features/hr/vacations/schemas.ts), [`server.ts`](../../../src/features/hr/vacations/server.ts).
- **Preservação e auditoria:** versões antigas são marcadas `superseded`, e seleção/revisão geram eventos. Fonte: [`receipt-upload.server.ts`](../../../src/features/hr/vacations/receipt-upload.server.ts), [`server.ts`](../../../src/features/hr/vacations/server.ts).
- **Storage e Firestore são efeitos distintos.** O upload salva o arquivo antes da transação de metadados; investigue a compensação e falhas antes de modificar esse trecho. Fonte: [`receipt-upload.server.ts`](../../../src/features/hr/vacations/receipt-upload.server.ts).

## Verificação e limites do levantamento

- Teste de pontuação, sugestão e documentos ativos: [`dp-vacation-receipt-selection.test.ts`](../../../tests/unit/dp-vacation-receipt-selection.test.ts).
- Testes do fluxo de férias: [`dp-vacation-workflow.test.ts`](../../../tests/unit/dp-vacation-workflow.test.ts), [`dp-vacation-end-to-end-workflow.test.ts`](../../../tests/unit/dp-vacation-end-to-end-workflow.test.ts), [`vacations.spec.ts`](../../../tests/e2e/hr/vacations.spec.ts). Confira os casos existentes antes de presumir que seleção, autorização ou descarte estejam cobertos.
- **Regra aprovada nesta implementação:** o descarte individual preserva original e histórico interno, exige motivo e não permite selecionar novamente a versão descartada.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Descarte individual disponível na main

`discard_receipt_document` na [rota de férias](../../../src/app/api/dp/vacations/[vacationId]/route.ts), com [schema](../../../src/features/hr/vacations/schemas.ts) e [serviço](../../../src/features/hr/vacations/server.ts), exige acesso de aprovação, acesso à colaboradora, trilha ativa e recibo em `review_pending`. Rejeita documento ausente, suplantado, descartado ou selecionado. A transação marca `discarded`, limpa a sugestão quando necessário, registra `discardedAt`/`discardedBy` em `receiptVersions` e cria `VACATION_RECEIPT_DOCUMENT_DISCARDED`. Preserva o arquivo no Storage.

A [tela](../../../src/components/dp/dp-vacation-workflow.tsx) oferece **Descartar** com confirmação e informa espera de novo envio quando não há arquivo ativo. O botão bloqueia documento em processamento; não inferir essa mesma guarda individual no servidor. Seleção/sugestão excluem `superseded` e `discarded` em [receipt-documents](../../../src/features/hr/vacations/receipt-documents.ts). Conferir os [testes de seleção](../../../tests/unit/dp-vacation-receipt-selection.test.ts) e [contrato do fluxo](../../../tests/unit/dp-vacation-end-to-end-workflow.test.ts); não tratá-los como E2E de navegador.


## Histórico interno e decisões documentais — 29/10/2026

O painel mostra todos os arquivos recebidos no histórico interno, inclusive descartados e substituídos, com abertura do original pelo endpoint autorizado existente (conferência SHA-256). A lista de seleção continua limitada aos ativos. Este histórico não é uma publicação no portal do colaborador.

Novos descartes exigem motivo (1–2000 caracteres). O backend grava motivo, autor e data no documento incorporado, em `receiptVersions` e no evento transacional. Correção registra os mesmos dados de substituição apenas nos arquivos ativos: não reclassifica descartes nem substituições anteriores. Reenvios também preservam essas decisões. A versão aceita recebe autor/data de aprovação; notas permanecem na revisão e na versão. Dados legados ausentes aparecem como não registrados, sem inventar decisões retroativas.

PATCH e DELETE do recurso passam por `secureRoute`: validação, permissão conforme ação e acesso ao colaborador no preflight somente leitura, além das verificações transacionais já existentes. `update_record` exige request; demais ações e DELETE exigem approve. Custo adicional: uma leitura pontual do agendamento e a verificação de escopo existentes por mutação; nenhuma consulta/listener de coleção adicional.

O painel reúne aviso assinado, recibo assinado e comprovante do mesmo ciclo/gozo, mantendo downloads separados. O resolvedor documental conserva os identificadores de período/parcela e acrescenta o intervalo de gozo ao rótulo da parcela quando ambas as datas constam dos metadados `vacationStartDate`/`vacationEndDate`. Não há migração automática de documentos existentes. Metadados incompletos conservam o agrupamento legado e exigem revisão antes do arquivamento.

Importar documento histórico pelo arquivo documental não cria nem conclui trilha operacional: não chama aprovação de recibo, preparação financeira ou assinatura. Não foi acrescentado efeito operacional ao resolvedor puro de destinos. PDFs assinados continuam integrais; não se gera um PDF unificado.

Verificação local: transições de correção, preservação de descartes e originais, reexecução idempotente, seleção/sugestão e agrupamento dos três tipos. Testes locais não comprovam uma execução financeira/Autentique em ambiente real.


Teste integrado isolado: `node scripts/test-integration.mjs --vacation-documents`, com [cenário sintético de API](../../../tests/integration/dp-vacation-documents.test.mjs). Confere PATCH/DELETE legítimos e bloqueios de autenticação, permissão e unidade; valida motivo obrigatório, autor não forjável, original preservado, evento/versão persistidos e repetição sem duplicação. Execução aprovada nos emuladores locais; não valida navegador, financeiro ou Autentique reais.
