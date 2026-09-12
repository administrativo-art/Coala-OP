# Plano de integração Stone, conciliação de receitas e caixa — v3

**Status:** plano para implementação incremental

**Competência inicial do backfill:** agosto de 2026

**Unidades:** Whopping, Tirirical e João Paulo

**Fuso operacional:** `America/Belem`

## 1. Objetivo

Construir uma trilha financeira auditável que conecte:

1. vendas e formas de pagamento do PDV Legal;
2. vendas aprovadas no painel de Vendas da Stone;
3. dinheiro físico conferido no fechamento de caixa;
4. sangrias, suprimentos, custódia e depósitos de numerário;
5. agenda de recebíveis da Stone;
6. liquidações realizadas na conta Stone;
7. transferências da conta Stone para o Banco Inter;
8. DRE por competência e fluxo de caixa previsto/realizado.

O resultado deve permitir consultar cada unidade isoladamente e o consolidado das três unidades, sem misturar venda, recebimento e movimentação interna.

## 2. Visões financeiras e fontes

| Informação | Fonte primária | Data usada | Destino |
|---|---|---|---|
| Receita pelo PDV | PDV Legal | data da venda | DRE — critério PDV Legal |
| Receita conciliada | PDV + Stone Vendas + caixa classificado | data da venda | DRE — critério Receita conciliada |
| Taxa Stone/MDR | Stone | competência da venda | DRE, em conta própria |
| Taxa de antecipação | Stone, quando comprovada | data do evento de antecipação | DRE, em conta própria |
| Recebível líquido previsto | Agenda Stone | data prevista de liquidação | Fluxo de caixa previsto |
| Recebimento líquido realizado | Liquidação/extrato Stone | data efetiva | Fluxo de caixa realizado |
| Sangria | PDV + custódia física | data da movimentação | Transferência interna; sem DRE |
| Perda de caixa | Fechamento + classificação aprovada | competência do fechamento | Despesa operacional |
| Depósito de numerário | Lote de depósito + banco | data efetiva | Transferência interna; sem DRE |

Regra central:

```text
venda != recebível != recebimento != saldo da gaveta
```

## 3. Decisões de negócio já estabelecidas

- O painel **Vendas da Stone** deve ser conciliado com `Pix + débito + crédito` do PDV, sempre pelo valor bruto, pela unidade e pela data da venda.
- O painel **Recebimentos da Stone** não é comparado diretamente às vendas do mesmo mês. Parcelamento, prazo, antecipação, taxa, chargeback e calendário de liquidação tornam as bases diferentes.
- O valor líquido depositado pela Stone não substitui a Receita Bruta da DRE.
- Uma divergência nunca altera a receita automaticamente. Ela precisa de evidência, classificação, e, nos casos manuais, usuário e justificativa.
- Falta de caixa confirmada é despesa operacional; não é redução da receita.
- Sangria e suprimento são transferências de numerário; não são receita ou despesa.
- Venda não registrada encontrada na Stone ou no dinheiro físico pode ajustar a receita conciliada, mas não altera silenciosamente o PDV ou a escrituração fiscal.
- O Inter permanece como conta operacional única para pagamentos a terceiros.
- A conta Stone é conta de passagem: recebe as liquidações e transfere recursos ao Inter. Se pagamentos a terceiros passarem a sair da Stone, o modelo de contas e a projeção deverão ser revistos.
- Transferência Stone → Inter e depósito de numerário em conta própria têm efeito zero na DRE e no caixa consolidado, salvo tarifas identificadas separadamente.
- Valores financeiros novos serão processados em centavos inteiros.
- Eventos importados são imutáveis; projeções e resumos podem ser reconstruídos a partir deles.

## 4. Diagnóstico do sistema atual

### 4.1 Receita da DRE

A DRE atualmente prioriza `cashClosureMonthlySummaries` quando existe fechamento e usa o relatório de vendas apenas como fallback. O resumo do fechamento calcula a receita como:

```text
expectedTotalCents + finalizedDifferenceTotalCents
```

Referências:

