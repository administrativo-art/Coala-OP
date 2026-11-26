# Instrucoes para Populacao de Compras pelo Codex

Este documento define como o Codex deve registrar compras no sistema a partir de prints, comprovantes, paginas de checkout, historicos de pedido, notas ou informacoes fornecidas pelo usuario.

O objetivo e transcrever e organizar a compra para revisao posterior, sem assumir decisoes operacionais, fiscais, financeiras, cadastrais ou de estoque que dependem de validacao humana.

## Fonte obrigatoria de padroes

Antes de solicitar dados ao usuario, consulte [Compras recorrentes](./compras-recorrentes/README.md) e o registro do CNPJ. Esse diretorio versionado guarda os vinculos verificados e as decisoes aprovadas de itens, embalagens, conta, centro e destino. Revalide os cadastros atuais e aplique somente dentro do escopo registrado. Novas decisoes recorrentes devem atualizar essa mesma fonte com origem, data e escopo; nao ficam apenas na conversa ou em arquivos locais paralelos.

Historico consistente permite propor um padrao, mas nao equivale a aprovacao. Campo pendente, item ambiguo, apresentacao diferente ou finalidade nova exige resolver apenas a divergencia. Um padrao aprovado nao autoriza escritas, pagamentos futuros ou ampliacao de acesso.

## Regra principal

Toda compra criada pelo Codex deve entrar no sistema como `Criada`.

Nunca criar compra como `Confirmada`, mesmo que a origem indique pagamento aprovado, pedido confirmado, compra concluida, nota emitida ou entrega prevista.

A confirmacao e uma etapa posterior e separada, por decisao humana. Quando o usuario pedir explicitamente para confirmar a compra identificada, a sessao principal pode executar o fluxo canonico autenticado e verificar seus efeitos. O pedido de popular, a nota autorizada e o padrao recorrente nao concedem essa autorizacao.

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

- Confirmar a compra apenas por um pedido de populacao.
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

Vinculos verificados por fornecedor, codigo e apresentacao no registro de compras recorrentes podem ser reutilizados no escopo aprovado, depois de conferir o cadastro atual. Isso nao e correspondencia aproximada nem autorizacao para criar ou corrigir globalmente produtos e insumos.

Ao popular compras, nao e necessario criar insumo base, insumo derivado, categorias, unidades ou qualquer outro cadastro operacional.

Se o item da origem ainda nao existir no sistema, ele deve ser registrado como item livre da compra, com nome identificavel a partir da origem.

Itens sem vinculo comprovado continuam para revisao do usuario dentro do fluxo do sistema. Nao devolva ao usuario uma identificacao que ja possa ser recuperada de um vinculo verificado e aplicavel do registro.

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

A partir dai, o usuario decide se confirma a compra, vincula itens sem identidade comprovada, cria cadastros, gera recebimento, lanca financeiro ou movimenta estoque.

Um mesmo pedido pode autorizar expressamente populacao e outras etapas identificadas, como criar despesas vinculadas e enviar os boletos fornecidos ao Inter. Preserve essa autorizacao durante a operacao, sem pedir a mesma decisao de novo por parcela ou retomada. Execute cada etapa pelo fluxo canonico, com pre-voo e verificacao posterior; nunca marque agendamento como pagamento. A aprovacao bancaria final continua com o usuario, conforme AGENTS.md.
