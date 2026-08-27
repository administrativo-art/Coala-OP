# Plano completo do modulo de fechamento de caixa e depositos em dinheiro

## 1. Visao geral

Este documento descreve o plano completo para construir, dentro do Coala, um modulo de fechamento de caixa diario com auditoria operacional, conciliacao por canal de recebimento, formacao de blocos de dinheiro fisico para deposito e emissao manual de cobrancas bancarias, inicialmente via API de Cobranca do Banco Inter. O objetivo e transformar os dados brutos do PDV Legal em uma rotina controlada, rastreavel e simples de operar no dia a dia, sem depender de planilhas paralelas, mensagens avulsas ou conferencias manuais sem historico.

O ponto de partida e uma premissa ja validada: o PDV Legal entrega cupons, itens, formas de pagamento e operadores, mas nao entrega um fechamento consolidado pronto por dia, unidade, operadora e canal no formato que o Coala precisa. Portanto, o Coala deve assumir a responsabilidade de construir o valor esperado a partir da API do PDV, apresentar esse valor para conferencia, receber o valor fisico informado pelo usuario e calcular divergencias. O sistema nao deve tentar substituir o PDV como origem da venda. Ele deve usar o PDV como fonte do esperado e se tornar a camada de auditoria, controle, aprovacao e rastreabilidade financeira.

O modulo tambem deve resolver uma segunda necessidade operacional: o dinheiro fisico contado no fechamento precisa ser agrupado em blocos de ate R$ 5.000,00 para emissao de boleto ou cobranca bancaria de entrada. Esses blocos nao consideram PIX, cartao de debito, cartao de credito ou qualquer outro canal nao fisico. Eles consideram somente o dinheiro liquido fisicamente contabilizado. A emissao do boleto nunca deve ser automatica. O sistema apenas organiza os blocos, mostra quando estao proximos do limite ou travados por regra de sequencia e permite que o usuario autorizado clique em "Emitir boleto" quando decidir.

O modulo completo pode ser entendido como tres camadas conectadas:

1. Fechamento de caixa: sincroniza PDV, calcula valores esperados, coleta valores fisicos e aponta diferencas.
2. Blocos de deposito: agrupa somente o dinheiro fisico contado e aprovado em blocos de ate R$ 5.000,00.
3. Integracao bancaria: emite manualmente uma cobranca/boleto para um bloco, salva os identificadores bancarios e acompanha liquidacao por consulta e webhook.

Essas camadas devem ser desacopladas. Um fechamento aprovado gera valor elegivel para deposito, mas um boleto emitido nao deve reescrever o fechamento. Se um fechamento aprovado precisar ser reaberto depois de ja ter entrado em um bloco ou boleto, o sistema deve criar ajustes, e nao alterar historico consolidado sem rastreabilidade.

## 2. Objetivos do produto

O primeiro objetivo e dar ao financeiro uma visao diaria confiavel sobre o caixa de cada unidade. A equipe precisa saber se todos os fechamentos foram feitos, se existem dias pendentes, se algum canal tem divergencia, qual operadora esta relacionada a uma diferenca e quanto deveria ter sido recebido segundo o PDV.

O segundo objetivo e reduzir erro manual. Hoje, quando o fechamento depende de calculo manual, o operador precisa somar dinheiro, descontar troco, separar PIX, cartoes e eventualmente conferir operadores. O sistema deve trazer o valor esperado ja calculado, especialmente no dinheiro liquido, onde o PDV envia a linha de "TROCO" como valor positivo, mas a logica financeira exige subtracao do dinheiro recebido.

O terceiro objetivo e padronizar o processo de aprovacao. Um fechamento nao deve simplesmente existir como numero. Ele precisa passar por estados claros: sincronizado, em preenchimento, enviado para revisao, aprovado, reaberto ou com erro de sincronizacao. Cada alteracao relevante deve ter autor, data, antes, depois e justificativa quando necessario.

O quarto objetivo e organizar o dinheiro fisico para deposito. A regra operacional exige blocos de ate R$ 5.000,00. O sistema deve alocar dias aprovados em blocos cronologicos por unidade, impedir que um bloco ultrapasse o limite, permitir blocos menores quando o usuario quiser emitir e mostrar uma ressalva clara quando o bloco ainda comportar mais dinheiro.

O quinto objetivo e conectar o bloco ao boleto ou cobranca bancaria. Ao emitir, o sistema deve guardar numero interno, identificador da operacao no banco, codigo de barras, linha digitavel, PDF ou link para PDF, status, vencimento, pagador e eventos de pagamento. Isso permite rastrear a cadeia completa: fechamento diario, valor em dinheiro contado, bloco de deposito, cobranca emitida, liquidacao bancaria e registro financeiro.

## 3. Principios de desenho

O modulo deve seguir alguns principios para evitar problemas futuros.

O primeiro principio e imutabilidade operacional. Quando um fechamento e aprovado, ele representa uma declaracao operacional feita naquele momento. Se houver erro posterior, o correto e reabrir com justificativa ou criar ajuste, nao simplesmente apagar o passado. O mesmo vale para blocos e boletos emitidos. Depois que um bloco gerou boleto, a relacao entre boleto e itens do bloco deve ser preservada.

O segundo principio e separacao de responsabilidades. A API do PDV traz vendas e pagamentos. O Coala calcula o fechamento. A rotina de deposito agrupa dinheiro fisico. A API bancaria cria cobrancas. Misturar essas responsabilidades em uma mesma estrutura dificulta auditoria e aumenta risco. Por isso, `cashClosures`, `cashDepositBatches` e `interCobrancas` devem ser entidades separadas.

O terceiro principio e rastreabilidade de ponta a ponta. O financeiro deve conseguir clicar em um boleto pago e ver quais dias, unidades, operadoras e valores de dinheiro fisico compuseram aquele boleto. Tambem deve conseguir partir de um fechamento diario e ver se o dinheiro daquele dia entrou em algum bloco, se o boleto foi emitido, se foi pago ou se ainda esta pendente.

O quarto principio e tolerancia operacional. A vida real tem divergencias, reaberturas, falhas de sync, horarios diferentes e dias sem movimento. O sistema deve permitir operar nesses casos sem quebrar a integridade. Divergencia nao deve impedir envio do fechamento, mas deve exigir observacao. Fechamento com dinheiro fisico zerado nao deve gerar item de deposito. Falha no PDV deve gerar status de erro e permitir ressincronizacao.

O quinto principio e controle manual sobre emissao bancaria. Nenhum boleto deve ser emitido automaticamente. O sistema pode indicar que um bloco esta pronto, cheio ou travado, mas a emissao depende de acao explicita do usuario autorizado.

## 4. Escopo funcional do fechamento

O fechamento diario deve existir por unidade e por data. Cada fechamento representa o dia operacional de uma unidade, com base na data de recebimento ou movimento dos cupons do PDV. O sistema deve puxar os dados do PDV Legal, agrupar valores por operadora e canal, e criar linhas de conferencia.

O usuario deve ver, para cada linha, o valor esperado do PDV, o campo para informar o valor fisico contabilizado e o resultado calculado. O resultado deve indicar "OK" quando a diferenca for zero dentro da tolerancia de centavos, "Falta" quando o contado for menor que o esperado e "Sobra" quando o contado for maior que o esperado.

Os canais iniciais sao:

- Dinheiro liquido.
- PIX.
- Cartao de debito.
- Cartao de credito.
- Outros, quando houver forma nao mapeada.

O canal de dinheiro liquido e especial. Ele deve ser calculado como dinheiro recebido menos troco. O PDV pode retornar linhas como `DINHEIRO` e `TROCO` dentro de `formaPgtos`. O `TROCO` nao deve aparecer como canal separado na tela principal, porque ele nao e receita e nao e valor a depositar. Ele deve aparecer somente como composicao do dinheiro:

`Dinheiro liquido = DINHEIRO - TROCO`

Exemplo:

- Dinheiro recebido: R$ 401,00.
- Troco devolvido: R$ 33,00.
- Dinheiro liquido esperado: R$ 368,00.

Na tela, o usuario ve "Dinheiro liquido: R$ 368,00". Ao expandir ou passar o mouse, ele ve "Composicao: R$ 401,00 recebido - R$ 33,00 troco".

O fechamento deve ser agrupado por operadora ou caixa. A origem preferencial para a operadora do pagamento e `usuariorecebimento_id` do cupom, porque e o usuario que recebeu o valor. Para itens vendidos, pode existir `usuariooperador_id`, que e util para metas ou venda por produto, mas para conferencia de caixa a visao principal deve ser pelo usuario de recebimento. O sistema pode guardar ambos, mas o agrupamento financeiro de canais deve seguir o recebedor.

## 5. Fonte de dados do PDV Legal

O endpoint principal para construir o fechamento e:

`GET /cupom/get/{dataInicial}/{dataFinal}/{filiais}`

Exemplo:

`GET /cupom/get/2026-07-07/2026-07-07/17343`

Esse endpoint retorna cupons com campos de cabecalho, itens e formas de pagamento. O Coala deve consumir esse endpoint no backend, nunca diretamente no frontend, porque as credenciais do PDV Legal devem permanecer em ambiente seguro.

Campos relevantes do cupom:

- `codcupom`: identificador do cupom.
- `venda_id` e `venda_id_pdv`: identificadores de venda.
- `loja_id`: filial.
- `terminal_id`: terminal.
- `dtabertura`, `dtmovimento`, `dtrecebimento`: datas de operacao.
- `usuariorecebimento_id`: usuario que recebeu o pagamento.
- `tipovenda`: tipo de venda.
- `pontoVenda`: ponto de venda.
- `nomeParceiro`, `codPedidoParceiro`: sinais de parceiro ou pedido externo.
- `valortotal`: total do cupom.
- `valorentrega`: valor de entrega.
- `valoracrescimo`: acrescimos.
- `valordesconto`: descontos.
- `iscancelado`: cupom cancelado.
- `isestornado`: cupom estornado.
- `itens`: itens do cupom.
- `formaPgtos`: formas de pagamento.

