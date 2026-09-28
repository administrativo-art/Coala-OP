# Pedido de demissão: conferência da carta e confirmação da identidade

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. O [envio inicial](resignation-request.md) e as etapas posteriores de aviso, contador e encerramento são separados.

## Entrada e percurso

A [tela de detalhe do pedido](../../../src/features/hr/termination/employee-resignation-detail.tsx) envia `review_letter` para [`PATCH /api/hr/terminations/{id}`](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts). A rota converte os campos e chama [`reviewTerminationLetter`](../../../src/features/hr/termination/server.ts), que exige permissão de gestão pelo `requireManagedProcess`, tipo `clt_employee_resignation`, carta atual e identidade ainda `not_requested`.

1. Para `correction_requested` ou `exception_review`, o serviço exige orientação/motivo, marca auditoria e etapa da carta como pendente externa ou bloqueada e registra a validação do RH. No pedido de correção, envia e-mail ao colaborador, registra `emailCommunications` e evento `LETTER_CORRECTION_REQUESTED`; exceção registra `LETTER_EXCEPTION_REVIEW`. [Fonte](../../../src/features/hr/termination/server.ts).
2. O colaborador substitui a carta por [`POST /api/hr/terminations/{id}/letter`](../../../src/app/api/hr/terminations/%5Bid%5D/letter/route.ts), somente quando o RH pediu correção. [`replaceTerminationLetter`](../../../src/features/hr/termination/server.ts) valida declaração manuscrita e arquivo PDF/JPG/PNG de até 12 MB, salva nova versão no Storage, marca a antiga como não atual, reabre a conferência, cria evento e tenta criar tarefa para RH.
3. Para `approved`, o serviço exige celular verificado e CPF válido, compõe comprovante com a carta original, salva PDF/hash no Storage e pede assinatura pela Autentique com confirmação por SMS. Marca carta aprovada, processo `identity_pending`, etapa de assinatura pendente e cria `hrSignatureRequests` e evento. Se o envio ao provedor falha, exclui o PDF de confirmação recém-gerado. [Fonte](../../../src/features/hr/termination/server.ts).
4. O [webhook da Autentique](../../../src/app/api/webhooks/autentique/route.ts) chama [`markTerminationIdentitySigned`](../../../src/features/hr/termination/server.ts) quando a assinatura termina. O serviço pode arquivar o PDF assinado, marcar `identityStatus: verified`, atualizar etapas, emitir evento e notificação e criar tarefa para a decisão do aviso. A mesma função serve outros tipos de desligamento; os ramos são condicionados por `processType` e etapas presentes.

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| Processo/documentos/eventos no banco RH | Versão, revisão, identidade e etapas | `requireManagedProcess` para revisão; colaborador só substitui a própria carta após correção. |
| `users`, identidade e telefone verificado | Leitura antes da aprovação | Validado no serviço antes da assinatura SMS. |
| Storage, Autentique e `hrSignatureRequests` | Comprovante, assinatura e retorno | PDF e provedor são efeitos externos à gravação do processo. |
| `emailCommunications`, notificações e tarefas | Devolutiva e próximos passos | Chamadas posteriores; criação de tarefa pode falhar sem impedir retorno. |

**Inferência de impacto:** aprovação toca Storage, Autentique e banco RH em etapas; falhas parciais exigem conferir documento, ID externo e estado local. O contrato de `letterVersion` e `isCurrent` evita revisar a versão errada. A rota `PATCH` faz coerção de vários campos no próprio handler; a validação efetiva desta ação ocorre sobretudo no serviço, diferente das ações de férias com schema da rota.

## Verificação e limites

Os [testes de núcleo](../../../tests/unit/hr-termination-core.test.ts) e [schemas](../../../tests/unit/hr-termination-schema.test.ts) são pontos de partida; este levantamento não os trata como prova de entrega real do e-mail, SMS, webhook ou Storage. Para alterações, conferir permissão de gestão, versão atual, correção, CPF/telefone, assinatura SMS, evento e tarefa. A decisão do aviso e o encerramento serão traçados em outros guias.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
