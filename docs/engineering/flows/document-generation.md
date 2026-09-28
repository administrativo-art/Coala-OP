# Geração de documento a partir de modelo publicado

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** geração inicial traçada no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Revisão, assinatura, arquivamento e descarte estão nos [guias complementares](../flow-coverage.md). Consulte [regras aprovadas](../business-rules.md) para política desejada.

## Entrada e percurso

[`documents/generator/page.tsx`](../../../src/app/dashboard/documents/generator/page.tsx) monta [`document-generator-workspace.tsx`](../../../src/components/documents/document-generator-workspace.tsx). A tela envia `POST /api/documents/generate` com Bearer token, modelo, colaborador, valores manuais e formulário. A geração pela interface solicita `lifecycle: 'draft'` e `output: 'json'`, depois abre o PDF pela rota de arquivo gerado; outros chamadores, como integração RH, usam a mesma API. [Tela](../../../src/components/documents/document-generator-workspace.tsx), [rota](../../../src/app/api/documents/generate/route.ts).

1. A rota exige `assertFormalizationAccess(request, 'documents.generate')`, `templateId` e avalia separadamente `sensitiveData.view`. Passa ao serviço a identidade do ator e os dados permitidos. [Fonte](../../../src/app/api/documents/generate/route.ts).
2. [`generateDocumentFromTemplate`](../../../src/features/hr/documents/generate-document.server.ts) procura `companyDocumentTemplates` publicado com arquivo no Storage ou modelo de sistema publicado em DOCX. Exige colaborador/integração quando o formulário não admite uso independente. Resolve dados, valores manuais, entidade legal e protocolo; rejeita tokens do DOCX que permanecerem sem resolução.
3. Calcula chave de geração a partir de modelo/versão/hash, pessoa, dados resolvidos, valores e revisão. Se `generatedDocuments/{id}` já existe, reutiliza o DOCX e pode completar o PDF ausente. Em novo documento, salva DOCX e tenta converter/salvar PDF no Storage. [Fonte](../../../src/features/hr/documents/generate-document.server.ts).
4. Grava por batch `generatedDocuments/{id}` e `audit/resolvedValues`, com hashes, partes, status (`review_pending` para draft; `final` para final), retenção e origem. Em modelo de vale-transporte, o mesmo batch pode atualizar `transportVoucherDecisions` e marcar documento anterior como `superseded`. A rota responde JSON resumido ou DOCX. [Serviço](../../../src/features/hr/documents/generate-document.server.ts), [rota](../../../src/app/api/documents/generate/route.ts).

## Dados, acesso e contratos

| Item | Operação | Controle observado |
| --- | --- | --- |
| `companyDocumentTemplates` ou fonte de sistema | Leitura | Exige versão publicada e DOCX; validações no serviço. |
| Colaborador/integração e entidade legal | Leitura | `resolveDocumentData` recebe `includeSensitive` conforme permissão de servidor. |
| Storage | Download do modelo e gravação DOCX/PDF | Arquivo salvo antes do batch de metadados; falhas entre sistemas precisam ser consideradas. |
| `generatedDocuments`, subcoleção `audit`, eventual `transportVoucherDecisions` | Escrita em batch Firestore | Chave estável, hashes e retenção registrados no serviço. |

A existência do arquivo no Storage não confirma, sozinha, a conclusão do batch. **Inferência de impacto:** alterações na chave ou no tratamento de falhas podem mudar a deduplicação e deixar arquivos órfãos; confira ambos os lados antes de editar. PDF pode ficar indisponível; a interface informa isso e bloqueia a finalização por essa via. [Retenção](../../../src/features/hr/documents/document-retention.server.ts) e [assinatura](../../../src/features/hr/documents/signature-workflow.server.ts) são consumidores posteriores.

## Leitura posterior e outras entradas

A [central de documentos](../../../src/app/dashboard/documents/generated/page.tsx) consulta [`GET /api/documents/generated`](../../../src/app/api/documents/generated/route.ts), que exige `documents.view`, limita a 300 registros, oculta caminhos internos e só devolve valores manuais com `sensitiveData.view`. A [rota de arquivo](../../../src/app/api/documents/generated/%5Bid%5D/file/route.ts) exige `documents.view` e entrega DOCX ou PDF do Storage. A [rota de auditoria](../../../src/app/api/documents/generated/%5Bid%5D/audit/route.ts) exige `sensitiveData.view` e devolve `audit/resolvedValues` e metadados de hash/retenção. A [página inicial](../../../src/app/dashboard/documents/page.tsx) e a [página de gestão](../../../src/app/dashboard/documents/management/page.tsx) são entradas de navegação para gerador e central. Revisão/descarte seguem [guia próprio](document-review-finalization.md); assinatura segue [guia próprio](document-standalone-signature.md).

## Verificação e limites

Use [`tests/unit/hr-documents`](../../../tests/unit/hr-documents) para localizar casos de documentos; este levantamento ainda não atribui cobertura completa ao fluxo da rota e às falhas Storage/Firestore. Para mudanças na geração, conferir template, variáveis, permissão sensível, chave de deduplicação, PDF e retenção. [Guia do gerador](../../GERADOR-DE-DOCUMENTOS.md).

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