Campos relevantes de `formaPgtos`:

- `nome`: nome da forma, como `DINHEIRO`, `PIX STONE`, `CARTAO DEBITO`, `CARTAO CREDITO`, `TROCO`.
- `valortotal`: valor da forma.
- `codformarecebimentopdv`: codigo da forma.
- `codClassificacao`: classificacao do PDV.
- `nomeExterno`: nome externo, quando existir.
- `detalhes`: detalhes de cartao, bandeira ou subadquirente quando enviados.

Campos relevantes de `itens`:

- `usuariooperador_id`: operador relacionado ao item.
- `valortotal`: valor do item.
- `quantidade`: quantidade.
- `iscancelado`: item cancelado.
- `codigoVenda`, `codproduto`, `codProdutoExterno`: codigos de produto.

Para enriquecer nomes de usuarios, usar:

`GET /usuariopdv/get`

Para enriquecer nomes de formas, usar:

`GET /formapagamentopdv/get`

O sistema tambem pode consultar sangrias e suprimentos para diagnostico ou modulo futuro, mas eles nao entram automaticamente no valor esperado por canal de venda. Sangrias e suprimentos sao movimentacoes de caixa, nao vendas. A primeira versao pode exibir esses valores em um painel lateral, sem mistura-los com o total esperado do PDV.

## 6. Regras de calculo do valor esperado

O valor esperado do fechamento deve ser calculado a partir de cupons validos. A regra de cancelamento deve seguir a logica ja adotada na sincronizacao atual do projeto:

- Se o cupom esta cancelado e nenhum item esta explicitamente cancelado, ignorar o cupom inteiro.
- Se um item esta cancelado, ignorar o item.
- Se a forma de pagamento esta em cupom ignorado, ignorar a forma.

Estornos precisam de regra explicita. Para o MVP, a recomendacao e registrar a quantidade de cupons estornados no diagnostico e validar o comportamento real do PDV antes de misturar estorno como ajuste automatico. Se o cupom estornado vier com valor positivo, incluir sem tratamento pode inflar o esperado. Se vier negativo, pode reduzir corretamente. Como esse comportamento pode variar, o sistema deve guardar `estornadoCouponCount` e permitir relatorio de auditoria.

O fechamento por canal deve partir de `formaPgtos`, nao da soma de itens, porque a pergunta do caixa e "quanto entrou por forma de recebimento?". A soma dos itens e util para validar o total geral e diagnosticar divergencia entre venda e pagamento. Mas a distribuicao por dinheiro, PIX, debito e credito vem de `formaPgtos`.

Regra de dinheiro:

- Somar todas as linhas mapeadas como `cash` positivas.
- Somar todas as linhas mapeadas como troco.
- Subtrair troco do dinheiro.
- Guardar `grossCashAmount` e `changeAmount` na metadata.

Regra de cartoes e PIX:

- Somar valores por canal normalizado.
- Quando houver `detalhes`, guardar informacoes de bandeira e subadquirente para relatorios futuros.

Regra de formas desconhecidas:

- Mapear para `other`.
- Exibir em diagnostico de formas nao mapeadas.
- Permitir configurar o mapeamento depois.

O total esperado do fechamento deve ser:

`expectedTotal = soma(expectedAmount de todas as linhas por operadora e canal)`

Esse total deve bater com o total liquido dos pagamentos, considerando troco como negativo. Tambem deve bater com `cupom.valortotal` quando o PDV estiver consistente. Se nao bater, o sistema deve registrar alerta de integridade, mas nao necessariamente bloquear.

## 7. Normalizacao de canais

A normalizacao de canais deve ser centralizada em uma funcao ou servico. Nao se deve espalhar `if nome === "DINHEIRO"` em telas, rotas e jobs. O ideal e criar um modulo como:

`src/features/financial/cash-closures/channel-normalization.ts`

Tipos:

```ts
type CashClosureChannel =
  | "cash"
  | "pix"
  | "debit_card"
  | "credit_card"
  | "voucher"
  | "signed_account"
  | "other";

type ChannelNormalizationResult = {
  channel: CashClosureChannel;
  label: string;
  sign: 1 | -1;
  isCashChange: boolean;
  rawName: string;
};
```

Mapeamento inicial:

- `DINHEIRO`: `cash`, sinal positivo.
- `TROCO`: `cash`, sinal negativo, `isCashChange = true`.
- `PIX STONE`: `pix`, sinal positivo.
- `PIX`: `pix`, sinal positivo.
- `CARTAO DEBITO`: `debit_card`, sinal positivo.
- `CARTÃO DÉBITO`: `debit_card`, sinal positivo.
- `CARTAO CREDITO`: `credit_card`, sinal positivo.
- `CARTÃO CRÉDITO`: `credit_card`, sinal positivo.

Como o PDV pode mudar nomes, o mapeamento deve ser migravel para configuracao no futuro:

`cashClosureChannelMappings`

Campos:

- `workspaceId`.
- `provider`.
- `rawName`.
- `channel`.
- `sign`.
- `active`.
- `createdAt`.
- `updatedAt`.

No MVP, pode ficar hardcoded com diagnostico de desconhecidos. Mas o modelo deve prever configuracao futura.

## 8. Modelo de dados do fechamento

Colecao principal:

`cashClosures`

ID sugerido:

`{kioskId}_{yyyy-mm-dd}`

Exemplo:

`tirirical_2026-07-07`

Tipo:

```ts
type CashClosureStatus =
  | "not_synced"
  | "draft"
  | "pending_review"
  | "approved"
  | "reopened"
  | "sync_error";

type CashClosure = {
  id: string;
  workspaceId: string;
  date: string;
  year: number;
  month: number;
  day: number;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  status: CashClosureStatus;
  expectedTotal: number;
  countedTotal: number;
  differenceTotal: number;
  expectedCashAmount: number;
  countedCashAmount: number;
  cashDepositEligibleAmount: number;
  expectedByChannel: Record<string, number>;
  countedByChannel: Record<string, number>;
  differenceByChannel: Record<string, number>;
  operatorCount: number;
  pendingLineCount: number;
  divergentLineCount: number;
  matchedLineCount: number;
  source: CashClosureSource;
  cashDeposit: CashClosureDepositState;
  syncedAt: string | null;
  syncError: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenedReason: string | null;
  createdAt: string;
  updatedAt: string;
};
```

Fonte:

```ts
type CashClosureSource = {
  provider: "pdvlegal";
  endpoint: "cupom/get";
  couponCount: number;
  validCouponCount: number;
  ignoredCancelledCouponCount: number;
  estornadoCouponCount: number;
  itemCount: number;
  paymentRowCount: number;
  rawPaymentNames: string[];
  unknownPaymentNames: string[];
  integrityWarnings: string[];
};
```

Estado de deposito:

```ts
type CashClosureDepositState = {
  eligibleAmount: number;
  batchId: string | null;
  batchItemId: string | null;
  status:
    | "not_eligible"
    | "not_allocated"
    | "allocated"
    | "issued"
    | "paid"
    | "adjusted";
};
```

Subcolecao de linhas:

`cashClosures/{closureId}/lines`

Tipo:

```ts
type CashClosureLineStatus =
  | "pending"
  | "matched"
  | "divergent"
  | "ignored";

type CashClosureLine = {
  id: string;
  closureId: string;
  workspaceId: string;
  date: string;
  kioskId: string;
  operatorId: string;
  operatorName: string;
  channel: CashClosureChannel;
  channelLabel: string;
  expectedAmount: number;
  countedAmount: number | null;
  differenceAmount: number | null;
  status: CashClosureLineStatus;
  rawPaymentNames: string[];
  metadata: {
    grossCashAmount?: number;
    changeAmount?: number;
    couponCount?: number;
    paymentRowCount?: number;
    terminalIds?: string[];
    bandeiras?: Record<string, number>;
    subadquirentes?: Record<string, number>;
  };
  note: string | null;
  countedBy: string | null;
  countedAt: string | null;
  updatedAt: string;
};
```

O valor de dinheiro para deposito deve ser derivado das linhas `channel = cash` e `countedAmount`, apos aprovacao. Nao deve vir de `expectedAmount`.

## 9. Estados e transicoes do fechamento

Estados:

- `not_synced`: o sistema ainda nao buscou dados do PDV para a unidade/data.
- `sync_error`: houve tentativa de sincronizacao, mas a API falhou ou retornou estrutura inesperada.
- `draft`: o PDV foi sincronizado e o fechamento esta aberto para preenchimento.
- `pending_review`: usuario finalizou e enviou para revisao.
- `approved`: fechamento aprovado pelo financeiro ou usuario autorizado.
- `reopened`: fechamento reaberto apos envio ou aprovacao.

Transicoes permitidas:

- `not_synced` -> `draft`: sync concluida com sucesso.
- `not_synced` -> `sync_error`: sync falhou.
- `sync_error` -> `draft`: ressincronizacao bem-sucedida.
- `draft` -> `pending_review`: usuario finaliza preenchimento.
- `pending_review` -> `approved`: financeiro aprova.
- `pending_review` -> `reopened`: revisor devolve para ajuste.
- `approved` -> `reopened`: admin reabre com justificativa.
- `reopened` -> `pending_review`: usuario reenviou.
- `reopened` -> `approved`: se revisor aprovar novamente.

Regras:

- `draft` permite editar valores fisicos.
- `pending_review` deve bloquear edicao comum, exceto perfis autorizados.
- `approved` nao permite edicao direta.
- Reabrir `approved` exige justificativa.
- Se `approved` ja foi alocado em bloco, qualquer alteracao de dinheiro fisico deve gerar ajuste, nao reescrever silenciosamente o bloco.

## 10. Interface de navegacao

O usuario acessa o modulo por quatro niveis:

1. Cards de unidades.
2. Cards de meses e anos por unidade.
3. Calendario de dias no mes.
4. Tela de fechamento do dia.

