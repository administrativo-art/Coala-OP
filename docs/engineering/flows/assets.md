# Patrimônio: cadastro, movimentação e histórico

**Base conferida:** main `70aaab65`. Rastreamento estático; sem homologação integrada. As correções do worktree anterior não estão nesta entrega documental.

## Entrada, sequência e dados

A [página principal](../../../src/app/dashboard/assets/page.tsx) e a [entrada financeira](../../../src/app/dashboard/financial/assets/page.tsx) montam [AssetManagement](../../../src/components/asset-management.tsx). O [AssetsProvider](../../../src/components/assets-provider.tsx) consulta APIs e listeners de `assets`/`assetCategories`. A [listagem](../../../src/app/api/assets/route.ts) exige `assets.view`, filtra `workspaceId` e não pagina.

O POST da mesma rota exige `assets.create`, nome e unidade. Cadastro manual exige placa; origem de compra admite `PEND-…`. `assertAssetCodeCanBeUsed` consulta faixa gerada em `assetSettings` e duplicidade em `assets`, mas a consulta antecede a escrita. `assetRef.set` e `addMovement` são chamadas separadas: não há reserva transacional de placa, transação conjunta de bem/histórico ou executor de idempotência HTTP nesta base.

A [rota individual](../../../src/app/api/assets/[assetId]/route.ts) oferece GET/PATCH/POST para consulta, edição, transferência, status/baixa, etiqueta e retirada. Conferir a permissão de cada ramo (`view`, `edit`, `transfer`, `printLabels`) diretamente no handler. Leitura/atualização do bem e registro em `assetMovements` ocorrem em operações separadas; não assumir isolamento de workspace pela guarda da listagem. A [rota de histórico](../../../src/app/api/assets/[assetId]/movements/route.ts) exige `assets.viewHistory` e consulta `assetMovements` pelo ID recebido.

## Fronteiras de acesso

A [consulta por placa](../../../src/app/patrimonio/[code]/page.tsx) busca o bem e o histórico pelo Admin SDK e renderiza dados no servidor **sem exigir login nessa página**. Isso diverge da [regra aprovada](../business-rules.md). As rotas `assets/access` e `assets/by-code` e o retorno de login específico do QR não existem nesta base.

As [regras Firestore](../../../firestore.rules) devem ser conferidas para cada coleção: esta base não contém a concessão `assetAccessGrants` descrita na correção local anterior. Não inferir que esconder um botão impeça leitura direta. A consulta de bens em todas as unidades é uma decisão aprovada; ela não elimina o isolamento de workspace desejado.

O [upload](../../../src/app/api/assets/upload/route.ts) exige permissão de criação/edição e valida o bem existente e workspace. Storage, vínculo e auditoria não formam uma transação; não há o helper de compensação do worktree de correções. [Categorias](../../../src/app/api/assets/categories/route.ts) e [etiquetas](../../../src/app/api/assets/barcode-labels/route.ts) têm permissões próprias. Etiquetas controlam faixa e intervalos produzidos em transações, o que não garante unicidade concorrente do cadastro.

## Dependências e verificações

[Compras](purchasing-order-receipt.md) pode criar bens, movimentos e vínculo com pedido/recebimento/item. Revisar a quantidade acumulada de entregas parciais, concorrência e descarte de arquivos antes de mudar esse contrato. Principais coleções: `assets`, `assetMovements`, `assetCategories`, `assetSettings`, `purchase_receipts` e Storage.

Referências disponíveis: [testes de regras](../../../tests/security/firestore.rules.test.mjs) e [regras gerais](../../../tests/security/rules.test.mjs). Testes da correção local anterior não foram transportados nem representam a main. Casos ainda necessários: login/QR, escopo individual, cadastro mínimo, disputa de placa, falha entre bem e histórico, repetição HTTP, entrega parcial, retenção de upload e paginação. Ver [limites da integração documental](../main-map-integration.md).