- [`src/features/financial/pages/dre-page.tsx`](../src/features/financial/pages/dre-page.tsx)
- [`src/features/financial/cash-closures/summary-counts.ts`](../src/features/financial/cash-closures/summary-counts.ts)

Esse contrato mistura receita com posição física do caixa. Deve ser corrigido antes de a Receita conciliada se tornar uma opção oficial.

### 4.2 Pix e cartões no fechamento

Pix, débito e crédito são hoje marcados como conferidos automaticamente com o próprio valor do PDV. Não existe validação independente com o painel de Vendas da Stone.

Referências:

- [`src/features/financial/cash-closures/channel-normalization.ts`](../src/features/financial/cash-closures/channel-normalization.ts)
- [`src/features/financial/cash-closures/build-cash-closure.ts`](../src/features/financial/cash-closures/build-cash-closure.ts)

### 4.3 Pagamentos do PDV

O parser atual preserva cupom, operador, horário, forma de pagamento e valor, mas não projeta cada pagamento no banco financeiro nem extrai identificadores Stone como NSU, número de autorização ou TID quando existirem no payload bruto.

Referência:

- [`src/features/financial/cash-closures/pdv-coupon-parser.ts`](../src/features/financial/cash-closures/pdv-coupon-parser.ts)

### 4.4 Sangrias e depósitos

Sangrias reduzem corretamente o saldo esperado da gaveta, mas também participam do total que hoje chega ao cálculo da receita. Além disso, somente o dinheiro contado é tornado elegível para os lotes de depósito. A custódia do valor retirado por sangria precisa ser explícita para que o numerário não desapareça da trilha.

Referências:

- [`src/features/financial/cash-closures/repository.server.ts`](../src/features/financial/cash-closures/repository.server.ts)
- [`src/features/financial/cash-deposits/reconciliation.ts`](../src/features/financial/cash-deposits/reconciliation.ts)

### 4.5 Conciliação bancária existente

A sincronização do extrato Inter já implementa padrões úteis: cursor/overlap, idempotência, lançamentos bancários, sugestões, vínculo com origem, estados de reconciliação e auditoria. Esses padrões devem ser reaproveitados, sem acoplar a Stone ao código específico do Inter.

Referência:

- [`src/features/financial/inter-statement-sync.server.ts`](../src/features/financial/inter-statement-sync.server.ts)

## 5. Arquitetura-alvo

```text
PDV Legal ───────┐
                 ├─> pagamentos normalizados ─┐
Stone Vendas ────┘                            ├─> conciliação de vendas ─> resumo de receita
                                              │                             ├─> DRE PDV
Caixa físico + sangrias ─> conciliação caixa ─┘                             └─> DRE conciliada

Stone Vendas ─> recebíveis/parcelas ─> agenda líquida ─> fluxo previsto
                                              │
Extrato Stone ─> liquidações realizadas ──────┴─> fluxo realizado
                                              │
Transferência Stone ─> crédito Inter ─────────┴─> conciliação bancária
```

PDV e Financeiro usam bancos distintos. A solução não tentará simular transação atômica entre eles. Os fatos do PDV serão projetados de forma idempotente no banco financeiro, e a conciliação ocorrerá integralmente nesse banco.

## 6. Modelo de dados proposto

Todos os documentos abaixo pertencem ao banco financeiro.

### 6.1 Configuração

`stoneMerchantMappings/{mappingId}`

- `workspaceId`;
- `kioskId` e `kioskName`;
- CNPJ/Stonecode/estabelecimento;
- conta Stone;
- terminais vinculados;
- referências dos segredos, nunca os segredos;
- status e vigência do mapeamento.

### 6.2 Fatos do PDV

`pdvPaymentFacts/{deterministicId}`

- cupom e índice da forma de pagamento;
- unidade, operador, data e horário;
- canal normalizado;
- valor bruto;
- status do cupom/cancelamento;
- NSU, autorização, TID e terminal, se fornecidos;
- hash da origem e revisão observada.

O ID preferencial será derivado de `kioskId + couponId + paymentIndex`. Uma revisão altera o estado projetado, mas preserva evento e hash de origem.

### 6.3 Stone

`stoneSaleTransactions/{externalTransactionId}`