Essa navegacao faz sentido porque o trabalho operacional costuma comecar pela pergunta "qual unidade esta pendente?", depois "qual mes/dia?", e finalmente "o que preciso preencher?". A interface deve ser densa, objetiva e voltada para operacao, sem aparencia de landing page. Os cards devem ser compactos, com status, numeros e acoes claras.

## 11. Pagina inicial com cards de unidades

Rota:

`/dashboard/financeiro/fechamento-caixa`

Essa tela lista unidades com fechamento habilitado. Cada card deve mostrar:

- Nome da unidade.
- Filial PDV.
- Mes corrente.
- Dias pendentes.
- Dias com divergencia.
- Dias aprovados.
- Dias com erro de sincronizacao.
- Ultima sincronizacao.
- Ultimo fechamento aprovado.
- Status visual geral.

Exemplo:

```txt
Tirirical
Filial PDV 17343
Julho/2026

Pendentes: 3
Divergentes: 1
Aprovados: 4
Erro de sync: 0

Ultima sync: hoje 06:02
Ultimo aprovado: 06/07/2026
```

Estados visuais:

- Verde: sem pendencias ate ontem.
- Amarelo: ha dias pendentes.
- Vermelho: ha divergencias ou erros.
- Cinza: unidade sem PDV configurado ou sem dados.

Acoes:

- Clicar no card abre pagina da unidade.
- Botao "Sincronizar ontem", visivel para perfil autorizado.
- Botao "Ver depositos", opcional, levando aos blocos de deposito da unidade.

Essa tela deve usar resumos precomputados para evitar varrer muitos fechamentos no carregamento.

Colecao auxiliar:

`cashClosureUnitSummaries`

Tipo:

```ts
type CashClosureUnitSummary = {
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string | null;
  currentMonth: string;
  pendingDays: number;
  divergentDays: number;
  approvedDays: number;
  notSyncedDays: number;
  syncErrorDays: number;
  lastSyncedAt: string | null;
  lastApprovedDate: string | null;
  openDepositBatchId: string | null;
  openDepositBatchAmount: number;
  updatedAt: string;
};
```

## 12. Pagina da unidade com meses

Rota:

`/dashboard/financeiro/fechamento-caixa/{kioskId}`

Essa tela mostra os meses de fechamento da unidade, agrupados por ano. Cada card mensal resume a situacao do periodo.

Exemplo:

```txt
Julho 2026
Dias auditados: 6/8
Pendentes: 2
Divergentes: 1
Nao sincronizados: 0
PDV: R$ 18.420,50
Fisico: R$ 18.415,50
Diferenca: -R$ 5,00
```

O card do mes deve indicar:

- Total esperado pelo PDV.
- Total fisico contado.
- Diferenca acumulada.
- Quantidade de dias aprovados.
- Quantidade de dias pendentes.
- Quantidade de dias divergentes.
- Quantidade de dias sem sincronizacao.
- Quantidade de dias com erro.
- Valor de dinheiro fisico ja alocado em blocos.
- Valor de dinheiro fisico ainda nao alocado, se existir.

Filtros:

- Ano.
- Status.
- Meses com pendencias.
- Meses com divergencia.
- Meses com depositos pendentes.

Ao clicar no mes, abre o calendario.

Colecao auxiliar:

`cashClosureMonthlySummaries`

Tipo:

```ts
type CashClosureMonthlySummary = {
  workspaceId: string;
  kioskId: string;
  year: number;
  month: number;
  expectedTotal: number;
  countedTotal: number;
  differenceTotal: number;
  expectedCashTotal: number;
  countedCashTotal: number;
  depositAllocatedTotal: number;
  depositIssuedTotal: number;
  pendingDays: number;
  divergentDays: number;
  approvedDays: number;
  notSyncedDays: number;
  syncErrorDays: number;
  channelTotals: Record<string, {
    expected: number;
    counted: number;
    difference: number;
  }>;
  updatedAt: string;
};
```

## 13. Calendario mensal

Rota:

`/dashboard/financeiro/fechamento-caixa/{kioskId}/{year}/{month}`

Essa tela mostra um calendario mensal. Cada dia deve ser um card clicavel com dados suficientes para priorizacao.

Exemplos:

Dia pendente:

```txt
07 Ter
PDV: R$ 2.062,50
Fisico: -
Pendentes: 8 linhas
Status: Pendente
```

Dia divergente:

```txt
06 Seg
PDV: R$ 1.890,00
Fisico: R$ 1.880,00
Falta: R$ 10,00
Status: Divergente
```

Dia aprovado:

```txt
05 Dom
PDV: R$ 2.300,00
Fisico: R$ 2.300,00
Status: Aprovado
```

Dia com deposito:

```txt
04 Sab
Dinheiro: R$ 1.000,00
Bloco: #3
Boleto: Emitido
```

Estados visuais:

- Verde: aprovado sem diferenca.
- Vermelho: divergente.
- Amarelo: pendente de preenchimento ou revisao.
- Azul/neutro: sincronizado mas nao auditado.
- Cinza: sem movimento ou nao sincronizado.
- Cinza claro: futuro.

Resumo no topo:

```txt
Julho 2026 - Tirirical
Aprovados: 5
Pendentes: 2
Divergentes: 1
Sem movimento: 0
Total PDV: R$ 18.420,50
Total fisico: R$ 18.415,50
Diferenca: -R$ 5,00
Dinheiro alocado para deposito: R$ 7.200,00
```

Acoes:

- Clicar no dia abre fechamento.
- Sincronizar mes.
- Exportar mes.
- Ver blocos de deposito do mes.

## 14. Tela de fechamento do dia

Rota:

`/dashboard/financeiro/fechamento-caixa/{kioskId}/{year}/{month}/{day}`

Essa tela e a principal ferramenta operacional.

Cabecalho:

```txt
Fechamento de Caixa
Tirirical - 07/07/2026
Status: Pendente
PDV: R$ 2.062,50
Fisico: R$ 0,00
Diferenca: -R$ 2.062,50
Ultima sincronizacao: 08/07/2026 06:02
Cupons: 171
Itens: 248
Operadoras: 2
```

Agrupamento por operadora:

```txt
Maria Edna2
Total PDV: R$ 960,50
Total fisico: R$ 0,00
Diferenca: -R$ 960,50

Canal              Valor PDV       Valor fisico       Resultado      Observacao
Dinheiro liquido   R$ 368,00       [ input ]          Falta R$ 368   [ input ]
PIX Stone          R$ 315,00       [ input ]          Falta R$ 315   [ input ]
Debito             R$ 195,00       [ input ]          Falta R$ 195   [ input ]
Credito            R$ 82,50        [ input ]          Falta R$ 82,50 [ input ]
```

Resultado:

`difference = countedAmount - expectedAmount`

Se `abs(difference) < 0.01`, status `matched`.

Se negativo, mostrar "Falta".

Se positivo, mostrar "Sobra".

Observacao obrigatoria quando divergente.

A tela deve ter tambem um resumo consolidado por canal:

```txt
Resumo por canal
Dinheiro liquido: PDV R$ 703,00 | Fisico R$ 703,00 | OK
PIX: PDV R$ 785,00 | Fisico R$ 785,00 | OK
Debito: PDV R$ 486,00 | Fisico R$ 486,00 | OK
Credito: PDV R$ 88,50 | Fisico R$ 88,50 | OK
```

Para dinheiro, exibir composicao:

```txt
Dinheiro liquido
R$ 401,00 recebido - R$ 33,00 troco = R$ 368,00
```

Botoes:

- Salvar rascunho.
- Finalizar fechamento.
- Aprovar.
- Reabrir.
- Ressincronizar PDV.
- Ver auditoria.

## 15. Validacoes de preenchimento

O sistema deve validar:

- Todos os campos de valor fisico precisam ser preenchidos antes de finalizar.
- Valor fisico nao pode ser negativo.
- Divergencia exige observacao.
- Divergencia acima de limite exige permissao ou destaque.
- Fechamento aprovado nao pode ser editado sem reabertura.
- Reabertura exige motivo.
- Ressincronizacao nao deve apagar valores fisicos ja digitados.

Ao ressincronizar, a regra e:

- Atualizar `expectedAmount`.
- Manter `countedAmount`.
- Recalcular `differenceAmount`.
- Registrar log.
- Se o status for `approved`, nao atualizar automaticamente sem gerar alerta de mudanca no PDV.

## 16. Auditoria do fechamento

Colecao:

`cashClosureAuditLogs`

Tipo:

```ts
type CashClosureAuditLog = {
  id: string;
  workspaceId: string;
  closureId: string;
  lineId?: string;
  action:
    | "created_from_pdv"
    | "pdv_resynced"
    | "counted_amount_updated"
    | "note_updated"
    | "submitted"
    | "approved"
    | "reopened"
    | "deposit_allocated"
    | "deposit_adjustment_created";
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  userId: string;
  userName: string;
  createdAt: string;
};
```

Eventos obrigatorios:

- Criacao via PDV.
- Ressincronizacao.
- Alteracao de valor contado.
- Alteracao de observacao.
- Finalizacao.
- Aprovacao.
- Reabertura.
- Alocacao em bloco.
- Ajuste de deposito.

Auditoria e essencial porque fechamento de caixa e dado financeiro sensivel. O sistema precisa responder quem alterou, quando alterou, o que mudou e por que mudou.

## 17. Permissoes

Perfis sugeridos:

- Operacao: preenche fechamento da propria unidade.
- Gerente de unidade: preenche e envia para revisao.
- Financeiro: revisa, aprova e gerencia depositos.
- Admin: reabre aprovados, ressincroniza, altera configuracoes e cancela blocos.

Regras:

- Usuario comum so ve unidades vinculadas.
- Financeiro ve todas as unidades.
- Apenas financeiro/admin aprova.
- Apenas admin ou financeiro senior reabre aprovado.
- Apenas usuarios autorizados emitem boleto.
- Webhook bancario nao depende de usuario, mas registra origem `system`.

## 18. Blocos de deposito em dinheiro

