# Integração: pacote de documentos para assinatura

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. O arquivamento posterior ao retorno da Autentique é compartilhado com outros documentos.

## Entrada e percurso

A [tela de recrutamento](../../../src/components/hr/recruitment/recruitment-onboarding-view.tsx) usa [`/api/hr/onboarding/[id]/signature-documents`](../../../src/app/api/hr/onboarding/%5Bid%5D/signature-documents/route.ts). `GET` exige `signatures.view` e entrega estado ou arquivo; dados sensíveis na lista dependem de `sensitiveData.view`. `POST` exige `documents.generate` para selecionar/gerar/prévia, `documents.review` para aprovar/devolver, `signatures.send` para preparar posições/enviar/agir sobre signatários e `signatures.view` para reconciliar.

1. [`selectSignatureTemplates`](../../../src/features/hr/documents/signature-workflow.server.ts) exige etapa `signature_preparation`, pacote admissional completo e modelos de sistema publicados em DOCX. Grava seleção/ordem em `hrSignatureDocuments` por batch, preservando documentos já enviados. `generateSelectedSignatureDocuments` usa o [gerador documental](document-generation.md), marca falta de dados/PDF como bloqueio e registra arquivos/IDs gerados.
2. `reviewSignaturePackage` exige todos os documentos selecionados gerados; aprovação exige PDFs e dados completos. Finaliza cada `generatedDocuments` no banco principal e, por batch no banco RH, marca o pacote `ready_to_send`. Devolução mantém `review_pending`. Prévia e editor de posições usam composição de pacote e hash; o envio exige `expectedPackageHash` para vincular posições ao conteúdo preparado. [Serviço](../../../src/features/hr/documents/signature-workflow.server.ts).
3. `sendSignatureDocuments` exige etapa correta, e-mail válido, pacote completo e todos os selecionados prontos. Agrupa componentes do kit, separa modelos de assinatura independente e envia à Autentique. Solicitações ficam em `hrSignatureRequests`; documentos e processo recebem IDs/estados de envio. Falhas marcam `failed`/`send_failed` conforme o ramo. A etapa avança a `signature` quando configurada. [Fonte](../../../src/features/hr/documents/signature-workflow.server.ts).
4. O [webhook Autentique](../../../src/app/api/webhooks/autentique/route.ts) atualiza a solicitação e arquiva PDFs assinados por [`archiveAutentiqueSignedDocument`](../../../src/features/hr/documents/signature-workflow.server.ts). `reconcileSignatureDocuments` consulta o provedor por solicitação e atualiza todos os componentes do kit ou arquiva se completo. Há ações específicas para reenviar convite, obter link, trocar e-mail do signatário e incluir signatário corporativo, com schema para ações individuais. [Rota](../../../src/app/api/hr/onboarding/%5Bid%5D/signature-documents/route.ts).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `onboardingProcesses`, `hrSignatureDocuments`, `hrSignatureRequests` no banco RH | Etapa, componentes e solicitações | Permissões por ação na rota; pré-condições no serviço. |
| `generatedDocuments` no banco principal e Storage | DOCX/PDF, protocolo, pacote e manifesto | Geração/revisão antes do envio. |
| Autentique e `employeeDocuments` | Convites, assinaturas, PDF arquivado | Webhook/reconciliação e arquivo do colaborador. |

**Inferência de impacto:** finalizar documentos no banco principal e atualizar o pacote no banco RH são operações separadas; falha parcial pode exigir revisão de ambos. Hash do pacote, IDs das solicitações e `signatureScope` orientam deduplicação, signatários e arquivamento. A [criação do colaborador](onboarding-activation.md) promove documentos assinados posteriormente.

## Verificação e limites

O [teste de contrato do servidor](../../../tests/unit/hr-documents/admission-signature-server-contract.test.ts) verifica pacote completo, hash/posições e reconciliação por solicitação; o [teste da interface](../../../tests/unit/hr-documents/admission-signature-ui.test.ts) cobre chamadas e controles específicos. Eles não substituem teste real de Autentique/Storage/bancos. Para mudança, conferir permissões, versão publicada, pacote completo, PDF, hash, signatários, webhook duplicado, reconciliação e promoção ao arquivo do colaborador.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
