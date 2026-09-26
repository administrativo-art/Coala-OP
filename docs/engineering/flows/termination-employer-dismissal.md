# Dispensa CLT sem justa causa iniciada pelo RH

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** comunicação oficial e desbloqueio da contabilidade traçados no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. As etapas de contador, pagamento e fechamento estão em [outros guias](termination-notice-accountant.md).

## Entrada e percurso

A [abertura pelo RH](termination-managed-start.md) exige confirmação de comunicação presencial, local, data, aviso e motivo interno via [schema](../../../src/features/hr/termination/schemas.ts). Para `Dispensa sem justa causa`, [`createManagedTermination`](../../../src/features/hr/termination/server.ts) cria etapas guiadas, vínculo de ASO demissional e tenta [`sendEmployerDismissalNotice`](../../../src/features/hr/termination/server.ts).

O serviço resolve signatário documental da empregadora, gera PDF do comunicado, grava no Storage e envia à Autentique para empresa e colaborador. Atualiza documento/etapa para `waiting_external` e registra `hrSignatureRequests`. Se o envio inicial falhar, a abertura preserva o processo com status de falha e comunicação bloqueada; [`retryEmployerDismissalNotice`](../../../src/features/hr/termination/server.ts), exposto em [`PATCH /api/hr/terminations/[id]`](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts), tenta novamente.

Quando a assinatura é reconciliada, [`markTerminationIdentitySigned`](../../../src/features/hr/termination/server.ts) arquiva o PDF assinado, conclui a etapa, libera contador e notifica RH. Alternativamente, `formalize_dismissal_notice_refusal` exige pelo menos duas testemunhas e descrição da recusa; registra o evento e libera contador sem assinatura do colaborador. A [rota de detalhe](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts) exige contexto autenticado e o serviço usa `requireManagedProcess` nas ações de gestão.

## Dados, dependências e impacto

| Local | Efeito observado |
| --- | --- |
| `terminationProcesses`, documentos e eventos no banco RH | Comunicação presencial, PDF, assinatura/recusa e etapa do contador. [Serviço](../../../src/features/hr/termination/server.ts). |
| `hrSignatureRequests`, Autentique e Storage | Pedido de assinatura e arquivo do comunicado. [Serviço](../../../src/features/hr/termination/server.ts). |
| `onboardingProcesses` com `processKind=termination_aso` | Espelho do ASO demissional criado na abertura. [Serviço](../../../src/features/hr/termination/server.ts). |

**Inferência de impacto:** PDF em Storage, envio externo, atualização do processo e registro do pedido de assinatura não formam transação única. O retry precisa considerar pedido já aceito pelo provedor para evitar comunicado duplicado. A liberação do contador depende da assinatura ou da recusa formalizada; alterar essa guarda afeta os prazos e o pacote de documentos posterior.

## Verificação e limites

Os [testes das etapas de dispensa](../../../tests/unit/hr-termination-core.test.ts) são referência estrutural. Para mudar este ramo, conferir ausência de signatário, falha no provedor, tentativa repetida, assinatura concluída, recusa com menos de duas testemunhas, ASO e contador bloqueado/liberado. Não foi executada integração real com Autentique neste levantamento.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