A camada de deposito tem uma regra central: apenas dinheiro fisico contado entra nos blocos. O valor usado e o `countedAmount` das linhas de canal `cash`, apos aprovacao do fechamento.

PIX, debito, credito, voucher e outros canais nao entram em bloco de deposito. Eles podem aparecer no fechamento e em relatorios, mas nao geram boleto de entrada por dinheiro fisico.

Cada unidade tem uma fila cronologica de dinheiro fisico aprovado. O sistema tenta encaixar cada dia no bloco aberto da unidade. Se couber sem ultrapassar R$ 5.000,00, adiciona. Se nao couber, trava o bloco atual e cria novo bloco com aquele dia.

Exemplo:

```txt
01/06 - R$ 300,00
02/06 - R$ 3.000,00
03/06 - R$ 700,00
04/06 - R$ 1.000,00
```

Total ate 04/06: R$ 5.000,00. O sistema adiciona todos ao mesmo bloco.

Outro exemplo:

```txt
01/06 - R$ 300,00
02/06 - R$ 3.000,00
03/06 - R$ 700,00
04/06 - R$ 1.200,00
```

Ate 03/06: R$ 4.000,00. Incluir 04/06 geraria R$ 5.200,00. O sistema trava o primeiro bloco com R$ 4.000,00 e cria novo bloco com 04/06.

Importante: travar o bloco nao emite boleto. Apenas impede novas alocacoes automaticas naquele bloco.

## 19. Status dos blocos de deposito

Status sugeridos:

```ts
type CashDepositBatchStatus =
  | "open"
  | "locked"
  | "issuing"
  | "issued"
  | "paid"
  | "cancelled"
  | "failed";
```

Significado:

- `open`: pode receber novos dias.
- `locked`: nao recebe novos dias, mas ainda nao teve boleto emitido.
- `issuing`: chamada ao banco em andamento.
- `issued`: cobranca emitida.
- `paid`: cobranca paga/compensada.
- `cancelled`: bloco ou cobranca cancelada.
- `failed`: falha na emissao ou consulta bancaria.

Nao usar `full` como estado principal. Um bloco pode estar travado com R$ 4.000,00 porque o proximo dia nao coube. Ele nao esta cheio, esta travado por sequencia. A condicao "cheio" pode ser calculada visualmente quando `totalAmount === maxAmount`.

## 20. Modelo de dados dos blocos

Colecao:

`cashDepositBatches`

Tipo:

```ts
type CashDepositBatch = {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  status: CashDepositBatchStatus;
  maxAmount: number;
  totalAmount: number;
  remainingCapacity: number;
  periodStartDate: string;
  periodEndDate: string;
  closureIds: string[];
  dates: string[];
  itemCount: number;
  lockReason:
    | "limit_reached"
    | "next_item_would_exceed_limit"
    | "manual_issue_requested"
    | "manual_lock"
    | null;
  nextRejectedClosureId: string | null;
  nextRejectedAmount: number | null;
  bankProvider: "inter" | null;
  interCobrancaId: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  issuedBy: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
};
```

Subcolecao:

`cashDepositBatches/{batchId}/items`

Tipo:

```ts
type CashDepositBatchItem = {
  id: string;
  workspaceId: string;
  batchId: string;
  closureId: string;
  closureDate: string;
  kioskId: string;
  amount: number;
  source: "cash_counted" | "cash_adjustment";
  operatorBreakdown: {
    operatorId: string;
    operatorName: string;
    amount: number;
  }[];
  createdAt: string;
};
```

O `operatorBreakdown` ajuda a explicar o dinheiro fisico de um dia dentro do bloco.

## 21. Regra de alocacao em blocos

Quando um fechamento e aprovado:

1. Calcular `eligibleAmount` como soma de `countedAmount` das linhas `cash`.
2. Se `eligibleAmount <= 0`, marcar `not_eligible`.
3. Buscar bloco `open` da unidade.
4. Se nao existir, criar bloco `open`.
5. Se `bloco.totalAmount + eligibleAmount <= 5000`, adicionar o fechamento ao bloco.
6. Se `bloco.totalAmount + eligibleAmount > 5000`, travar bloco atual com motivo `next_item_would_exceed_limit` e criar novo bloco com o fechamento.
7. Atualizar `cashDeposit` no fechamento.
8. Registrar auditoria.

Pseudo-codigo:

```ts
async function allocateClosureCashToDepositBatch(closure) {
  const amount = closure.countedCashAmount;
  if (amount <= 0) return markNotEligible(closure);

  let batch = await findOpenBatch(closure.kioskId);
  if (!batch) batch = await createOpenBatch(closure.kioskId);

  if (batch.totalAmount + amount <= batch.maxAmount) {
    await addClosureToBatch(batch, closure, amount);
    return;
  }

  await lockBatch(batch, {
    reason: "next_item_would_exceed_limit",
    nextRejectedClosureId: closure.id,
    nextRejectedAmount: amount,
  });

  const newBatch = await createOpenBatch(closure.kioskId);
  await addClosureToBatch(newBatch, closure, amount);
}
```

Essa regra nao emite boleto. Ela apenas organiza a fila.

## 22. Excecao: dia com dinheiro acima de R$ 5.000,00

O plano precisa tratar o caso em que um unico fechamento tem dinheiro fisico contado maior que R$ 5.000,00. Se a regra "nao dividir dia" for absoluta, o sistema fica bloqueado. Portanto, deve existir uma solucao.

Recomendacao: divisao manual assistida.

Fluxo:

1. Fechamento aprovado tem `countedCashAmount > 5000`.
2. Sistema marca `cashDeposit.status = not_allocated` e alerta "valor acima do limite por boleto".
3. Financeiro abre tela de alocacao manual.
4. Sistema sugere dividir em partes de ate R$ 5.000,00.
5. Usuario confirma a divisao.
6. Cada parte vira item de bloco com referencia ao mesmo fechamento.
7. Auditoria registra a divisao.

Exemplo:

`07/06 - R$ 11.200,00`

Divisao sugerida:

- Bloco A: R$ 5.000,00.
- Bloco B: R$ 5.000,00.
- Bloco C: R$ 1.200,00.

Isso mantem a regra bancaria sem perder rastreabilidade.

## 23. Tela de depositos em dinheiro

Criar area:

`/dashboard/financeiro/depositos-dinheiro`

Ou como aba dentro do modulo de fechamento:

`/dashboard/financeiro/fechamento-caixa/depositos`

Visao inicial:

- Cards de unidades com bloco aberto.
- Valor aberto.
- Blocos travados aguardando emissao.
- Boletos emitidos aguardando pagamento.
- Boletos pagos recentemente.

Por unidade, mostrar lista de blocos:

```txt
Bloco #12
Tirirical
01/06 a 03/06
R$ 4.000,00 / R$ 5.000,00
Status: Travado
Motivo: 04/06 tinha R$ 1.200,00 e ultrapassaria o limite
[Emitir boleto]
```

Bloco aberto:

```txt
Bloco #13
Tirirical
04/06
R$ 1.200,00 / R$ 5.000,00
Ainda cabem R$ 3.800,00
[Emitir boleto]
```

Bloco cheio:

```txt
Bloco #14
Tirirical
08/06 a 10/06
R$ 5.000,00 / R$ 5.000,00
Status: Aberto, limite atingido
[Emitir boleto]
```

Ao clicar no bloco, abrir detalhe com:

- Dias incluidos.
- Fechamentos.
- Operadoras.
- Valor por dia.
- Historico de status.
- Dados do boleto, se emitido.
- Acoes.

## 24. Emissao manual de boleto

Regra absoluta: boleto so e emitido quando o usuario clicar.

Mesmo se o bloco tiver exatamente R$ 5.000,00, o sistema nao chama o banco automaticamente. Ele apenas mostra que o bloco esta pronto para emissao.

Ao clicar em "Emitir boleto", o sistema deve abrir modal de confirmacao.

Para bloco menor que R$ 5.000,00:

```txt
Atencao
Este bloco possui R$ 4.000,00 e ainda comporta R$ 1.000,00 antes do limite de R$ 5.000,00.
Emitir agora criara uma cobranca menor.

Deseja emitir mesmo assim?
[Cancelar] [Emitir mesmo assim]
```

Para bloco de R$ 5.000,00:

```txt
Confirmar emissao
Valor do bloco: R$ 5.000,00
Dias: 01/06 a 04/06

[Cancelar] [Emitir boleto]
```

Ao confirmar:

1. Validar permissao.
2. Mudar status para `issuing`.
3. Travar bloco para novas alocacoes.
4. Criar registro interno de cobranca.
5. Chamar API bancaria.
6. Salvar identificadores.
7. Mudar status para `issued`.
8. Registrar auditoria.

Se falhar:

- Status `failed` ou voltar para `locked` com erro.
- Guardar `lastIssueError`.
- Permitir tentar novamente, sem duplicar cobranca se ja existir `codigoSolicitacao`.

## 25. Integracao bancaria com Inter

No sistema, essa integracao deve ser tratada como "Entrada por boleto" ou "Cobranca de entrada", nao como "deposito bancario oficial", porque a API usada e de cobranca. O banco pode gerar boleto e QR Code Pix, mas o produto tecnico e cobranca.

Componentes:

- Autenticacao OAuth com mTLS.
- Criacao de cobranca.
- Consulta de cobranca.
- Download de PDF.
- Cancelamento.
- Webhook.

Variaveis de ambiente:

```txt
INTER_CLIENT_ID=
INTER_CLIENT_SECRET=
INTER_CERT_PATH=
INTER_KEY_PATH=
INTER_BASE_URL=
INTER_CONTA_CORRENTE=
INTER_WEBHOOK_SECRET=
```

O token deve ser obtido apenas no backend e cacheado ate expirar. Certificados e chaves nao devem ficar no frontend nem em logs.

Modulos sugeridos:

```txt
src/lib/inter/auth.ts
src/lib/inter/client.ts
src/lib/inter/cobrancas.ts
src/app/api/webhooks/inter/cobranca/route.ts
```

