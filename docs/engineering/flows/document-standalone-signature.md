# Assinatura avulsa de documento gerado

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Geração, revisão e finalização anteriores são passos distintos. Este guia descreve o comportamento implementado.

## Entrada e percurso

[`documents/generated/page.tsx`](../../../src/app/dashboard/documents/generated/page.tsx) permite enviar para assinatura, atualizar o estado e abrir a trilha. As chamadas chegam a [`/api/documents/generated/[id]/signature`](../../../src/app/api/documents/generated/%5Bid%5D/signature/route.ts). `GET` exige `signatures.view` e monta uma linha do tempo de `generatedDocuments`, `hrSignatureRequests` e eventos da Autentique. `POST` exige `signatures.send` para envio ou `signatures.view` para `action: "reconcile"`.

1. [`sendGeneratedDocumentForStandaloneSignature`](../../../src/features/hr/documents/signature-workflow.server.ts) exige status `approved` ou `final`, escopo `independent` e PDF oficial. Resolve signatários das partes, empresa ou colaborador; aceita destinatário explícito e exige e-mails válidos. Reutiliza a solicitação `signature_generated_{generatedDocumentId}` se ela já tiver ID no provedor.
2. O serviço baixa o PDF do Storage, reserva protocolo, compõe pacote com manifesto e salva PDF pré-assinatura e manifesto. Cria `hrSignatureRequests/{id}` com status `sending`, envia à Autentique e atualiza a solicitação e `generatedDocuments/{id}` para `sent`/`final`. Em falha de envio, registra `failed` na solicitação e propaga o erro. [Fonte](../../../src/features/hr/documents/signature-workflow.server.ts).
3. O [webhook da Autentique](../../../src/app/api/webhooks/autentique/route.ts) exige segredo e assinatura válidos, rejeita evento já registrado em `hrAutentiqueWebhookEvents`, localiza a solicitação pelo ID do documento no provedor e atualiza seu estado. Em `document.finished` com URL assinada, agenda o arquivamento após a resposta. A reconciliação manual consulta o provedor e também arquiva quando encontra assinatura completa. [Fonte](../../../src/features/hr/documents/signature-workflow.server.ts).
4. [`archiveAutentiqueSignedDocument`](../../../src/features/hr/documents/signature-workflow.server.ts) baixa o PDF assinado e salva em `signed-documents/generated/{generatedDocumentId}/{signatureRequestId}/signed.pdf`. Se houver colaborador, pode criar `employeeDocuments/{id}` no banco de RH. Atualiza documento gerado e solicitação com hash, localização, status `signed` e data de arquivamento. Retorna o ID já arquivado quando a solicitação o registra.

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `generatedDocuments` no banco principal | Leitura e atualização de status, protocolo e arquivo assinado | Rota e serviço de assinatura. |
| `hrSignatureRequests`, `hrAutentiqueWebhookEvents`, eventual `employeeDocuments` no banco de RH | Solicitação, eventos e documento arquivado | Serviço e webhook. |
| Storage e Autentique | PDFs, manifesto, envio, webhook e consulta de estado | Serviço e webhook. |
| Permissões e assinatura do webhook | `signatures.send`/`signatures.view`; assinatura do provedor | Rotas de assinatura e webhook. |

**Inferência de impacto:** Storage, provedor e dois bancos são atualizados em etapas; falhas parciais podem exigir reconciliação. Alterações no ID da solicitação, protocolo, hash, escopo ou roteamento do webhook podem afetar deduplicação e arquivamento.

## Verificação e limites

Há [teste unitário do compositor avulso](../../../tests/unit/hr-documents/document-pdf-composer.test.ts) e [teste da interpretação de `document.finished`](../../../tests/unit/hr/autentique-core.test.ts). Eles não comprovam envio real, webhook nem gravações cruzadas em banco/Storage. Para mudanças, confira autorização, elegibilidade, signatários, reutilização, evento duplicado, reconciliação e arquivamento. Revisão/finalização anteriores ao envio estão no [guia próprio](document-review-finalization.md).

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
