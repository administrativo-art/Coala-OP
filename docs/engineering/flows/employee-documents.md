# Documentos por colaborador: resumo e configuração de visibilidade

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página `/dashboard/documents/collaborators`](../../../src/app/dashboard/documents/collaborators/page.tsx) reexporta a [central de documentos DP](../../../src/app/dashboard/dp/documents/page.tsx). A central reúne usuários ativos/inativos conforme `canAccessUserByUnit`, mostra contagens por pessoa e leva ao perfil documental individual. Para leitura geral a interface exige `dp.collaborators.view` sem `ownProfileOnly`, ou `settings.manageUsers`; perfil próprio é redirecionado para a página individual. Ela busca [`GET /api/hr/employee-documents/summary`](../../../src/app/api/hr/employee-documents/summary/route.ts).

A rota de resumo exige acesso RH de leitura, carrega configurações e IDs de colaboradores visíveis, lê todas as coleções `employeeDocuments` e `documentUploadBatches`, e consulta `documentUploadItems` por lote em revisão. Ela filtra autorização documental com [`canAccessDocument`](../../../src/lib/hr/employee-document-access.ts) antes de contar status, confidenciais, categorias e pendências. A leitura completa e as consultas por lote merecem medição de custo; a resposta não deve expor contagens de documentos que o ator não pode ver.

O painel de configuração chama [`GET/PUT /api/hr/employee-documents/visibility`](../../../src/app/api/hr/employee-documents/visibility/route.ts). A rota exige acesso RH de gerenciamento, normaliza níveis permitidos e grava `schema/field_map.document_visibility`; em seguida grava um evento na subcoleção `audit`. As duas escritas são sequenciais. A interface permite abrir a configuração com `settings.manageUsers` ou `dp.collaborators.edit`; conferir se o mapeamento dessas permissões coincide com o acesso RH `manage` do servidor.

## Dados, impacto e verificação

O resumo lê `employeeDocuments`, `documentUploadBatches` e `documentUploadItems` no banco RH; a configuração muda `schema/field_map`, que influencia acesso ao perfil individual e documentos em outros fluxos. Consulte [geração de documentos](document-generation.md) e [integração](onboarding-public-documents.md) ao mudar categorias ou visibilidade. `npm run check` passou na verificação anterior do mapa (2026-09-25). Para mudança funcional, verificar perfis próprios/restritos, unidade, categoria confidencial, lote em revisão, escala das consultas e falha entre atualização de configuração e auditoria. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Upload, revisão, arquivo e limpeza rastreados

[`analyze-upload`](../../../src/app/api/hr/employee-documents/analyze-upload/route.ts) exige gestão RH e unidade do empregado, lê documentos existentes, calcula hashes, compara identidade/duplicidade e salva temporários, `documentUploadItems`, auditorias e `documentUploadBatches`. Análise sugere classificação e campos; não equivale a arquivamento. [`item`](../../../src/app/api/hr/employee-documents/item/route.ts) permite corrigir classificação/pessoa, aceitar duplicidade prevista ou descartar: descarte remove temporário, marca `discarded`, audita e recalcula contadores do lote, em etapas separadas.

[`confirm`](../../../src/app/api/hr/employee-documents/confirm/route.ts) seleciona itens `ready`, trava cada um em `filing` por transação e exige identidade `MATCH` e escopo de unidade. Reconfere hash/chave lógica contra o dossiê; duplicata exata reutiliza documento, sem nova versão. Reserva versão em contador transacional, grava arquivo definitivo/nome padronizado, `employeeDocuments` e auditoria, aplica sugestões/autopreenchimento de perfil quando cabível, apaga temporário e marca `filed`. Falha marca item `failed`; retorna sucessos/falhas por item e atualiza lote, sem rollback dos itens anteriores. Contador, Storage e documento não formam uma transação única.

[`access`](../../../src/app/api/hr/employee-documents/access/route.ts) exige leitura RH, unidade e `canAccessDocument` segundo tipo/confidencialidade/configuração; registra acesso e contador ao entregar binário. [`cleanup`](../../../src/app/api/hr/employee-documents/cleanup/route.ts) exige gestão RH mais administração/gestão de usuários; limita a 50 lotes expirados, tenta apagar temporários e remove itens recursivamente, sem tocar documentos arquivados. Erros individuais de remoção são capturados; contadores da resposta não comprovam remoção física. Esses pontos delimitam os testes de recuperação e acesso ainda necessários.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