Rotas internas para frontend:

```txt
POST /api/financial/cash-deposits/{batchId}/issue
GET  /api/financial/cash-deposits/{batchId}/boleto/pdf
POST /api/financial/cash-deposits/{batchId}/cancel-boleto
```

O frontend nao deve chamar `/oauth/v2/token` nem endpoints do Inter diretamente.

## 26. Modelo de dados da cobranca Inter

Colecao:

`interCobrancas`

Tipo:

```ts
type InterCobrancaStatusInterno =
  | "created"
  | "requested"
  | "issued"
  | "paid"
  | "cancelled"
  | "expired"
  | "failed";

type InterCobranca = {
  id: string;
  workspaceId: string;
  type: "cash_deposit_batch";
  batchId: string;
  kioskId: string;
  seuNumero: string;
  codigoSolicitacao: string | null;
  valorNominal: number;
  dataVencimento: string;
  numDiasAgenda: number;
  pagador: {
    cpfCnpj: string;
    tipoPessoa: "FISICA" | "JURIDICA";
    nome: string;
    email?: string;
    telefone?: string;
    cep: string;
    endereco: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    uf: string;
  };
  statusInterno: InterCobrancaStatusInterno;
  statusInter: string | null;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  pixCopiaECola: string | null;
  txid: string | null;
  pdfStoragePath: string | null;
  lastConsultedAt: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lastError: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
```

O bloco guarda apenas referencia para `interCobrancaId`. A cobranca guarda detalhes bancarios.

## 27. Fluxo de emissao da cobranca

1. Usuario abre bloco.
2. Usuario clica em "Emitir boleto".
3. Sistema mostra modal de confirmacao.
4. Usuario confirma.
5. Backend valida permissao e status do bloco.
6. Backend muda bloco para `issuing`.
7. Backend cria `interCobrancas` com status `created`.
8. Backend obtem token Inter.
9. Backend chama endpoint de criacao de cobranca.
10. Backend salva `codigoSolicitacao`.
11. Backend consulta cobranca ate obter dados principais, se necessario.
12. Backend salva linha digitavel, codigo de barras e dados Pix quando disponiveis.
13. Backend muda cobranca para `issued`.
14. Backend muda bloco para `issued`.
15. Usuario pode baixar PDF ou copiar linha digitavel.

Se a API de criacao for assincrona, o sistema deve aceitar estado intermediario `requested` e oferecer consulta posterior. Nao se deve assumir que o PDF estara disponivel imediatamente apos a primeira chamada.

## 28. Webhook e conciliacao bancaria

O webhook recebe eventos do banco, mas nao deve ser a unica fonte de verdade. Ao receber webhook, o sistema deve:

1. Validar autenticidade.
2. Localizar cobranca por `codigoSolicitacao` ou identificador equivalente.
3. Consultar ativamente a cobranca no Inter.
4. Confirmar status e valor.
5. Atualizar `interCobrancas`.
6. Atualizar `cashDepositBatches`.
7. Registrar log.

Se o banco indicar pagamento parcial ou valor divergente, o sistema deve tratar como alerta, nao simplesmente marcar pago. Para boleto, o esperado e pagamento do valor nominal, mas integracao bancaria deve ser defensiva.

Estados:

- Cobranca `paid` implica bloco `paid`.
- Cobranca `cancelled` implica bloco `cancelled` ou volta controlada para `locked`, dependendo de regra.
- Cobranca `expired` pode deixar bloco com acao "emitir nova cobranca", preservando a anterior.

## 29. Cancelamento e reemissao

O usuario autorizado pode cancelar uma cobranca emitida quando:

- Foi emitida com dados errados.
- O valor estava incorreto.
- O boleto venceu e sera reemitido.
- Houve duplicidade.

Cancelamento deve:

1. Chamar API bancaria.
2. Atualizar `interCobrancas`.
3. Atualizar bloco.
4. Registrar auditoria.

Nao apagar a cobranca anterior. Se reemitir, criar nova `interCobranca` vinculada ao mesmo bloco ou criar campo de historico:

```ts
interCobrancaIds: string[];
currentInterCobrancaId: string | null;
```

Isso permite rastrear tentativas anteriores.

## 30. Ajustes apos boleto emitido

Caso um fechamento aprovado entre em bloco e o boleto seja emitido ou pago, e depois o fechamento seja reaberto, nao se deve alterar o valor historico do bloco. O correto e criar um ajuste.

Exemplo:

- Fechamento aprovado: dinheiro fisico R$ 368,00.
- Entrou em bloco e boleto foi pago.
- Depois reabriu e corrigiu para R$ 365,00.
- Diferenca: -R$ 3,00.

O sistema cria ajuste de -R$ 3,00 para proximo bloco.

Colecao:

`cashDepositAdjustments`

Tipo:

```ts
type CashDepositAdjustment = {
  id: string;
  workspaceId: string;
  sourceClosureId: string;
  sourceBatchId: string | null;
  kioskId: string;
  amountDelta: number;
  reason:
    | "closure_reopened"
    | "counted_amount_changed"
    | "manual_correction";
  status:
    | "pending_allocation"
    | "allocated"
    | "cancelled";
  targetBatchId: string | null;
  createdBy: string;
  createdAt: string;
};
```

Esse ajuste entra na fila de deposito como item `cash_adjustment`.

## 31. Relatorios

Relatorios essenciais:

1. Fechamentos pendentes por unidade.
2. Divergencias por periodo.
3. Divergencias por operadora.
4. Divergencias por canal.
5. Dinheiro fisico contado por unidade.
6. Blocos de deposito abertos.
7. Blocos travados aguardando boleto.
8. Boletos emitidos aguardando pagamento.
9. Boletos pagos por periodo.
10. Ajustes de deposito.

Cada relatorio deve permitir filtros por:

- Unidade.
- Periodo.
- Status.
- Operadora.
- Canal.
- Usuario aprovador.
- Bloco.
- Boleto.

Exportacoes futuras:

- CSV.
- PDF.
- Planilha.

## 32. Indicadores para a gestao

Indicadores uteis:

- Percentual de dias fechados no prazo.
- Valor total divergente no mes.
- Quantidade de divergencias por unidade.
- Media de divergencia por operadora.
- Tempo medio entre dia operacional e aprovacao.
- Dinheiro fisico aguardando deposito.
- Valor em boletos emitidos nao pagos.
- Tempo medio ate liquidacao do boleto.

Esses indicadores ajudam a identificar unidade com problema recorrente, atraso operacional e dinheiro parado sem deposito.

## 33. Seguranca

Credenciais do PDV Legal e Inter devem ficar somente no backend. Logs nao podem imprimir token, client secret, certificado, senha ou payload sensivel completo.

Dados bancarios devem ter acesso restrito. Linha digitavel, PDF de boleto, CPF/CNPJ do pagador e dados de endereco exigem cuidado. Apenas usuarios autorizados devem visualizar ou baixar.

Webhooks devem ser protegidos por segredo, validacao de origem ou mecanismo recomendado pelo banco. Mesmo com webhook, a baixa definitiva deve consultar o banco.

Regras Firestore devem impedir:

- Usuario comum editar fechamento aprovado.
- Usuario sem unidade ver fechamentos de outra unidade.
- Frontend escrever campos esperados do PDV.
- Frontend alterar dados bancarios diretamente.
- Frontend marcar boleto como pago.

## 34. Jobs e automacoes

Jobs sugeridos:

1. Sync diario de PDV para ontem, as 06:00.
2. Ressync manual por unidade/data.
3. Recalculo de resumos mensais.
4. Consulta periodica de cobrancas emitidas e nao pagas.
5. Processamento de webhooks.
6. Detector de fechamentos aprovados nao alocados.
7. Detector de blocos com erro de emissao.

O sync diario deve ser idempotente. Rodar duas vezes nao pode duplicar fechamento nem linhas.

O alocador de depositos tambem deve ser idempotente. Um fechamento aprovado nao pode entrar duas vezes em bloco.

## 35. Indices Firestore

Indices provaveis:

`cashClosures`

- `workspaceId, kioskId, date`
- `workspaceId, kioskId, year, month`
- `workspaceId, status, date`
- `workspaceId, kioskId, status`

`cashDepositBatches`

- `workspaceId, kioskId, status`
- `workspaceId, status, createdAt`
- `workspaceId, kioskId, periodStartDate`

`interCobrancas`

- `workspaceId, codigoSolicitacao`
- `workspaceId, statusInterno`
- `workspaceId, batchId`

`cashClosureAuditLogs`

- `workspaceId, closureId, createdAt`
- `workspaceId, userId, createdAt`

## 36. Fases de implementacao

Fase 1: motor de fechamento.

- Criar normalizacao de canais.
- Criar fetch server-side do PDV.
- Criar `buildCashClosureFromPdv`.
- Validar casos reais de Tirirical e Joao Paulo.
- Testes unitarios para dinheiro, troco, PIX, debito e credito.

Fase 2: persistencia de fechamento.

- Criar tipos.
- Criar colecoes.
- Criar rotina manual para gerar fechamento.
- Criar idempotencia.
- Criar auditoria basica.

Fase 3: tela do dia.

- Mostrar operadoras e canais.
- Inputs de valor fisico.
- Calculo de diferenca.
- Observacao obrigatoria.
- Salvar rascunho.
- Finalizar.

Fase 4: revisao e aprovacao.

- Aprovar.
- Reabrir.
- Permissoes.
- Auditoria completa.

Fase 5: navegacao.

- Cards de unidade.
- Cards mensais.
- Calendario.
- Resumos.

Fase 6: blocos de deposito.

- Criar modelo `cashDepositBatches`.
- Alocar dinheiro aprovado.
- Travar por limite.
- Tela de blocos.
- Ressalva para boleto menor.

Fase 7: Inter.

- Configurar credenciais.
- Implementar client mTLS.
- Criar cobranca.
- Consultar.
- PDF.
- Webhook.
- Cancelamento.

Fase 8: ajustes e robustez.

