# Procedimento do DAS: provisão, emissão, conciliação e pagamento

## Objetivo

Manter uma única obrigação financeira por DAS e, ao mesmo tempo, apropriar sua composição tributária corretamente na DRE. O processo separa três fatos:

1. previsão contábil mensal;
2. emissão da guia com o valor real;
3. liquidação bancária.

Uma previsão não é uma autorização de pagamento. Ela existe para antecipar a competência na DRE e será substituída pela guia real.

## Estrutura do plano de contas

O título financeiro usa a conta-mãe `2.1 DAS`. As apropriações usam exclusivamente as subcontas abaixo:

| Subconta | Posição na DRE |
|---|---|
| ICMS do DAS | Impostos e deduções |
| Cofins do DAS | Impostos e deduções |
| PIS/Pasep do DAS | Impostos e deduções |
| CPP do DAS | Pessoal |
| IRPJ do DAS | IR / CSLL |
| CSLL do DAS | IR / CSLL |

As contas gerais de IRPJ, CSLL e INSS patronal continuam disponíveis para obrigações que não façam parte do Simples Nacional. Isso evita misturar fatos de origens diferentes.

## DAS real de julho de 2026

- Empresa: CT SORVETES LTDA
- CNPJ: 14.276.603/0001-25
- Competência: 07/2026
- Vencimento e agendamento: 20/08/2026
- Documento: 07.20.26225.9872024-0
- Valor: R$ 3.921,78
- Linha digitável: 858100000390217803282629320720262252987202400215

| Componente | Valor real |
|---|---:|
| IRPJ | R$ 215,70 |
| CSLL | R$ 137,26 |
| Cofins | R$ 499,64 |
| PIS/Pasep | R$ 108,24 |
| CPP/INSS | R$ 1.647,15 |
| ICMS | R$ 1.313,79 |
| **Total** | **R$ 3.921,78** |

O contas a pagar contém apenas um título. Os seis componentes não geram seis pagamentos.

## Provisões dos próximos 12 meses

O primeiro orçamento usa o último DAS real, R$ 3.921,78, como estimativa mensal. A composição tributária inicial também é herdada do DAS de 07/2026. Esse método é simples, rastreável e deverá ser revisto quando houver mudança material de faturamento ou alíquota efetiva.

| Competência | Vencimento estimado | Valor provisionado |
|---|---:|---:|
| 08/2026 | 21/09/2026 | R$ 3.921,78 |
| 09/2026 | 20/10/2026 | R$ 3.921,78 |
| 10/2026 | 23/11/2026 | R$ 3.921,78 |
| 11/2026 | 21/12/2026 | R$ 3.921,78 |
| 12/2026 | 20/01/2027 | R$ 3.921,78 |
| 01/2027 | 22/02/2027 | R$ 3.921,78 |
| 02/2027 | 22/03/2027 | R$ 3.921,78 |
| 03/2027 | 20/04/2027 | R$ 3.921,78 |
| 04/2027 | 20/05/2027 | R$ 3.921,78 |
| 05/2027 | 21/06/2027 | R$ 3.921,78 |
| 06/2027 | 20/07/2027 | R$ 3.921,78 |
| 07/2027 | 20/08/2027 | R$ 3.921,78 |

As datas são estimativas para planejamento. A guia emitida é a fonte definitiva de vencimento. A regra geral é o dia 20 do mês seguinte; sem expediente bancário, o prazo vai para o primeiro dia útil posterior, conforme o [Perguntão do Simples Nacional](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/PerguntaoSN.pdf) e o [art. 40 da Resolução CGSN nº 140/2018](https://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278&naoPublicado=&visao=original).

## Fluxo mensal

### 1. Antes da emissão

A despesa fica com status `Provisionado`, vinculada à série `das-simples-nacional` e à competência correspondente. Ela entra na DRE por competência, mas não aparece como título pagável.

### 2. Quando o DAS for emitido

Conferir no PDF:

- CNPJ e razão social;
- competência;
- vencimento;
- número do documento;
- valor total;
- seis componentes;
- fechamento da soma;
- linha digitável e valor nela embutido.

Registrar uma despesa real na conta-mãe `DAS`, ativar o desmembramento e informar os componentes da guia.

### 3. Conciliação automática

O sistema consulta a previsão por `série + competência`. O valor não é usado como chave de identificação.

- uma previsão encontrada: substituição automática e cálculo da diferença;
- nenhuma previsão: a guia pode ser registrada, mas a ausência fica sinalizada;
- mais de uma previsão: conciliação e pagamento são bloqueados para revisão;
- previsão já conciliada: a consulta mostra o vínculo e a diferença preservada.

Diferença de conciliação:

`valor real - valor provisionado`

- diferença positiva: complemento de despesa;
- diferença negativa: reversão do excesso provisionado;
- diferença zero: previsão integralmente confirmada.

A previsão conciliada recebe status `Previsão conciliada` e deixa de compor a DRE. A guia real assume integralmente a competência, evitando dupla contagem.

### 4. Antes da baixa

Ao abrir **Registrar pagamento**, o sistema executa novamente a consulta da provisão do DAS e mostra:

- competência;
- valor previsto;
- valor real;
- diferença;
- situação da conciliação.

Ambiguidade bloqueia a baixa. Uma previsão única ainda não conciliada é substituída automaticamente por usuário com permissão de edição. A ausência de previsão não bloqueia, mas permanece registrada como alerta.

### 5. Banco e liquidação

O agendamento bancário não marca a despesa como paga. A baixa ocorre somente depois da confirmação bancária ou da conciliação do débito no extrato.

Antes de enviar ao Banco Inter, o fluxo deve:

1. validar todos os dígitos verificadores;
2. comparar o valor embutido na linha com R$ 3.921,78;
3. comparar vencimento e data de agendamento;
4. consultar pagamentos ativos de mesma data e valor;
5. interromper em caso de duplicidade ou falha da consulta.

## Controles e riscos

- Nunca criar um pagamento para cada componente tributário.
- Nunca pagar uma previsão.
- O assistente nunca autoriza ou confirma o pagamento. A autorização final é feita exclusivamente pelo usuário, diretamente no aplicativo do Banco Inter.
- Nunca manter previsão e guia real ativas simultaneamente na mesma competência.
- Não usar somente valor e data para conciliar provisão; a chave obrigatória é série e competência.
- Não sobrescrever uma divergência existente. Revisar e preservar a trilha de auditoria.
- Atualizar a estimativa-base quando o último DAS deixar de representar a operação.
- Manter as contas gerais de IRPJ, CSLL e INSS separadas das subcontas do DAS.

## Evidências mínimas por competência

- PDF da guia;
- número do documento;
- linha digitável validada;
- composição tributária;
- provisão conciliada ou justificativa de ausência;
- código da transação/agendamento bancário;
- comprovante ou débito conciliado no extrato.
