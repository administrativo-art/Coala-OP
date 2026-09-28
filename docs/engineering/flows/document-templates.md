# Modelos documentais: cadastro, mapeamento e publicação

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [lista de modelos](../../../src/app/dashboard/documents/templates/page.tsx) exige `templates.view` e usa [`GET /api/documents/templates`](../../../src/app/api/documents/templates/route.ts); a rota reúne modelos do sistema e documentos em `companyDocumentTemplates`, lendo a coleção inteira, excluindo os marcados `deletedAt` e ordenando em memória. A criação na página usa `POST` da mesma rota com `templates.manage`: grava modelo `draft`, versão 1 e estado inicial de preparação; depois envia o DOCX por [`POST /api/documents/templates/[id]/file`](../../../src/app/api/documents/templates/%5Bid%5D/file/route.ts). Registro e arquivo são passos separados.

A [página individual](../../../src/app/dashboard/documents/templates/%5Bid%5D/page.tsx) permite mapear variáveis, revisar sugestões, enviar nova versão, avançar homologação, testar integridade e gerar documento. [`PATCH /api/documents/templates/[id]`](../../../src/app/api/documents/templates/%5Bid%5D/route.ts) bloqueia edição de conteúdo quando o estado oficial/publicado não permite, exige `templates.manage` para editar e `templates.publish` para publicar. A publicação exige DOCX, todas as variáveis mapeadas, validação de papel timbrado e padrão documental; candidato oficial precisa seguir a [rota de workflow](../../../src/app/api/documents/templates/%5Bid%5D/workflow/route.ts). O documento gerado segue o [fluxo de geração](document-generation.md).

A tela inclui [acordos coletivos](../../../src/components/hr/documents/collective-agreements-panel.tsx), servidos por [`/api/documents/collective-agreements`](../../../src/app/api/documents/collective-agreements/route.ts) com permissões `templates.view/manage`. Mudanças de unidade, vigência ou vínculo precisam conferir esse subfluxo antes de considerar a cobertura completa.

## Dados, dependências e verificação

`companyDocumentTemplates` guarda metadados, estado, mapeamento e referência ao arquivo no Storage; modelos de sistema entram por configuração em código. A rota individual exige `templates.view` para leitura e separa `manage` de `publish` na escrita. A revisão e geração têm permissões próprias (`documents.review`, `documents.generate`, `documents.view`). Referências de teste: [permissões de formalização](../../../tests/unit/hr-documents/formalization-permissions.test.ts) e os testes do [fluxo de geração](document-generation.md). `npm run check` passou na verificação anterior do mapa (2026-09-25). Testar criação com falha no upload, variável ausente, DOCX inválido, publicação de candidato oficial, versão editável e acesso direto às rotas antes de elevar o grupo a `Verificado`.

## Versão oficial e acordos rastreados

[`editable-version`](../../../src/app/api/documents/templates/[id]/editable-version/route.ts) exige gestão, aceita fonte oficial DOCX ou candidato oficial homologável/publicado e reutiliza derivação draft existente. Se não há, copia a fonte para novo ID/versão, extrai variáveis, valida timbre e grava Storage, candidato e subcoleção `versions` sequencialmente. Preserva referência à versão raiz e inicia `technical_validation`; não sobrescreve o oficial.

[`workflow`](../../../src/app/api/documents/templates/[id]/workflow/route.ts) valida transição com `canTransitionDocumentTemplateWorkflow`, exige observação e permissão `publish` ao publicar (`manage` nas demais). Candidato oficial precisa mapeamento completo, validação de timbre/padrão, teste fictício registrado, atestados de layout/preenchimento e integridade real do DOCX para avançar. Registra `sameActorAsEditor`; esse campo não é por si uma proibição de autoaprovação. Publicação atualiza candidato e marca fonte substituída em batch; retorno para ajuste mantém histórico. Upload/editor/IA continuam preparando a fonte; geração consome apenas versão elegível conforme [geração documental](document-generation.md).

[CCT](../../../src/app/api/documents/collective-agreements/route.ts) usa `documentCollectiveAgreements`: criação exige gestão, schema, unidade ativa e ausência de vigência sobreposta entre registros não arquivados. Consulta da sobreposição e criação são separadas. [PATCH](../../../src/app/api/documents/collective-agreements/[id]/route.ts) só aceita `archived`, idempotente; alteração exige nova vigência. Arquivar não reescreve documentos previamente gerados. Testes de concorrência, integridade e homologação pertencem à etapa seguinte.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