- Ajuste apos reabertura.
- Dia acima de R$ 5.000,00.
- Reemissao.
- Relatorios.

## 37. Testes

Testes unitarios:

- `TROCO` reduz dinheiro.
- Formas desconhecidas vao para `other`.
- Cupom cancelado e ignorado.
- Item cancelado e ignorado.
- Agrupamento por `usuariorecebimento_id`.
- Diferenca calculada corretamente.
- Observacao obrigatoria para divergencia.
- Bloco aceita valor que cabe.
- Bloco trava quando proximo valor ultrapassa.
- Bloco nao emite automaticamente.
- Bloco menor exige alerta.
- Ajuste e criado quando fechamento alocado muda.

Testes de integracao:

- Buscar PDV real em data conhecida.
- Persistir fechamento.
- Editar contado.
- Aprovar.
- Alocar em bloco.
- Emitir cobranca em sandbox Inter.
- Receber webhook simulado.

Testes de seguranca:

- Usuario sem unidade nao acessa.
- Usuario comum nao aprova.
- Usuario comum nao emite boleto.
- Frontend nao altera esperado.
- Webhook invalido nao baixa cobranca.

## 38. Criterios de aceite

O modulo de fechamento esta aceito quando:

- O sistema sincroniza cupons do PDV por unidade/data.
- O dinheiro liquido e calculado como dinheiro menos troco.
- O usuario preenche valor fisico por operadora e canal.
- O sistema mostra falta/sobra/OK.
- Divergencia exige observacao.
- Fechamento pode ser aprovado.
- Fechamento aprovado gera valor elegivel para deposito.
- O dinheiro fisico entra em blocos de ate R$ 5.000,00.
- O sistema nao emite boleto automaticamente.
- Bloco menor mostra ressalva antes da emissao.
- Boleto emitido fica rastreado ao bloco e aos dias.
- Webhook/consulta atualiza pagamento.
- Reabertura apos deposito cria ajuste, nao altera historico sem log.

## 39. Decisoes pendentes

Algumas decisoes precisam ser confirmadas antes da implementacao final:

1. Quem sera o pagador da cobranca Inter? A propria empresa, uma pessoa responsavel, ou um cadastro institucional?
2. Qual vencimento padrao do boleto? Mesmo dia, proximo dia util ou prazo fixo?
3. Qual `numDiasAgenda` padrao?
4. Boletos vencidos serao cancelados automaticamente pelo sistema ou apenas monitorados?
5. Usuario pode cancelar bloco antes de emitir?
6. Usuario pode remover um dia de um bloco aberto?
7. Dia com mais de R$ 5.000,00 sera dividido manualmente ou exigira autorizacao especial?
8. Estornos do PDV entram no fechamento como ajuste ou ficam apenas em diagnostico?
9. Sangrias e suprimentos ficarao fora do fechamento ou terao aba propria?
10. Aprovacao com divergencia acima de qual valor exige perfil superior?

## 40. Recomendacao final

A recomendacao e construir primeiro o nucleo de fechamento, porque ele e a fonte operacional de verdade para todo o restante. Sem fechamento aprovado, nao ha valor confiavel para deposito. Depois, implementar blocos de deposito como consequencia do fechamento aprovado. Por ultimo, integrar o Inter, porque a emissao bancaria depende de regras operacionais ja consolidadas.

O desenho mais seguro e:

- PDV Legal alimenta `expectedAmount`.
- Usuario informa `countedAmount`.
- Financeiro aprova `cashClosure`.
- Sistema aloca `countedCashAmount` em `cashDepositBatch`.
- Usuario clica para emitir boleto.
- Inter retorna cobranca.
- Webhook e consulta confirmam pagamento.
- Ajustes preservam historico quando algo muda depois.

Esse fluxo cria controle operacional, reduz erro manual, mantem rastreabilidade e evita automatismos perigosos em movimentacao bancaria.

## 41. Fluxo operacional diario recomendado

O fluxo diario deve ser desenhado para que a equipe consiga operar sem precisar entender detalhes tecnicos do PDV ou do banco. A rotina ideal comeca automaticamente, mas termina sempre com acoes humanas de conferencia e aprovacao.

No inicio do dia, preferencialmente as 06:00, o sistema executa a sincronizacao do dia anterior. Para cada unidade com `pdvFilialId`, o backend chama o endpoint de cupons do PDV Legal, normaliza as formas de pagamento, agrupa os valores por operadora e canal e cria um fechamento em `draft`. Se a unidade nao teve vendas, o sistema pode criar fechamento com status especial de "sem movimento" ou manter `draft` com totais zerados. A decisao operacional deve ser simples: se o financeiro quer auditar todos os dias, inclusive dias sem venda, crie o fechamento zerado; se quer reduzir ruido, mostre o dia como sem movimento no calendario.

Quando o usuario responsavel abre a tela, ele nao deve precisar importar arquivo nem clicar em botao tecnico. O fechamento ja aparece com os valores PDV preenchidos. O usuario confere o caixa fisico e informa os valores na coluna "Valor fisico". Para PIX, debito e credito, o valor fisico pode significar conferencia por comprovante, relatorio da maquininha ou extrato operacional. Para dinheiro, significa dinheiro contado fisicamente, ja liquido de troco, porque o troco nao e valor a depositar.

Depois de preencher todas as linhas, o usuario salva ou finaliza. O botao "Salvar rascunho" deve permitir continuar depois. O botao "Finalizar fechamento" valida se nao ha linhas vazias e se toda divergencia tem observacao. A partir dai, o fechamento passa para `pending_review`. O financeiro revisa e aprova. A aprovacao e o evento que libera o dinheiro fisico para a fila de deposito.

Essa separacao e importante: preenchimento nao deve alocar dinheiro automaticamente, porque um rascunho ainda pode estar errado. Somente aprovacao gera valor elegivel. O sistema deve mostrar essa relacao claramente: "Este fechamento ainda nao foi aprovado; o dinheiro fisico ainda nao entrou em bloco de deposito".

## 42. Fluxo operacional semanal ou de deposito

O financeiro tambem tera uma rotina especifica para depositos. Essa rotina nao precisa acontecer diariamente, porque os blocos podem ficar abertos ate que o usuario decida emitir. A tela de depositos deve mostrar os blocos por unidade, com foco em acao.

Exemplo de lista:

```txt
Tirirical
Bloco aberto #18 - R$ 3.850,00 / R$ 5.000,00
Ainda cabem R$ 1.150,00

Bloco travado #17 - R$ 4.000,00 / R$ 5.000,00
Travado porque 04/06 tinha R$ 1.200,00 e ultrapassaria o limite

Joao Paulo
Bloco emitido #12 - R$ 5.000,00
Boleto aguardando pagamento
```

O usuario pode decidir emitir um bloco aberto menor. O sistema nao deve impedir, mas deve avisar. Esse aviso tem funcao de governanca, nao de bloqueio. A mensagem deve ser direta: "Este bloco ainda comporta R$ X. Emitir agora cria uma cobranca menor e impede que novos dias entrem nesse bloco". Ao confirmar, o bloco fica `issuing` e depois `issued`.

Se um bloco esta travado porque o proximo dia nao coube, ele tambem pode ser emitido. Nesse caso, a ressalva deve explicar que o bloco esta menor que R$ 5.000,00 por regra de limite e sequencia, nao por erro. A mensagem pode ser: "Este bloco tem R$ 4.000,00. O proximo fechamento tinha R$ 1.200,00 e ultrapassaria o limite de R$ 5.000,00, por isso um novo bloco foi iniciado".

## 43. UX detalhada dos cards de unidade

Os cards de unidade devem ser objetivos e operacionais. Nao devem ser cards decorativos grandes. O modulo sera usado por pessoas que precisam escanear pendencias rapidamente. Cada card precisa responder tres perguntas: existe pendencia, existe divergencia e existe dinheiro aguardando deposito.

Layout sugerido:

```txt
Tirirical                         Status: Pendente
Filial PDV 17343

Fechamento do mes
Pendentes 3 | Divergentes 1 | Aprovados 4

Depositos
Aberto: R$ 3.850,00 | Emitidos pendentes: R$ 5.000,00

Ultima sync: hoje 06:02
Ultimo aprovado: 06/07/2026
```

Indicadores visuais:

- Barra lateral vermelha se houver divergencia.
- Barra lateral amarela se houver pendencia sem divergencia.
- Barra lateral verde se tudo estiver aprovado ate ontem.
- Badge cinza para unidade sem PDV.

O card deve ter acoes discretas:

- Abrir unidade.
- Sincronizar ontem.
- Ver depositos.

Para evitar cliques acidentais, "Sincronizar ontem" e "Ver depositos" devem ser botoes secundarios ou itens de menu. O clique principal no card abre a pagina da unidade.

## 44. UX detalhada do calendario

O calendario precisa equilibrar densidade e clareza. Cada dia deve mostrar no maximo quatro informacoes principais. Informacao demais dentro da celula deixa o calendario ilegivel.

Conteudo minimo por dia:

- Numero e dia da semana.
- Status.
- Total PDV.
- Diferenca ou pendencias.

Quando o dia tiver dinheiro em deposito, mostrar apenas um badge curto:

```txt
Bloco #18
```

Ao passar o mouse ou abrir detalhe rapido, mostrar:

```txt
Dinheiro contado: R$ 703,00
Bloco #18: aberto
Boleto: nao emitido
```

O calendario deve permitir abrir o fechamento em um clique. Dias futuros devem ser visualmente desabilitados. Dias sem PDV configurado devem mostrar aviso claro. Dias com erro de sync devem permitir ressincronizacao para usuarios autorizados.

No topo, o resumo mensal deve incluir fechamento e deposito, mas em blocos separados:

```txt
Fechamento
PDV: R$ 18.420,50 | Fisico: R$ 18.415,50 | Diferenca: -R$ 5,00

Dinheiro e depositos
Dinheiro contado: R$ 7.200,00 | Alocado: R$ 7.200,00 | Emitido: R$ 5.000,00 | Pago: R$ 0,00
```

