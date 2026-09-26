# Conversões de medidas e de inventário

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** `measure-conversion` verificado por leitura do percurso local e checagem dirigida dos fatores; `inventory-conversion` traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Conversões não escrevem dados.

## Percursos

A [página de medidas](../../../src/app/dashboard/conversions/page.tsx) monta [`MeasureConverter`](../../../src/components/measure-converter.tsx). O usuário escolhe categoria, valor, unidade de origem e destino; `handleCategoryChange` redefine unidades válidas, `handleSwap` troca origem/destino e `useMemo` calcula com [`convertValue`](../../../src/lib/conversion.ts). O arquivo `conversion.ts` define categorias, fatores de Massa/Volume/Unidade/Embalagem/Vestimenta, normaliza o alias `unidade` e rejeita unidade inválida. A página não faz chamada de API, não acessa banco e não grava dados. O resultado formatado usa até cinco casas decimais.

A [página de inventário](../../../src/app/dashboard/inventory/page.tsx) monta [`InventoryConverter`](../../../src/components/inventory-converter.tsx). Este lê produtos por [`useProducts`](../../../src/hooks/use-products.ts), remove os arquivados, usa a categoria/unidade e `packageSize` do produto para converter de/para `Pacote(s)`, e usa o mesmo `convertValue` para unidades padrão. O cálculo é apenas no cliente e não altera saldo ou cadastro. O [provider de produtos](../../../src/components/products-provider.tsx) mantém listener de toda a coleção `products`, normaliza a unidade e a categoria e ordena nomes. Se o listener falhar, chama o [bootstrap autenticado](../../../src/app/api/client/bootstrap/route.ts) com `products`; esse ramo também lê a coleção completa, sem permissão adicional específica para produtos. As [regras Firestore](../../../firestore.rules) permitem leitura de `products` para `isAuth()`. A página recebe a proteção de sessão do layout, sem guard próprio.

No conversor de inventário, multiplicar pacotes usa `packageSize`; dividir por pacote retorna `...` quando o tamanho é exatamente zero. O componente não valida ali todos os casos de cadastro malformado, como tamanho ausente/não numérico. Alterar schema de produtos, normalização ou embalagem exige conferir o resultado e os demais consumidores. O custo do listener cresce com o catálogo; este fluxo não filtra no servidor por produto selecionado.

## Dependências e verificação

`convertValue` também é usado por estoque e outras áreas; mudança em fator, alias ou arredondamento exige localizar seus consumidores. O [teste de conversão](../../../tests/unit/conversion.test.ts) cobre o alias `unidade` → `un`. `npm run check` passou; o teste dirigido desse arquivo passou (2/2). Uma verificação local adicional conferiu `1 kg = 1000 g`, `1 l = 1000 ml`, ida/volta para todos os pares de cada categoria e rejeição de par incompatível. A página padrão foi conferida como cálculo local, sem API, banco ou gravação; o [layout](../../../src/app/dashboard/layout.tsx) exige sessão, sem permissão específica para conversor. Assim, `measure-conversion` está `Verificado` para o contrato observado. Renderização visual e acessibilidade não foram testadas em navegador. Para `inventory-conversion`, ainda testar produto arquivado, embalagem zero/ausente, falha do listener e custo do catálogo antes de marcar `Verificado`.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
