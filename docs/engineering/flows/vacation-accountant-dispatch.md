# Férias: envio ao contador e portal do recibo

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. O [recebimento e a revisão dos arquivos](vacation-receipts.md) são detalhados separadamente.

## Entrada e percurso

Após a assinatura do aviso, [`syncVacationNoticeSignatureRequest`](../../../src/features/hr/vacations/server.ts) chama `attemptVacationAccountantDispatch`. O RH também pode chamar `send_accountant` por [`PATCH /api/dp/vacations/{id}`](../../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts); essa ação exige `dp.vacation.approve` e acesso à colaboradora. Um pedido de correção do recibo volta a acionar o despacho. [Serviço](../../../src/features/hr/vacations/server.ts).

1. `ensureVacationAccountantRequestSent` exige trilha ativa, aviso assinado com caminho e hash, contato do escritório para férias ou integração e dados da colaboradora/período. Se a etapa já foi enviada ou concluída, retorna resultado idempotente. Para um pedido novo ou correção, calcula rodada, ID de comunicação `vacation_accountant_{vacationId}_{round}` e token aleatório cujo hash, prazo de 30 dias e estado `sending` são gravados em `dp_vacations` numa transação com evento. [Fonte](../../../src/features/hr/vacations/server.ts).
2. O serviço baixa o aviso assinado, confere SHA-256, compõe e-mail com anexo e link `/ferias/contabilidade/{token}`, grava `emailCommunications` no banco RH e envia pelo provedor. Ao receber aceite, grava ID externo e marca a etapa `sent` em transação; em falha, marca comunicação e etapa como `failed`. Uma comunicação anterior aceita pode ser reutilizada após falha de projeção. [Fonte](../../../src/features/hr/vacations/server.ts).
3. O [portal público](../../../src/app/ferias/contabilidade/%5Btoken%5D/page.tsx) usa [`GET`/`POST /api/hr/vacation-accountant/[token]`](../../../src/app/api/hr/vacation-accountant/%5Btoken%5D/route.ts). O servidor localiza férias pelo hash do token, confere validade e estado e limita upload a PDF/JPG/PNG, tipo binário, tamanho, lote e quantidade. [`uploadVacationReceipt`](../../../src/features/hr/vacations/receipt-upload.server.ts) salva originais no Storage e registra versões e evento; as análises automáticas posteriores não substituem a escolha do RH. [Revisão](vacation-receipts.md).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `dp_vacations`, `dp_vacationEvents` | Estado do contador, hash do token, rodada, eventos | Transações do serviço; permissão de aprovação para chamada do RH. |
| `emailCommunications` no banco RH e provedor de e-mail | Comunicação, aceite, erro e anexo | ID por férias/rodada; tratamento de falha e reuso. |
| Portal público e Storage | Consulta por token e envio de arquivos | Token não é persistido em claro no processo; hash e expiração verificados no servidor. |
| `receiptVersions` | Metadados e versões dos arquivos | Serviço de upload e fluxo de [revisão](vacation-receipts.md). |

**Inferência de impacto:** banco principal, banco RH, provedor de e-mail e Storage não compartilham transação. Alterar token, rodada, ID da comunicação ou estados pode quebrar reenvio, acesso ao portal e recuperação de falha. O link com token dá acesso a dados de férias; confira resposta pública e prazo de expiração antes de ampliar campos.

## Verificação e limites

O [teste estrutural do fluxo de férias](../../../tests/unit/dp-vacation-end-to-end-workflow.test.ts) aponta a rota pública e o upload; o [E2E de férias](../../../tests/e2e/hr/vacations.spec.ts) deve ser conferido conforme a ação alterada. Este levantamento não executou integração real de e-mail, Storage ou portal. Valide contato configurado, aviso íntegro, reuso, token vencido, reenvio de correção e limites de upload antes de modificar o percurso.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
