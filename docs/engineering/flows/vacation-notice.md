# Férias: geração, validação e assinatura do aviso

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Registra o comportamento implementado, não uma regra aprovada. Recibos e pagamento têm percursos próprios.

## Entrada e percurso

[`dp-ferias-profile.tsx`](../../../src/components/dp/dp-ferias-profile.tsx) chama `PATCH /api/dp/vacations/{vacationId}` com `generate_notice`, `validate_notice`, `send_notice` ou `sync_notice`. A [rota](../../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts) valida o corpo com [`updateVacationSchema`](../../../src/features/hr/vacations/schemas.ts) e delega ao [serviço de férias](../../../src/features/hr/vacations/server.ts). `GET /api/dp/vacations/{vacationId}/notice` entrega o PDF após conferir acesso e hash.

1. `generateVacationNotice` exige usuário autenticado, permissão de aprovação e acesso à colaboradora. Numa transação, exige férias do tipo `gozo` aprovadas, trilha ativa e aviso ainda não gerado, falho ou em rascunho. Recalcula conformidade e registra `generating` e evento em `dp_vacationEvents`. Em seguida resolve dados da empresa e colaboradora, gera PDF, fingerprint/hash e salva no Storage. Outra transação confere o ID da operação antes de marcar `draft` e registrar o evento de geração. Falhas da geração podem marcar `failed`. Um rascunho pode ser regenerado; o evento registra o documento substituído. [Fonte](../../../src/features/hr/vacations/server.ts).
2. `validateVacationNotice` exige a mesma permissão e estado `draft`. Baixa o PDF do Storage, confere SHA-256 e, em transação, verifica que a operação e o hash não mudaram. Marca `validated`, revisor/data e evento. A rota de leitura também confere hash antes de responder. [Serviço](../../../src/features/hr/vacations/server.ts), [rota do PDF](../../../src/app/api/dp/vacations/%5BvacationId%5D/notice/route.ts).
3. `sendVacationNotice` exige `validated`, versão atual do modelo, conformidade recalculada, PDF íntegro e e-mail da colaboradora. O ambiente Autentique sandbox é bloqueado para envio pela tela. Quando o aviso tem menos de 30 dias de antecedência, exige `complianceOverrideReason` validada pelo schema. Uma transação marca `sending` e registra evento; o serviço cria `hrSignatureRequests` no banco RH, envia **somente para a colaboradora** na Autentique, depois grava ID externo e marca `sent` em outra transação. Se o provedor aceitou e a projeção local falhou, tenta sincronizar; se o envio falhou, registra a falha e retorna o aviso a `validated` quando ainda está em `sending`. [Fonte](../../../src/features/hr/vacations/server.ts).
4. O [webhook Autentique](../../../src/app/api/webhooks/autentique/route.ts) chama `syncVacationNoticeSignatureRequest` para eventos de aviso. A função obtém o PDF assinado, salva versão imutável em `hr/vacations/{id}/notice/signed/`, registra hash e, em transação, marca o aviso `signed`, avança a etapa para contador e cria evento. Também tenta o despacho ao contador. `sync_notice` permite consultar o provedor e projetar o resultado. [Serviço](../../../src/features/hr/vacations/server.ts).

## Dados, acesso e contratos

| Item | Operação | Controle observado |
| --- | --- | --- |
| `dp_vacations/{id}` e `dp_vacationEvents` no banco principal | Transições, análise legal e eventos | `canManageVacation(..., 'approve')` para geração, validação e envio; `assertTargetAccess` nas transações. |
| Storage | PDF original e assinado, hashes e leitura | Escritas fora das transações; leitura confere SHA-256. |
| `hrSignatureRequests` no banco RH e Autentique | Solicitação, signatária, estados externos | ID estável `vacation_notice_{vacationId}_{documentId}` e sincronização posterior. |
| Contador | Etapa seguinte ao aviso assinado | `attemptVacationAccountantDispatch` após arquivamento. |

**Inferência de impacto:** banco principal, banco RH, Storage e Autentique não compartilham transação; mudanças em IDs, estados ou hash podem afetar recuperação de falhas e avanço ao contador. Há [regra de seleção e revisão do recibo](vacation-receipts.md) na etapa seguinte.

## Divergência, verificação e limites

A [tela](../../../src/components/dp/dp-ferias-profile.tsx) confirma que empregadora e colaboradora receberam solicitações individuais, enquanto `sendVacationNotice` monta apenas a signatária `employee`. É uma **divergência entre texto de interface e implementação**; não há decisão aprovada neste levantamento para exigir assinatura da empregadora. O serviço também contém um CNPJ de matriz usado temporariamente no aviso; confirmar a regra desejada antes de generalizar esse comportamento. [Fonte](../../../src/features/hr/vacations/server.ts).

O [teste estrutural do fluxo](../../../tests/unit/dp-vacation-notice-workflow.test.ts) verifica ações separadas, signatária, fingerprint, webhook e alguns contratos por leitura de código. Há [teste do PDF](../../../tests/unit/dp-vacation-notice-pdf.test.ts). Esses testes não demonstram integração real com Autentique, Storage e os dois bancos. Para mudanças, conferir acesso, transições, versão, antecedência/exceção, hash, recuperação de falha, assinatura e despacho ao contador.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
