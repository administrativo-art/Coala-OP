# Desligamento PJ: distrato, assinaturas e fechamento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** distrato e requisitos de fechamento traçados no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. A [abertura](termination-managed-start.md) captura o contrato de origem.

## Entrada e percurso

A [tela PJ](../../../src/features/hr/termination/pj-termination-detail.tsx) chama ações em [`PATCH /api/hr/terminations/[id]`](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts). A rota usa o contexto autenticado; cada operação de alteração busca o processo por [`requireManagedProcess`](../../../src/features/hr/termination/server.ts), que exige gestão de desligamentos.

1. `generate_pj_agreement` valida [dados financeiros e duas testemunhas](../../../src/features/hr/termination/schemas.ts). O [serviço](../../../src/features/hr/termination/server.ts) exige contrato original congelado e encerramento por acordo. Impede troca depois do envio; exige nota fiscal anterior ou igual ao pagamento, pagamento já realizado e e-mails/CPFs distintos entre signatários. Calcula valor proporcional como mensalidade ÷ 30 × dias trabalhados, gera PDF versionado com hash em Storage, substitui a versão corrente no dossiê e marca a revisão pendente. A confirmação de nota e pagamento conclui a etapa de obrigações.
2. `approve_pj_agreement` exige arquivo corrente em revisão, marca auditoria aprovada e libera assinaturas. `send_pj_agreement_signatures` exige aprovação e impede outro pedido de assinatura ativo para o mesmo documento. Registra `hrSignatureRequests`, envia à Autentique para representante da contratante, representante da prestadora e duas testemunhas, e deixa a etapa aguardando o provedor. Falha de envio registra erro no pedido e no processo. [Serviço](../../../src/features/hr/termination/server.ts).
3. A [leitura do processo](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts) pode reconciliar status da Autentique. Quando o documento final está assinado, [`markTerminationDocumentSigned`](../../../src/features/hr/termination/server.ts) baixa o PDF, grava no dossiê em Storage, libera visibilidade à pessoa e marca distrato e assinaturas como concluídos.
4. A [tela PJ](../../../src/features/hr/termination/pj-termination-detail.tsx) apresenta revogação de acesso e etapa operacional. `complete` na [rota](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts) chama [`completeTermination`](../../../src/features/hr/termination/server.ts), que exige distrato assinado e todas as etapas obrigatórias concluídas/dispensadas. Desabilita Firebase Auth, marca `users/{id}` inativo, fecha provisões financeiras futuras, grava processo concluído e remove a trava do funcionário. A [abertura](termination-managed-start.md) descreve a trava.

## Dados, permissão e dependências

| Local | Efeito observado |
| --- | --- |
| `terminationProcesses`, documentos e eventos no banco RH | Versões do distrato, assinatura, etapas, auditoria e encerramento. [Serviço](../../../src/features/hr/termination/server.ts). |
| Firebase Storage | PDF do distrato gerado e arquivo assinado; metadados incluem hash do arquivo e do contrato de origem. [Serviço](../../../src/features/hr/termination/server.ts). |
| `hrSignatureRequests` e Autentique | Solicitação com quatro pessoas e conciliação posterior. [Serviço](../../../src/features/hr/termination/server.ts). |
| Firebase Auth, `users`, provisões financeiras e acessos externos | Fechamento e revogações controlados por etapas separadas. [Serviço](../../../src/features/hr/termination/server.ts), [tela](../../../src/features/hr/termination/pj-termination-detail.tsx). |

**Inferência de impacto:** Storage, Autentique e Firestore não participam de uma transação única. Uma falha após gerar PDF ou enviar assinatura pode exigir retomada cuidadosa. A guarda de pedido ativo evita reenvio para o mesmo documento; alterações nessa regra precisam considerar assinaturas já criadas externamente. A conclusão também cruza Auth, perfil e provisões, então falhas parciais devem ser examinadas antes de repetir.

## Verificação e limites

Os [testes de etapas](../../../tests/unit/hr-termination-core.test.ts) cobrem a estrutura PJ, mas não o ciclo de PDF, Autentique e fechamento real. Ao mudar o distrato, conferir vínculo com contrato original, cálculo, data de NF/pagamento, quatro identidades únicas, versões, pedido repetido, conciliação, revogação e acesso após fechamento. Não foi feito teste integrado de serviços externos neste levantamento.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
