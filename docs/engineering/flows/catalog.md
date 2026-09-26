# Catálogo de fichas técnicas

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** grupo `catalog` traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Teste de acesso e custo de leitura ainda pendentes para `Verificado`.

## Entrada e percurso

A [página comercial](../../../src/app/dashboard/commercial/page.tsx) mostra [`CatalogoView`](../../../src/components/catalogo/catalogo-view.tsx) quando a pessoa pode ver dashboard e fichas técnicas. O componente obtém token e faz `GET /api/catalogo`; não há ação de edição no componente.

A [rota](../../../src/app/api/catalogo/route.ts) exige usuário autenticado e `canViewTechnicalSheets` no servidor. Lê `productSimulations`, `productSimulationItems`, `baseProducts` e `productSimulationCategories`; monta linhas de categoria, produtos não arquivados, ingredientes e campos de preparo/qualidade, ordenando SKU e nome. Tenta registrar auditoria `technical_catalog_viewed` com contagem de produtos/linhas, mas a falha do log não impede a resposta.

## Dados, permissão e impacto

As quatro coleções são lidas, sem alteração de produto pela página. O `GET` **faz escrita de auditoria** e lê as quatro coleções sem filtros/limites; isso pode aumentar custo e latência à medida que o catálogo cresce. A auditoria é uma exceção observada à regra atual de GET sem efeitos em [`AGENTS.md`](../../../AGENTS.md). **Inferência de impacto:** mudar vínculo entre item, produto base e simulação altera ingredientes exibidos; teste de permissão só na interface não protege a API, que possui sua própria verificação.

## Verificação e limites

Para mudanças, verificar perfil autorizado/restrito, produto arquivado, item cujo produto base foi removido, ordenação e falha de auditoria. Não há teste específico do percurso catálogo identificado neste levantamento; falta teste com volume e medição das leituras. O conteúdo de ficha técnica é comportamento implementado, não regra comercial aprovada por este guia.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