- Stonecode/estabelecimento/terminal;
- data e horário da venda;
- Pix, débito ou crédito;
- bruto, parcelas, bandeira e status;
- NSU, autorização e demais referências;
- cancelamentos/estornos vinculados;
- unidade atribuída ou status `unmapped`.

`stoneReceivables/{receivableKey}`

- venda e parcela de origem;
- bruto, MDR, antecipação, ajustes e líquido;
- data prevista original e atual;
- data efetiva, quando liquidada;
- estado atual e revisão da fonte.

`stoneReceivables/{receivableKey}/events/{eventId}` preservará cada observação append-only.

`stoneSettlements/{settlementId}`

- data e valor efetivos;
- conta Stone;
- composição conhecida;
- taxas, chargebacks e outros descontos;
- recebíveis vinculados;
- referência do extrato.

`stoneIngestionRuns/{runId}`

- fonte, Stonecode e data consultada;
- checksum/arquivo vigente/supersedes;
- contagens, limites e cursores;
- status, tentativas e erros sanitizados;
- horários de download e processamento.

### 6.4 Conciliação

`salesReconciliationCases/{caseId}`

- período e unidade;
- IDs do PDV e Stone com cardinalidade N:N;
- tipo da divergência;
- totais e diferença;
- confiança da sugestão;
- status da revisão;
- classificação contábil;
- decisão, justificativa, usuário e datas;
- referência para reversão/reabertura.

`revenueReconciliationPeriods/{workspaceId}_{kioskId}_{yyyyMM}`

- `open`, `partial`, `ready`, `closed`, `reopened` ou `stale`;
- cobertura das fontes por dia;
- contagens conciliadas e pendentes;
- totais PDV, Stone, caixa e ajustes;
- versão do fechamento e hash das fontes.

`revenueMonthlySummaries/{workspaceId}_{kioskId}_{yyyyMM}`

- receita total do PDV;
- PDV eletrônico por canal;
- Stone bruto por canal;
- vendas confirmadas somente na Stone;
- pagamentos do PDV classificados como inválidos;
- receita conciliada;
- perdas/sobras de caixa classificadas;
- MDR, antecipação e ajustes;
- líquido previsto e realizado;
- percentual de cobertura e status do período.

A DRE lerá apenas esses resumos, nunca todas as transações.

### 6.5 Caixa e custódia

As linhas existentes de fechamento receberão classificação da diferença e referências de efeito financeiro. A custódia será registrada em `cashCustodyMovements` ou, se o contrato existente comportar com clareza, como extensão de `cashDepositBatchItems`.

Cada sangria terá:

- movimento PDV de origem;
- origem física: gaveta/unidade/operador;
- destino: cofre, sessão, malote, outra unidade, despesa ou pendente;
- valor recebido no destino;
- diferença e status;
- vínculo com depósito/transferência/despesa;
- cadeia de custódia e auditoria.

## 7. Contratos de conciliação

### 7.1 PDV × painel de Vendas Stone

Comparação correta:

```text
PDV: Pix + débito + crédito, bruto, na data da venda
Stone: vendas aprovadas, bruto, na data da venda
```

Prioridade dos identificadores:

1. ID Stone gravado pelo PDV;
2. NSU + autorização + terminal;
3. cupom + valor + canal;
4. valor + canal + unidade + janela curta de horário;
5. sem chave única: sugestão manual, nunca pareamento automático.

O motor deverá suportar pagamento dividido e relações 1:1, 1:N e N:1.

Estados de caso:

- `matched_auto`;
- `matched_reviewed`;
- `pdv_only`;
- `stone_only`;
- `amount_mismatch`;
- `status_mismatch`;
- `unit_unmapped`;
- `ambiguous`;
- `resolved_adjustment`;
- `ignored_with_reason`.

Classificações e efeitos:

| Classificação | Receita conciliada | Ação adicional |
|---|---:|---|
| Venda válida nas duas fontes | mantém | nenhuma |
| Venda Stone não registrada no PDV | aumenta | alerta de regularização fiscal/operacional |
| Pagamento PDV comprovadamente inválido | reduz | registrar motivo e evidência |
| Venda de outra adquirente | mantém | encaminhar ao conector correto |
| Unidade Stone incorreta | transfere entre unidades | consolidado não muda |
| Diferença temporal | move a referência do caso | não altera valor |
| Cancelamento/estorno confirmado | reduz conforme política de competência | preservar evento original |

