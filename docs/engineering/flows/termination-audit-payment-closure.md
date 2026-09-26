# Desligamento CLT: auditoria, pagamento e encerramento guiado

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. A [abertura gerenciada](termination-managed-start.md) e o [distrato PJ](termination-pj-agreement.md) têm guias próprios; [variantes CLT](termination-other-clt-reasons.md) estão documentadas; verificação integrada continua pendente.

## Entrada e percurso

A [tela de detalhe](../../../src/features/hr/termination/employee-resignation-detail.tsx) envia revisão de documentos, sincronização de pagamento, pacote final, bloqueio de acessos e fechamento por [`PATCH /api/hr/terminations/{id}`](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts). O [serviço](../../../src/features/hr/termination/server.ts) exige processo gerenciado pelo RH em cada ação.

1. [`auditTerminationDocuments`](../../../src/features/hr/termination/server.ts) exige revisão de cada documento atual do contador. Correções exigem motivo, geram novo token com prazo de 30 dias, e-mail e evento. Se todos forem aprovados, grava visibilidade/modo de assinatura, conclui etapas de contador/auditoria e chama `createTerminationPaymentControl` após salvar o processo.
2. O controle financeiro exige valor líquido e prazo; para valor zero ou ausência de pagamento, marca `not_applicable`. Para valor positivo, [`createPaymentRequest`](../../../src/features/financial/payment-requests/service.server.ts) gera solicitação com `sourceType: termination`; o processo registra ID/estado e notifica o Financeiro. `prepare_payment` permite retentar, e `sync_payment` valida a origem da solicitação antes de projetar estado, valor, data e comprovante. A autorização bancária é uma ação separada do Financeiro. [Serviço](../../../src/features/hr/termination/server.ts).
3. Após assinaturas e pagamento `paid`/`not_applicable`, [`sendTerminationEmployeePackage`](../../../src/features/hr/termination/server.ts) envia link por e-mail com token de 90 dias, marca entrega ao colaborador e prepara bloqueio de acessos. [`revokeTerminationAccess`](../../../src/features/hr/termination/server.ts) só atua a partir do fim do contrato e após entrega; remove IDs do PDV pela API, enquanto Bizneo e plano de saúde são confirmados pelo RH nesta função. `completeTerminationOperations` exige acessos concluídos, retirada das escalas e benefícios encerrados.
4. [`completeEmployeeResignation`](../../../src/features/hr/termination/server.ts) exige aviso e etapas obrigatórias concluídas. Consulta uniformes pendentes e ASO; aceita ressalva de uniformes ou não comparecimento ao ASO somente com justificativa e, para ASO, agendamento vencido. Desativa a autenticação e o cadastro do colaborador, fecha provisões financeiras futuras, marca processo `completed`, remove índice de desligamento ativo, recalcula retenção de documentos e cria eventos. Há outra função de fechamento para fluxos não guiados.

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `terminationProcesses`, eventos e documentos no banco RH | Auditoria, etapas, encerramento | `requireManagedProcess` e validações por ação. |
| Solicitação financeira | Preparação e leitura do pagamento | Origem `termination`, autorização financeira separada. |
| `users`, Firebase Auth, uniformes, provisões futuras e retenção | Desativação e limpeza de efeitos | Efeitos após pré-condições de fechamento. |
| PDV, e-mail e portal do colaborador | Revogação e entrega final | Integrações externas; estados locais registrados. |

**Inferência de impacto:** o encerramento distribui efeitos por Auth, bancos, PDV, e-mail e retenção sem transação única. Mudanças em pré-condições ou ordem podem produzir processo concluído com um efeito externo pendente; confira estados e recuperação antes de alterar. O [mapa de efeitos do desligamento](../../termination-effects-map.md) fornece contexto adicional.

## Verificação e limites

Os [testes de núcleo](../../../tests/unit/hr-termination-core.test.ts) são ponto de partida; não comprovam reconciliação bancária real, revogação externa nem fechamento de provisões. Para mudanças, verificar documentos correntes, seleção para o colaborador, modo de assinatura, pagamento autorizado, token, data de término, PDV/Bizneo, ASO, uniformes, Auth e retenção. Os outros guias citados documentam a abertura e o distrato, sem certificação integrada.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
