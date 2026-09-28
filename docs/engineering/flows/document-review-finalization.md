# Conferência, finalização e descarte de documento gerado

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Este guia registra o comportamento implementado; [regras aprovadas](../business-rules.md) ficam separadas.

## Entrada e percurso

[`documents/generated/page.tsx`](../../../src/app/dashboard/documents/generated/page.tsx) carrega documentos pela [listagem](../../../src/app/api/documents/generated/route.ts), que exige `documents.view`, limita a consulta a 300 registros e oculta caminhos de Storage; `manualValues` depende de `sensitiveData.view`. A interface oferece gerar PDF, aprovar, finalizar e descartar conforme estado e permissão de revisão. A [rota do documento](../../../src/app/api/documents/generated/%5Bid%5D/route.ts) volta a verificar `documents.review` no servidor para todas essas mutações.

1. Quando falta PDF, `POST /api/documents/generated/{id}` baixa o DOCX, converte em PDF e aplica papel timbrado. Salva o PDF no Storage e metadados/hash em `generatedDocuments/{id}`. Se o conversor não estiver disponível, marca `pdfGenerationStatus: unavailable` e responde 503. Se já há `pdfStoragePath`, reutiliza o registro. [Rota](../../../src/app/api/documents/generated/%5Bid%5D/route.ts).
2. `PATCH` aceita `approved`, `final` ou `cancelled`; normaliza `draft` para `review_pending` e consulta [`canTransitionGeneratedDocument`](../../../src/features/hr/documents/document-lifecycle.ts). Exige PDF oficial e ausência de `missingRequired`. Na aprovação, grava revisor e data. Na finalização, preserva protocolo existente ou aloca um protocolo `DOC`, depois grava finalizador e data. Para cancelamento permitido, grava ator e data. [Rota](../../../src/app/api/documents/generated/%5Bid%5D/route.ts).
3. `DELETE` aceita somente `draft` ou `review_pending` e recusa `legalHold`. Exclui DOCX/PDF do Storage, depois usa batch no banco principal para excluir `audit/resolvedValues` e marcar o documento `discarded`, removendo caminhos e dados pessoais selecionados. A interface pede confirmação antes da chamada e remove o item da lista local após sucesso. [Rota](../../../src/app/api/documents/generated/%5Bid%5D/route.ts), [interface](../../../src/app/dashboard/documents/generated/page.tsx).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `generatedDocuments` no banco principal | Consulta, status, protocolo, hash e metadados de PDF | `documents.view` para lista; `documents.review` para mutações. |
| `generatedDocuments/{id}/audit/resolvedValues` | Exclusão no descarte | Batch junto à atualização de descarte. |
| Storage | Leitura DOCX, gravação PDF, exclusão DOCX/PDF | Rotas `POST` e `DELETE`; autorização nas rotas. |
| Protocolo | Alocação na finalização sem protocolo prévio | [`allocateDocumentProtocol`](../../../src/features/hr/documents/document-protocol.server.ts). |

O estado `approved` ou `final` habilita o [envio avulso para assinatura](document-standalone-signature.md) quando o escopo do documento é `independent`. A [retenção](../../../src/features/hr/documents/document-retention.server.ts) pode atualizar prazos de documentos gerados após desligamento. **Inferência de impacto:** gravação no Storage, alocação de protocolo e atualização do documento não formam uma transação única; falhas entre essas etapas podem deixar resultados parciais. A leitura e a escrita do `PATCH` também são separadas; mudanças nas transições exigem conferir concorrência e consumidores.

## Verificação e limites

O [teste de estados documentais](../../../tests/unit/hr-documents/document-foundation.test.ts) cobre apenas algumas transições do helper. Este levantamento não encontrou nesse teste cobertura das rotas, da conversão, do descarte ou de falhas parciais no Storage. Para alterar este subfluxo, conferir `documents.review`, filtro de dados sensíveis, PDF, `missingRequired`, transições, protocolo, `legalHold` e descarte físico/lógico. A política desejada de revisão e retenção precisa ser confirmada separadamente do comportamento observado.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
