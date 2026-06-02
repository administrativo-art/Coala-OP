# Instrucoes para Populacao de Compras pelo Codex

Este documento define como o Codex deve registrar compras no sistema a partir de prints, comprovantes, paginas de checkout, historicos de pedido, notas ou informacoes fornecidas pelo usuario.

O objetivo e transcrever e organizar a compra para revisao posterior, sem assumir decisoes operacionais, fiscais, financeiras, cadastrais ou de estoque que dependem de validacao humana.

## Regra principal

Toda compra criada pelo Codex deve entrar no sistema como `Criada`.

Nunca criar compra como `Confirmada`, mesmo que a origem indique pagamento aprovado, pedido confirmado, compra concluida, nota emitida ou entrega prevista.

A confirmacao da compra deve ser feita manualmente pelo usuario dentro do sistema.

## O que o Codex pode fazer

O Codex pode criar o pedido de compra com as informacoes disponiveis, incluindo:

- Fornecedor identificado na origem ou informado pelo usuario.
- Nome dos itens conforme aparecem na origem.
- Quantidade comprada.
- Valor unitario, subtotal, frete, desconto e total, quando disponiveis.
- Numero do pedido externo.
- Data da compra ou data exibida no comprovante.
- Forma de pagamento exibida.
- Status visto na origem, registrado apenas em observacoes.
- Prazo ou previsao de entrega, quando existir.
- Observacoes relevantes para conferencia posterior.

## O que o Codex nao deve fazer

O Codex nao deve:

- Confirmar a compra.
- Criar recebimento automaticamente.
- Criar financeiro confirmado ou pago.
- Movimentar estoque.
- Criar lote.
- Atualizar custo efetivo.
- Atualizar preco medio ou ultimo preco confirmado.
- Criar insumo base.
- Criar insumo derivado.
- Criar categoria operacional.
- Criar categoria de unidade.
- Criar fornecedor novo sem confirmacao, quando houver duvida.
- Vincular item a cadastro aproximado quando houver incerteza.

## Cadastro e normalizacao de itens

Ao popular compras, nao e necessario criar insumo base, insumo derivado, categorias, unidades ou qualquer outro cadastro operacional.

Se o item da origem ainda nao existir no sistema, ele deve ser registrado como item livre da compra, com nome identificavel a partir da origem.

O usuario sera responsavel por normalizar, vincular, cadastrar ou corrigir itens depois, dentro do fluxo do sistema.

Quando houver duvida sobre fornecedor, item, unidade, quantidade ou vinculo com cadastro existente, o Codex deve preferir registrar a informacao em observacoes ou perguntar ao usuario antes de assumir.

Nao usar correspondencia aproximada quando isso puder gerar vinculo incorreto.

## Observacoes obrigatorias

Toda compra populada pelo Codex deve registrar em notas:

- Origem da informacao, por exemplo: print, checkout, comprovante ou historico de pedido.
- Numero do pedido externo, se existir.
- Data exibida na origem.
- Forma de pagamento exibida.
- Status visto na origem.
- Qualquer informacao incompleta ou incerta.
- Aviso de que a compra foi lancada pelo Codex e precisa de revisao manual.

Exemplo:

```text
Compra lancada pelo Codex a partir de print. Pedido externo: 123456. Data vista no print: 01/06/2026. Forma de pagamento: Pix. Status visto no print: pagamento aprovado. Compra mantida como Criada para revisao e confirmacao manual. Itens nao normalizados devem ser revisados pelo usuario.
```

## Interpretacao pratica

O Codex apenas transcreve e organiza a compra no sistema.

A compra criada e um rascunho operacional em status `Criada`, aguardando revisao humana.

A partir dai, o usuario decide se confirma a compra, vincula itens, cria cadastros, gera recebimento, lanca financeiro ou movimenta estoque.