### 7.2 Caixa físico

```text
saldo final contado = fundo/suprimentos + vendas líquidas em dinheiro - sangrias
```

A diferença não é automaticamente receita ou despesa. Ela nasce como `pending_classification` e pode ser resolvida como:

- perda operacional de caixa;
- venda não registrada;
- suprimento/sangria incorreto;
- valor a receber do responsável;
- sobra sem origem identificada;
- erro de contagem;
- erro de integração.

Uma falta classificada como perda deve gerar efeito em `despesas_operacionais`, na conta `Quebras e diferenças de caixa`. Se a perda já representa dinheiro ausente, ela não deve criar uma obrigação bancária a pagar.

### 7.3 Sangrias

Uma sangria normal nunca afeta a DRE. Ela só muda a localização do ativo:

```text
gaveta -> cofre/numerário em trânsito -> lote de depósito -> conta bancária
```

Sangria destinada diretamente ao pagamento de fornecedor exige despesa e baixa próprias. Sangria sem destino comprovado fica pendente; somente após apuração pode virar perda.

### 7.4 Recebíveis e liquidações

```text
venda bruta
- MDR
- taxa de antecipação comprovada
+/- chargebacks e ajustes
= recebível líquido
```

Bruto e MDR pertencem à competência da venda. A taxa de antecipação pertence à competência do evento de antecipação. O recebível previsto e a liquidação pertencem às respectivas datas de caixa.

O lote Stone explica como vendas formaram o saldo na conta Stone. Ele não será ligado diretamente ao crédito no Inter porque uma transferência pode reunir vários lotes, saldo antigo ou apenas parte do valor.

### 7.5 Fechamento de período

- Um período pode ser visualizado como parcial, mas só recebe selo `closed` quando todas as fontes esperadas foram carregadas e todos os casos tiveram decisão.
- O consolidado só fecha quando Whopping, Tirirical e João Paulo estiverem fechados.
- Uma revisão tardia do PDV ou Stone marca o período `stale`; não altera silenciosamente um mês fechado.
- Reabertura exige permissão, motivo e auditoria.

## 8. Plano de implementação

### Fase 0 — Acesso e contrato Stone

Confirmar:

- credenciais e escopo dos Stonecodes;
- API/arquivo do painel de Vendas;
- API/arquivo da agenda de recebíveis;
- saldo, extrato e liquidações da conta Stone;
- autenticação, TTL, cache, paginação, intervalo de datas e rate limits;
- webhooks disponíveis e validação de assinatura;
- identificadores de venda, parcela, lote, transferência e terminal;
- campos de bruto, MDR, líquido, antecipação, cancelamento e chargeback;
- disponibilidade de Pix;
- arquivo vazio versus indisponível versus ainda não processado;
- política e tarifa da transferência Stone → Inter.

A documentação pública da Stone Banking exige cadastro, sandbox e homologação. O painel Nova Stone expõe agenda e descontos ao usuário, mas o spike deve comprovar quais desses dados são liberados à aplicação.

Referências externas:

- [Stone Banking API](https://docs.openbank.stone.com.br/docs/guias/stone-open-banking/)
- [Relatórios de vendas e recebimentos](https://ajuda.stone.com.br/recebimentos/como-acessar-os-relat%C3%B3rios-de-venda-e-recebimentos-na-nova-stone)
- [Connect 2.0 e integração do PDV com POS](https://ajuda.stone.com.br/connect-20/connect-20)

**Saída:** contrato de integração documentado e decisão API × importação assistida.

### Fase 1 — Spike com dados reais e anonimizados

Criar um script temporário/read-only para:

- buscar um dia conhecido do Tirirical;
- comparar Vendas, Recebimentos e extrato Stone;
- consultar uma data com cancelamento e outra com antecipação;
- salvar payload bruto apenas em `/tmp`, com permissão restrita;
- gerar relatório sem dados pessoais;
- gerar fixtures determinísticas anonimizadas;
- não escrever no Firestore nem executar movimentações.

Perguntas obrigatórias:

1. Vendas e recebíveis são APIs distintas?
2. Quais status de venda existem e quais contam como aprovados?
3. Qual identificador é estável em 100% das vendas?
4. NSU, autorização e terminal estão disponíveis?
5. O Pix aparece com granularidade de transação?
6. Bruto, MDR e líquido vêm separados?
7. Como parcelamento aparece na agenda?
8. Como antecipação e sua taxa aparecem?
9. Como cancelamento e chargeback são versionados?
10. Qual é o fuso da venda e da liquidação?
11. Existe identificador estável de lote/depósito?
12. A API fornece extrato da conta Stone e referências de transferência?
13. Qual referência aparece também no crédito do Inter?
14. Como distinguir dado vazio, indisponível, incompleto e erro de autenticação?

A taxa de antecipação será classificada como `EXPLICIT`, `DERIVABLE`, `COMPLEMENTARY_FILE` ou `NOT_AVAILABLE`. Nenhuma diferença residual será chamada automaticamente de taxa.

**Saída:** relatório do spike, schemas reais e go/no-go para ingestão.

### Fase 2 — Fundação contábil e correção da receita atual

- separar vendas, posição da gaveta, diferenças e recebimentos;
- retirar `finalizedDifferenceTotalCents` da Receita Bruta automática;
- preservar fechamento atual com migração compatível;
- adicionar contas/configurações para MDR, antecipação e perda de caixa;
- criar contrato para ajustes de resultado sem obrigação bancária;
- atualizar resumos de fechamento sem misturar sangria/suprimento com receita;
- deixar testes permanentes para essas invariantes.

**Saída:** DRE atual conceitualmente correta, ainda sem depender da Stone.

### Fase 3 — Ingestão normalizada e idempotente

- projetar pagamentos do PDV no banco financeiro;
- implementar autenticação e client Stone no servidor;
- persistir arquivo/payload antes do parse, quando aplicável;
- criar IDs determinísticos e checksum;
- usar retry com backoff e estado observável;
- armazenar eventos imutáveis e projeção atual;
- impedir duplicação em reprocessamento;
- não armazenar PAN, credenciais ou dados desnecessários de portador.

Preferência operacional:

1. webhook/delta, se disponível;
2. sincronização diária D-1;
3. overlap curto e cursor para revisões;
4. nunca reler coleções ou períodos completos em polling.

**Saída:** um dia do Tirirical confere com os painéis Stone e PDV.

### Fase 4 — Motor de conciliação de vendas

- implementar matching determinístico e sugestões;
- suportar pagamentos divididos;
- criar casos de divergência sem alterar origens;
- disponibilizar ações de confirmar, corrigir, classificar e ignorar com motivo;
- recalcular resumo diário/mensal na mesma transação da decisão, quando estiver no mesmo banco;
- marcar mês fechado como `stale` diante de revisão tardia.

**Saída:** dez dias consecutivos do Tirirical com todos os casos classificados e diferença monetária integralmente explicada.

### Fase 5 — Caixa, diferenças e cadeia de custódia

- introduzir classificação das diferenças de fechamento;
- modelar fundo/suprimento sem efeito de receita;
- transformar cada sangria em movimento de custódia;
- vincular sangrias a cofre, sessão, malote, depósito, transferência ou despesa;
- conciliar valor retirado, valor recebido no destino e valor depositado;
- lançar somente perdas confirmadas em despesa operacional;
- manter valores a receber do responsável fora da despesa até decisão própria.

**Saída:** todo dinheiro de um dia pode ser explicado entre gaveta, sangrias, numerário em trânsito, depósito e perdas classificadas.

### Fase 6 — Agenda, liquidação e conciliação bancária

- projetar recebíveis por parcela e data;
- mostrar bruto, taxas e líquido;
- importar liquidações/extrato Stone;
- conciliar recebível previsto com liquidação Stone;
- conciliar débito de transferência Stone com crédito Inter;
- criar sugestão por valor/data somente quando não houver referência forte;
- exigir confirmação humana para vínculo ambíguo;
- registrar tarifas e ajustes separadamente.

**Saída:** previsão de 13 semanas e realizado conferidos para o Tirirical antes da expansão.

### Fase 7 — Interface operacional

Criar `Financeiro > Conciliação de receitas` com abas:

1. `PDV × Stone Vendas`;
2. `Recebíveis previstos × realizados`;
3. `Caixa, sangrias e depósitos`;
4. `Fechamento mensal`;
5. `Execuções da integração` para administradores.

Filtros:

- competência/data;
- todas as unidades ou unidade específica;
- canal;
- status;
- tipo de divergência;
- terminal/Stonecode;
- somente itens pendentes.

KPIs:

- PDV eletrônico bruto;
- Stone Vendas bruto;
- diferença explicada e pendente;
- percentual conciliado;
- perdas de caixa;
- recebíveis futuros;
- líquido previsto e realizado;
- saldo Stone, Inter e consolidado;
- valor Stone aguardando transferência.

**Saída:** fluxo completo de revisão e fechamento sem depender de acesso direto ao portal Stone.

### Fase 8 — DRE e fluxo de caixa

Na DRE, adicionar `Critério da receita`:

- `PDV Legal`;
- `Receita conciliada`.

Regras da interface:

- PDV Legal será a base explícita, sem fallback silencioso por unidade;
- Receita conciliada parcial poderá ser visualizada com alerta e cobertura;
- o selo de fechada exige 100% dos casos decididos;
- comparação mostrará PDV, ajustes positivos, ajustes negativos, conciliado e diferença;
- exportação, gráficos e percentuais usarão o critério selecionado;
- taxas Stone e perdas de caixa aparecerão em linhas próprias da DRE.

No fluxo de caixa:

- agenda Stone alimenta entradas previstas;
- liquidação Stone alimenta realizado na conta Stone;
- transferência Stone → Inter move saldo entre contas;
- consolidado elimina transferências internas;
- atrasos, rejeições, chargebacks e mudanças de previsão permanecem visíveis.

**Saída:** DRE e fluxo de caixa fecham por unidade e no consolidado sem dupla contagem.

### Fase 9 — Backfill e rollout

- criar backfill separado, idempotente, paginado e com dry-run;
- iniciar em agosto de 2026;
- publicar relatório de contagens, totais e divergências antes de gravar;
- rodar em modo sombra, sem alterar a DRE oficial;
- validar Tirirical, depois João Paulo e Whopping;
- comparar diariamente com PDV, Vendas Stone, Recebimentos Stone e extrato;
- fechar cada unidade somente após revisão das exceções;
- liberar o consolidado depois das três unidades.

**Saída:** reconciliação histórica e corrente aprovada pelo Financeiro.

## 9. Permissões

Criar permissões específicas, sem ampliar implicitamente as permissões atuais de despesas:

```text
financial.salesReconciliation.view
financial.salesReconciliation.review
financial.salesReconciliation.classify
financial.salesReconciliation.close
financial.salesReconciliation.reopen
financial.stoneIntegration.manage
```

- `financial.dre` permite consultar os resumos usados pela DRE, mas não os detalhes sensíveis.
- Toda leitura e escrita precisa de autorização no servidor.
- Fechamento, reabertura, classificação contábil e gestão de integração são ações segregadas.
- Ocultar botões não substitui controle de acesso.

## 10. Auditoria e observabilidade

- Cada decisão registra anterior, novo, motivo, usuário e horário.
- Correção cria nova revisão; não apaga o evento anterior.
- Jobs recebem `runId`; chamadas recebem `requestId`; falhas inesperadas recebem `eventId`.
- Logs não expõem token, chave, payload financeiro bruto, PAN ou dados do portador.
- Falha externa persiste intenção/estado e pode ser retomada com idempotência.
- Um mês fechado alterado por fonte externa vira `stale` e exige reabertura explícita.

## 11. Firestore e custo

Preflight obrigatório antes de cada fase com queries novas.

Diretrizes:

- DRE: um `revenueMonthlySummary` por unidade/mês. Para seis meses e três unidades, 18 leituras de receita por carregamento.
- Tela de conciliação: consultas por `workspaceId + period + kioskId + status`, paginadas, inicialmente em até 100 casos.
- Jobs: cursor, data-fonte, checksum e overlap curto; nunca scan completo recorrente.
- Históricos fechados ficam fora das filas operacionais.
- Índices são criados somente para queries documentadas.
- Resumo mensal é atualizado por delta ou reconstrução limitada ao período; a DRE não agrega transações brutas.
- O spike deve medir transações/dia por unidade para estimar leituras, escritas, Storage e chamadas mensais antes do rollout.

## 12. Testes

### Unitários

- normalização de canais PDV/Stone;
- datas e fronteira do fuso;
- identidade/idempotência;
- matching 1:1, 1:N e N:1;
- ambiguidade sem auto-match;
- cancelamento, estorno e chargeback;
- bruto, MDR, antecipação e líquido;
- receita PDV × conciliada;
- diferença de caixa e classificação;
- sangria sem efeito na DRE;
- transferência Stone → Inter sem efeito consolidado;
- período fechado e revisão tardia.

### Contrato e integração

- schemas dos payloads/arquivos Stone;
- autenticação e sanitização de erros;
- rotas e permissões;
- transações de decisão + auditoria + resumo;
- Firestore Emulator com dados determinísticos;
- rerun do mesmo arquivo sem duplicação.

### E2E crítico

1. carregar PDV e Stone;
2. abrir divergência;
3. classificar e justificar;
4. fechar unidade/mês;
5. verificar Receita conciliada na DRE;
6. verificar recebível previsto no fluxo de caixa;
7. liquidar e verificar realizado;
8. reabrir após revisão tardia.

Mudanças comuns devem manter `npm run check` verde. Mudanças de rotas, fronteiras server/client ou build devem manter `npm run verify` verde. Regras do Firestore exigem `npm run check:rules`.

## 13. Critérios de aceite do produto

Para cada unidade e competência:

- todo Pix/débito/crédito do PDV está conciliado ou possui decisão explícita;
- toda venda Stone está conciliada ou possui decisão explícita;
- a diferença total PDV × Stone é integralmente explicada;
- toda diferença de caixa está pendente de forma visível ou classificada;
- toda sangria possui destino e cadeia de custódia;
- perdas de caixa aparecem em despesas operacionais, não na Receita Bruta;
- taxas Stone não ficam escondidas no líquido recebido;
- recebíveis previstos fecham com a agenda Stone;
- liquidações realizadas fecham com o extrato Stone;
- transferências Stone → Inter não duplicam entrada no consolidado;
- DRE permite alternar PDV Legal e Receita conciliada;
- fluxo de caixa diferencia previsto e realizado;
- mês fechado não muda sem reabertura auditada;
- o consolidado só fecha quando Whopping, Tirirical e João Paulo fecharem.

## 14. Sequência de entregas e dependências

1. Acesso/spike Stone.
2. Correção do contrato atual de receita e diferenças de caixa.
3. Projeção dos pagamentos PDV e ingestão Stone.
4. Conciliação PDV × Stone Vendas.
5. Caixa, sangrias e cadeia de custódia.
6. Agenda de recebíveis e conciliação bancária.
7. Interface operacional.
8. Seletor de receita na DRE e integração com fluxo de caixa.
9. Backfill e rollout por unidade.

O seletor de CMV já foi implementado em `feat/dre-cmv-source` (`39d21bf5`). Como o seletor de receita também altera a DRE, sua implementação deverá partir da versão em que esse trabalho já estiver integrado, evitando duas edições concorrentes da mesma página.

## 15. Fora do escopo inicial

- executar pagamentos a terceiros pela conta Stone;
- corrigir automaticamente documentos fiscais no PDV;
- antecipar recebíveis automaticamente;
- transferir Stone → Inter sem regra e autorização operacional definidas;
- aceitar diferença não explicada como taxa;
- considerar um mês conciliado por simples igualdade de totais agregados;
- substituir dados originais do PDV ou Stone por ajustes manuais.
