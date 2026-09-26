# Cadastro de itens, insumos e entidades

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

As páginas de [itens](../../../src/app/dashboard/registration/items/page.tsx), [insumos](../../../src/app/dashboard/registration/base-products/page.tsx) e [entidades](../../../src/app/dashboard/registration/entities/page.tsx) compartilham [`RegistrationCatalog`](../../../src/components/registration/registration-catalog.tsx) e provedores de dados. A API curinga [`/api/registry/[...path]`](../../../src/app/api/registry/[...path]/route.ts) exige `requireUser` e decide leitura/criação/edição/exclusão por recurso em `canUseRegistryResource`. `products` pode ser lido também por estoque, compras e ficha técnica; `base-products` por estoque, compras e preços; `entities` por compras. A rota normaliza unidade de medida para produto/insumo, verifica CPF/CNPJ duplicado em `entities` e executa ações específicas por recurso.

As rotas de [produto](../../../src/app/api/products/route.ts), [edição de produto](../../../src/app/api/products/[id]/route.ts) e [empresa](../../../src/app/api/companies/route.ts) são entradas adicionais, usadas por modais. Cadastros alimentam [compras](purchasing-order-receipt.md), [estoque](stock-control.md), [preços](pricing.md) e [uniformes](uniforms.md). Confirmar qual endpoint cada ação usa e os efeitos de exclusão antes de alterar schema. A verificação de documento duplicado lê `entities` inteira; medir custo e corrida de gravações paralelas se crescer. `npm run check` passou; autorização e consumidores de cada tipo ainda exigem auditoria para `Verificado`.

## Variantes, persistência e efeitos cruzados

Na [API curinga](../../../src/app/api/registry/[...path]/route.ts), criação/edição de produto e insumo normaliza medidas; entidades verificam documento duplicado antes da escrita, e a edição atualiza `departmentEmailPurposes` com o cadastro. Excluir entidade inativa o registro com autor/data; excluir os demais cadastros usa remoção física. Esses handlers não reescrevem lotes, pedidos ou simulações dependentes. Sessões de contagem têm autorização de proprietário e finalização específica, descritas em [contagem](stock-count.md). Categorias operacionais mantêm workspace e auditoria.

A entrada adicional de produto usa [`InternalProductRepository`](../../../src/lib/barcode/internal-product-repository.ts): exige consulta ou nome base, combina dados normalizados com campos confirmados, cria ID ou atualiza o informado e registra autoria. Fontes da consulta são gravadas depois do produto; edição faz merge sem migrar lotes. Cache de código de barras e proveniência da consulta não equivalem ao cadastro confirmado.

A [criação de empresa](../../../src/app/api/companies/route.ts) exige `getCompanyUserContext` e `canCreateCompany`, normaliza o payload pelo [serviço](../../../src/lib/company/company-registration-service.ts) e chama [`InternalCompanyRepository`](../../../src/lib/company/internal-company-repository.ts). O repositório valida CNPJ, rejeita duplicata com outro ID, grava `entities` e só depois as fontes consultadas. A consulta de duplicidade não está na mesma transação da criação. Inferência: concorrência ou falha posterior pode deixar duplicidade ou proveniência incompleta; testar essas situações no item de verificação integrada.

Produtos/insumos são referenciados por ID nos consumidores de compras, estoque, fichas e preços indicados acima. Não tratar alteração cadastral como atualização retroativa dos snapshots históricos. Verificação pendente: referências após exclusão, permissões diretas de cada recurso, duplicidade concorrente e recuperação da gravação de fontes.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