Essa separacao evita confundir faturamento total com dinheiro fisico.

## 45. UX detalhada da tela de fechamento

A tela de fechamento deve ser orientada a tarefa. O usuario deve conseguir preencher sem rolar excessivamente, mas tambem precisa de detalhes quando houver duvida. A solucao e usar grupos por operadora com linhas compactas e areas expansivas.

Cada grupo de operadora deve ter cabecalho:

```txt
Maria Edna2
PDV R$ 960,50 | Fisico R$ 960,50 | OK
```

As linhas:

```txt
Canal              PDV            Fisico          Resultado
Dinheiro liquido   R$ 368,00      R$ 368,00      OK
PIX                R$ 315,00      R$ 315,00      OK
Debito             R$ 195,00      R$ 195,00      OK
Credito            R$ 82,50       R$ 82,50       OK
```

Na linha de dinheiro, um botao de informacao deve abrir composicao:

```txt
Composicao do dinheiro
Dinheiro recebido no PDV: R$ 401,00
Troco devolvido: R$ 33,00
Dinheiro liquido esperado: R$ 368,00
```

Quando houver divergencia, a linha deve expandir ou exibir campo de observacao obrigatorio:

```txt
Falta R$ 3,00
Observacao obrigatoria: [input]
```

O sistema deve salvar automaticamente como rascunho ou ao menos alertar se houver alteracoes nao salvas. Fechamento de caixa e uma tela sensivel; perder digitacao e ruim.

## 46. UX detalhada dos blocos de deposito

Na tela de blocos, a unidade principal de informacao e o bloco. Cada bloco deve mostrar:

- Status.
- Periodo.
- Valor total.
- Capacidade restante.
- Quantidade de dias.
- Se tem boleto.
- Acao principal.

Bloco aberto:

```txt
Bloco #18 - Aberto
04/06 a 06/06
R$ 3.850,00 / R$ 5.000,00
Ainda cabem R$ 1.150,00
[Emitir boleto]
```

Bloco travado:

```txt
Bloco #17 - Travado
01/06 a 03/06
R$ 4.000,00 / R$ 5.000,00
Motivo: o fechamento de 04/06 tinha R$ 1.200,00 e ultrapassaria o limite
[Emitir boleto]
```

Bloco emitido:

```txt
Bloco #16 - Boleto emitido
28/05 a 31/05
R$ 5.000,00
Linha digitavel disponivel
[Baixar boleto] [Consultar status]
```

Bloco pago:

```txt
Bloco #15 - Pago
20/05 a 24/05
R$ 5.000,00
Pago em 27/05/2026
[Ver detalhes]
```

Detalhe do bloco:

- Lista de dias.
- Valor por dia.
- Operadoras incluídas.
- Fechamentos vinculados.
- Historico de emissao.
- Dados bancarios.
- Auditoria.

## 47. Politica de bloco menor

Bloco menor e permitido, mas precisa ficar claro que e uma escolha operacional. O sistema deve diferenciar tres situacoes:

1. Bloco menor aberto por escolha do usuario.
2. Bloco menor travado porque o proximo dia ultrapassaria R$ 5.000,00.
3. Bloco menor por fim de ciclo operacional, se no futuro houver decisao manual de encerrar.

Como nao havera fechamento automatico por fim de semana ou fim de mes, a terceira situacao so ocorre se o usuario clicar para emitir. Nao deve existir job fechando bloco menor.

Na confirmacao de emissao de bloco menor, mostrar:

```txt
Este bloco esta abaixo do limite de R$ 5.000,00.
Valor atual: R$ 3.850,00
Capacidade restante: R$ 1.150,00

Ao emitir, este bloco sera travado e nao recebera novos fechamentos.
Deseja continuar?
```

Se o bloco menor esta travado porque o proximo dia nao coube, mostrar:

```txt
Este bloco esta abaixo de R$ 5.000,00 porque o proximo fechamento ultrapassaria o limite.
Valor atual: R$ 4.000,00
Proximo fechamento rejeitado: R$ 1.200,00
Soma seria: R$ 5.200,00
```

Essa explicacao evita que o operador ache que o sistema "parou antes da hora" sem motivo.

## 48. Integridade entre fechamento e deposito

O campo `cashDeposit` dentro de `cashClosures` e uma referencia operacional, nao a fonte unica da verdade. A fonte da composicao do bloco esta em `cashDepositBatches/{batchId}/items`. Ainda assim, o fechamento deve guardar o estado para facilitar telas:

```ts
cashDeposit: {
  eligibleAmount: 703,
  batchId: "batch_18",
  batchItemId: "item_2026_07_07",
  status: "allocated"
}
```

Quando um bloco e emitido, os fechamentos relacionados podem ser atualizados para `issued`. Quando pago, para `paid`. Isso facilita o calendario mostrar "Boleto pago". Mas essas atualizacoes devem ser derivadas do bloco, nao feitas manualmente.

Se houver inconsistencias, um job de reconciliacao pode recalcular os estados derivados:

- Se fechamento aponta batch inexistente, alertar.
- Se batch contem item mas fechamento nao aponta batch, corrigir ou alertar.
- Se batch pago mas fechamento ainda `allocated`, atualizar.

## 49. Regra para reabertura

Reabrir fechamento e um ponto critico. A regra deve depender do estado de deposito.

Caso 1: fechamento aprovado, mas ainda nao alocado.

- Permitir reabrir.
- Ao aprovar novamente, alocar valor atualizado.

Caso 2: fechamento aprovado e alocado em bloco `open` ou `locked`, sem boleto emitido.

- Permitir reabrir com permissao.
- Remover ou ajustar item no bloco, se ainda nao emitido.
- Recalcular total do bloco.
- Registrar auditoria.

Caso 3: fechamento alocado em bloco `issued` ou `paid`.

- Nao alterar bloco historico.
- Permitir reabrir com permissao alta.
- Ao aprovar novamente, calcular delta.
- Criar `cashDepositAdjustment`.

Esse comportamento evita que um boleto ja emitido fique sem lastro nos fechamentos que o compunham.

## 50. Backlog tecnico detalhado

Epic 1: PDV e motor de fechamento.

- Criar tipos TypeScript para cupons normalizados.
- Criar parser defensivo de resposta `cupom/get`.
- Criar normalizador de canais.
- Criar agregador por operadora e canal.
- Criar diagnostico de formas desconhecidas.
- Criar testes unitarios.

Epic 2: Persistencia.

- Criar repositorios server-side para `cashClosures`.
- Criar escrita idempotente de linhas.
- Criar logs de auditoria.
- Criar recalculo de totais.
- Criar indices Firestore.

Epic 3: UI de fechamento.

- Criar rota de lista de unidades.
- Criar rota de unidade/meses.
- Criar calendario.
- Criar tela do dia.
- Criar inputs monetarios.
- Criar validacoes.
- Criar fluxo de envio e aprovacao.

Epic 4: Depositos.

- Criar modelo de batch.
- Criar alocador.
- Criar tela de blocos.
- Criar modal de emissao.
- Criar regra de bloco menor.
- Criar tratamento de dia acima de R$ 5.000,00.

Epic 5: Inter.

- Criar client mTLS.
- Criar autenticacao OAuth.
- Criar emissao de cobranca.
- Criar consulta.
- Criar PDF.
- Criar webhook.
- Criar cancelamento.
- Criar reconciliador.

Epic 6: Governanca.

- Permissoes.
- Auditoria completa.
- Relatorios.
- Exportacao.
- Dashboards.

## 51. Backlog de produto em historias

Historia 1: Como financeiro, quero ver cards de unidades para saber rapidamente quais unidades tem fechamento pendente.

Aceite:

- Lista unidades com PDV configurado.
- Mostra pendentes, divergentes e aprovados.
- Mostra status visual.
- Abre pagina da unidade.

Historia 2: Como operador, quero preencher o valor fisico por canal para comparar com o valor do PDV.

Aceite:

- Mostra linhas por operadora e canal.
- Valor PDV e somente leitura.
- Valor fisico e editavel em rascunho.
- Resultado muda em tempo real.
- Divergencia exige observacao.

Historia 3: Como financeiro, quero aprovar fechamento para liberar dinheiro ao deposito.

Aceite:

- Apenas perfil autorizado aprova.
- Aprovacao registra auditoria.
- Dinheiro fisico contado entra na fila de deposito.
- Fechamento aprovado bloqueia edicao comum.

Historia 4: Como financeiro, quero ver blocos de dinheiro para emitir boleto quando decidir.

Aceite:

- Mostra blocos por unidade.
- Mostra valor, limite e capacidade restante.
- Permite emitir manualmente.
- Alerta para bloco menor.
- Nunca emite automaticamente.

Historia 5: Como financeiro, quero rastrear um boleto ate os fechamentos que o compuseram.

Aceite:

- Detalhe do boleto mostra bloco.
- Bloco mostra dias.
- Dias abrem fechamentos.
- Fechamento mostra status do deposito.

## 52. Observabilidade e suporte

O modulo deve ter logs tecnicos suficientes para diagnosticar falhas sem expor dados sensiveis. Logs de sync devem incluir:

- Data.
- Unidade.
- Filial PDV.
- Quantidade de cupons.
- Quantidade de formas.
- Total calculado.
- Formas desconhecidas.
- Erros de API.

Logs de Inter devem incluir:

- Batch ID.
- Cobranca ID interna.
- `codigoSolicitacao` quando existir.
- Status HTTP.
- Status interno.
- Mensagem de erro sanitizada.

Nao logar:

- Token.
- Client secret.
- Certificado.
- Chave privada.
- CPF/CNPJ completo, se nao necessario.
- Payload bancario completo em ambiente de producao.

Criar painel tecnico simples para admins:

- Ultimas sincronizacoes PDV.
- Ultimas emissoes Inter.
- Webhooks recebidos.
- Erros pendentes.

## 53. Rollout recomendado

