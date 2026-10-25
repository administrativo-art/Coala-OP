---
name: coala-reposicao
description: Calcula e apresenta a reposição atual de estoque do Coala quando o usuário pede para trazer, listar ou recalcular a reposição de uma unidade ou da matriz. Mostra a falta física na unidade base e converte essa necessidade pelo insumo derivado da última compra confirmada, agrupando o pedido por fornecedor. Não cria pedidos nem altera estoque sem solicitação separada.
---

# Reposição de estoque do Coala

Use dados operacionais atuais e consultas somente de leitura. Preserve a unidade pedida ou a unidade já estabelecida na conversa; se nenhuma estiver definida e isso mudar o resultado, confirme o destino antes de calcular.

## Regra obrigatória

Para cada insumo base que precisa de reposição:

1. Calcule a falta física atual pela fonte oficial do sistema. Mostre esse valor como **Comprar**, na unidade base e com a precisão retornada pelo cálculo, por exemplo `Comprar: 1.034,67 g`.
2. Localize a compra confirmada mais recente e vinculada ao mesmo `baseItemId`. Use dessa compra somente:
   - o `productId` do insumo derivado;
   - o fornecedor;
   - o `purchaseUnitType` e o rótulo da unidade de compra.
3. Nunca use a quantidade da compra anterior como recomendação atual e não a apresente como se ainda precisasse ser comprada.
4. Converta **Comprar** para unidades inteiras do derivado selecionado e arredonde para cima. Mostre o resultado como **Pedir**, por exemplo `Pedir: 26 pacotes de 40 g`.
5. Agrupe a lista final pelo fornecedor da última compra confirmada.

Uma compra histórica identifica o derivado e o fornecedor; ela não reduz a falta física. Uma compra ainda ativa e destinada explicitamente à unidade aparece em aviso separado de **compra a caminho**, também sem reduzir automaticamente a falta física.

## Auditoria de cobertura das compras

Consultar apenas os recebimentos filtrados pela unidade não é suficiente: pedidos legados ou importados podem estar ativos sem `destinationKioskId` e desaparecer desse filtro. Em toda reposição operacional que considere o que já foi comprado, faça também uma consulta limitada dos recebimentos ativos do workspace e reconcilie seus pedidos.

Classifique o resultado sem inferir destino:

- **Compra a caminho**: recebimento ativo com `destinationKioskId` igual à unidade solicitada.
- **Compra ativa sem destino**: recebimento ativo cujo pedido e recebimento não tenham destino explícito. Mostre fornecedor, pedido e itens em bloco separado; não atribua à unidade nem abata da necessidade.
- **Pedido sem recebimento ativo**: pedido confirmado sem recebimento ativo correspondente. Mostre como inconsistência para reconciliação, sem tratá-lo como mercadoria a caminho.
- **Compromisso comercial pendente de confirmação operacional**: pedido ainda em revisão que o usuário informou como comprado, aceito pelo fornecedor ou com cobrança emitida. Mostre separadamente e explique o estado cadastral; não o omita nem o promova silenciosamente a confirmado.

Se a consulta global limitada atingir o limite sem provar cobertura completa, declare a pesquisa parcial. Nunca conclua que não existe compra somente porque a busca por destino veio vazia.

## Conversão

Quando estiver trabalhando no repositório, reutilize as regras canônicas de `src/lib/purchasing-units.ts` e `src/lib/conversion.ts`:

```text
conteúdo em unidade base = convertValue(packageSize, derivado.unit, base.unit, derivado.category)
base por unidade de compra = conteúdo × multiplo_caixa, somente quando purchaseUnitType = logistic
Pedir = ceil(Comprar / base por unidade de compra)
```

Use o tipo de unidade registrado na linha da última compra. Não troque silenciosamente uma compra por conteúdo por uma caixa logística, mesmo que o derivado tenha `multiplo_caixa`.

Considere apenas pedidos confirmados e não cancelados. Ordene pela data da compra e use `confirmedAt` ou `createdAt` apenas como reserva quando a data da compra estiver ausente. O derivado deve existir e possuir conversão válida; se estiver arquivado ou inconsistente, sinalize a limitação antes de recomendar sua reutilização.

## Estoque e roteamento

- Calcule a necessidade da unidade solicitada, sem misturar saldos de destinos diferentes.
- Respeite `supplyMode`: compra direta da unidade não compõe a necessidade do CD; ausência do campo mantém a compatibilidade via CD.
- Desconte reservas físicas uma única vez conforme a regra oficial da reposição.
- Não confunda mínimo, estoque disponível, falta física, compra a caminho e quantidade arredondada para embalagem.
- Não deduza recebimento ou destino para pedidos legados sem vínculo explícito.
- Não omita uma compra ativa por falta de destino; exponha-a no bloco de reconciliação.

## Formato da resposta

Organize por fornecedor e mostre, no mínimo:

| Insumo derivado | Comprar | Pedir |
| --- | ---: | ---: |
| Ovomaltine Rocks 40 g | 1.034,67 g | 26 pacotes |

O campo **Comprar** é sempre a necessidade física atual mostrada pelo cálculo de reposição. O campo **Pedir** é essa mesma necessidade convertida pelo derivado da última compra.

Depois da lista de reposição, apresente quando aplicável os blocos **Compra a caminho**, **Compra ativa sem destino**, **Pedido sem recebimento ativo** e **Compromisso comercial pendente de confirmação operacional**. Esses blocos explicam a cobertura da pesquisa e não alteram **Comprar** ou **Pedir** automaticamente.

Não mostre data nem quantidade da compra anterior, salvo se o usuário pedir esse histórico. Informe a data/hora de atualização dos dados quando a consulta for operacional.

Se não existir última compra confirmada com derivado válido, mantenha o item em **Sem derivado definido pela última compra**, mostre **Comprar** na unidade base e diga que fornecedor e embalagem precisam ser escolhidos; não invente conversão nem fornecedor.

## Limites

- A solicitação de “trazer a reposição” autoriza consulta e cálculo, não pedido de compra, movimentação, recebimento ou escrita em produção.
- Não substitua a fonte oficial por números lembrados de uma resposta anterior quando uma consulta atual estiver disponível.
- Se a consulta estiver parcial, indisponível ou sem conversão válida, declare a limitação em vez de completar os dados por suposição.