Nao implementar tudo em producao de uma vez. O rollout deve ser gradual.

Fase piloto:

- Apenas Tirirical.
- Apenas fechamento sem Inter.
- Comparar totais com relatorios atuais.
- Ajustar mapeamento de canais.

Fase 2:

- Incluir Joao Paulo.
- Habilitar aprovacao.
- Habilitar blocos de deposito sem emissao bancaria.
- Simular blocos manualmente.

Fase 3:

- Integrar Inter em sandbox.
- Emitir cobrancas de teste.
- Validar PDF, webhook e consulta.

Fase 4:

- Produção com Inter para um grupo restrito.
- Monitorar emissao e pagamento.
- Liberar para todas as unidades.

Fase 5:

- Relatorios gerenciais.
- Ajustes de UX.
- Automatizacoes adicionais.

## 54. Riscos e mitigacoes

Risco: PDV muda nome de forma de pagamento.

Mitigacao: diagnostico de formas desconhecidas e mapeamento configuravel.

Risco: Troco tratado errado.

Mitigacao: teste unitario obrigatorio e composicao visivel na tela.

Risco: Fechamento reaberto apos boleto pago.

Mitigacao: ajustes imutaveis em vez de alterar bloco pago.

Risco: Boleto duplicado por retry.

Mitigacao: idempotencia por `batchId` e `seuNumero`; nao criar nova cobranca se ja existe `codigoSolicitacao`.

Risco: Webhook falso ou duplicado.

Mitigacao: validar segredo, consultar banco antes de baixar e tornar processamento idempotente.

Risco: Usuario emite bloco menor sem perceber.

Mitigacao: modal com ressalva clara e registro de auditoria.

Risco: Dia acima de R$ 5.000,00.

Mitigacao: fluxo de divisao manual assistida.

Risco: Dados sensiveis expostos.

Mitigacao: rotas server-side, regras de permissao e logs sanitizados.

## 55. Definicao de pronto

O modulo completo so deve ser considerado pronto quando:

- O fechamento diario consegue ser sincronizado do PDV.
- O valor por canal bate com dados reais auditados.
- Dinheiro liquido desconta troco corretamente.
- Usuario consegue preencher, salvar, finalizar e aprovar.
- Divergencias ficam visiveis e justificadas.
- Auditoria registra eventos relevantes.
- Blocos de deposito sao formados somente com dinheiro fisico contado.
- Blocos nunca ultrapassam R$ 5.000,00 sem tratamento especial.
- Boleto nunca e emitido automaticamente.
- Bloco menor exige alerta antes da emissao.
- Integracao Inter salva identificadores e status.
- Webhook e consulta confirmam pagamento.
- Reaberturas apos boleto emitido geram ajustes.
- Permissoes impedem operacoes indevidas.
- Relatorios respondem pendencias, divergencias, depositos e boletos.

Quando esses pontos estiverem cobertos, o Coala tera uma cadeia completa: venda no PDV, conferencia fisica, aprovacao, preparacao de deposito, emissao bancaria e conciliacao. Essa cadeia reduz risco operacional e cria uma base solida para evoluir o financeiro sem depender de controles paralelos.

## 56. Anexo de exemplos operacionais

Este anexo consolida exemplos que devem ser usados como referencia em testes, validacao com usuarios e desenho de interface. Eles ajudam a transformar regra abstrata em comportamento verificavel.

Exemplo de fechamento por operadora:

```txt
Unidade: Tirirical
Data: 07/07/2026
Operadora: Maria Edna2

PDV por forma:
DINHEIRO: R$ 401,00
TROCO: R$ 33,00
PIX STONE: R$ 315,00
CARTAO DEBITO: R$ 195,00
CARTAO CREDITO: R$ 82,50

Fechamento exibido:
Dinheiro liquido: R$ 368,00
PIX: R$ 315,00
Debito: R$ 195,00
Credito: R$ 82,50
Total: R$ 960,50
```

Se o usuario preencher dinheiro fisico como R$ 365,00, o sistema mostra:

```txt
Dinheiro liquido
PDV: R$ 368,00
Fisico: R$ 365,00
Resultado: Falta R$ 3,00
Observacao: obrigatoria
```

Se os outros canais baterem, o fechamento da operadora ainda fica divergente por R$ 3,00. O fechamento do dia tambem fica divergente, ainda que a divergencia seja pequena. A aprovacao pode ser permitida, mas deve registrar que houve aprovacao com divergencia.

Exemplo de alocacao de deposito com valores contados:

```txt
01/06 - R$ 300,00
02/06 - R$ 3.000,00
03/06 - R$ 700,00
04/06 - R$ 1.000,00
```

Resultado:

```txt
Bloco #1
01/06, 02/06, 03/06, 04/06
Total: R$ 5.000,00
Status: open
Condicao visual: limite atingido
Acao: Emitir boleto
```

Mesmo com limite atingido, o status pode continuar `open` ou virar `locked` por `limit_reached`, conforme a implementacao escolhida. O ponto essencial e que nao existe emissao automatica. O usuario precisa clicar.

Exemplo com proximo dia ultrapassando:

```txt
01/06 - R$ 300,00
02/06 - R$ 3.000,00
03/06 - R$ 700,00
04/06 - R$ 1.200,00
```

Resultado:

```txt
Bloco #1
01/06, 02/06, 03/06
Total: R$ 4.000,00
Status: locked
Motivo: next_item_would_exceed_limit
Proximo item rejeitado: 04/06, R$ 1.200,00

Bloco #2
04/06
Total: R$ 1.200,00
Status: open
```

O bloco #1 deve mostrar uma explicacao visivel. O usuario nao deve precisar calcular mentalmente por que o sistema nao colocou 04/06 no primeiro bloco.

Exemplo de bloco menor emitido por escolha:

```txt
Bloco #2
04/06
Total: R$ 1.200,00
Status: open
Capacidade restante: R$ 3.800,00
```

Se o usuario clicar em "Emitir boleto", exibir:

```txt
Este bloco ainda comporta R$ 3.800,00 antes do limite de R$ 5.000,00.
Emitir agora criara uma cobranca menor e travara este bloco.
Deseja continuar?
```

Se confirmar, o bloco passa para `issuing` e depois `issued`.

## 57. Anexo de decisoes tecnicas recomendadas

Algumas decisoes tecnicas reduzem ambiguidade e devem ser adotadas desde o inicio.

Primeiro: usar centavos como numero inteiro internamente em funcoes criticas. Embora a UI mostre reais, calculos de diferenca e limite de bloco ficam mais seguros com centavos. Por exemplo, R$ 5.000,00 vira `500000`. Isso evita problemas de ponto flutuante. No Firestore, pode-se armazenar como `amountCents` ou armazenar ambos com padrao claro. Se o projeto ja usa `number` decimal em outros modulos financeiros, manter consistencia pode ser mais pratico, mas as funcoes de calculo devem arredondar centavos explicitamente.

Segundo: separar DTO de API externa do modelo interno. O cupom do PDV Legal deve ser convertido para uma estrutura interna antes do calculo. Isso evita que a logica de fechamento dependa diretamente de variacoes como `Itens` ou `itens`, `ValorTotal` ou `valortotal`.

Terceiro: todo processo que escreve muitas entidades deve ser transacional quando possivel. Aprovar fechamento e alocar deposito mexe em fechamento, bloco, item do bloco e auditoria. Se nao der para usar uma unica transacao por limite tecnico, usar operacao idempotente com chaves deterministicas. Por exemplo, o item do bloco pode ter ID `{closureId}_cash`, impedindo duplicidade.

Quarto: o `seuNumero` da cobranca Inter deve ser deterministico ou ao menos unico por bloco. Um formato bom:

```txt
CX-{kioskSlug}-{yyyymmddInicio}-{sequencial}
```

Exemplo:

```txt
CX-TIR-20260601-000017
```

Quinto: a consulta ao banco apos webhook e obrigatoria. Webhook deve ser gatilho, nao fonte final. Isso protege contra payload incompleto, duplicado ou fraudulento.

Sexto: PDFs bancarios nao precisam ser armazenados se puderem ser baixados sob demanda. Se o time decidir armazenar, usar Storage com permissao restrita, nome sem dados sensiveis e auditoria de acesso.

Setimo: todo cancelamento de cobranca deve exigir motivo. Cancelar boleto afeta rastreabilidade financeira. O motivo deve aparecer no historico do bloco.

Oitavo: a rotina de ressincronizacao do PDV deve ter escopo claro. Ressincronizar um fechamento em `draft` e simples. Ressincronizar um fechamento `approved` deve gerar alerta de possivel mudanca no esperado e exigir decisao do financeiro.

## 58. Anexo de perguntas para fechar antes do desenvolvimento

Antes de codificar a parte bancaria, o time precisa responder algumas perguntas operacionais.

Quem sera o pagador da cobranca? Se o boleto representa uma entrada operacional interna, e preciso definir se o pagador sera a propria empresa, uma pessoa responsavel, uma entidade operacional cadastrada ou outro arranjo permitido pelo banco e pela contabilidade. Essa decisao afeta CPF/CNPJ, endereco e governanca.

Qual e o vencimento padrao? Se o boleto sera usado para deposito de dinheiro fisico, o vencimento talvez deva ser curto, como D+1 ou D+2. Mas isso deve respeitar rotina real de quem paga.

O que acontece com boleto vencido? O sistema cancela manualmente, permite reemitir, ou apenas mostra vencido? A recomendacao e nao cancelar automaticamente na primeira versao. Mostrar alerta e permitir acao manual.

Qual valor exige aprovacao superior? Divergencia de R$ 0,10 e diferente de divergencia de R$ 100,00. Definir limites ajuda a priorizar revisao.

Sangrias e suprimentos entram em qual tela? Eles nao devem misturar com venda por canal, mas podem ser exibidos em aba de diagnostico do caixa. Isso ajuda a explicar dinheiro fisico sem distorcer faturamento.

Com essas respostas, o plano fica pronto para virar backlog tecnico com menor risco de retrabalho.
