# Plano de provisões financeiras - rascunho para validação

Status: **provisões de colaboradores aplicadas** para 08/2026 a 07/2027 e **10 séries recorrentes aplicadas** para 09/2026 a 08/2027. Séries sem valor, favorecido ou vencimento seguro continuam pendentes de validação.

Data-base da análise: 18/08/2026.

## Regra geral

- Cada ocorrência deve ter `provisionType: forecast`, competência própria e vínculo estável de série.
- A previsão usa a mesma descrição canônica do documento real, sem prefixo. O sistema a diferencia internamente por `provisionType: forecast`, série, competência e estado de conciliação.
- Quando chegar o boleto, guia, nota ou recibo real, o sistema deve conciliar pela série + competência + favorecido + unidade.
- O real substitui o valor previsto para relatórios, preservando diferença, documento-fonte e histórico; nunca devem permanecer duas despesas na DRE para a mesma competência.
- A previsão não agenda, autoriza ou confirma pagamentos bancários.

## Séries já existentes

| Série | Situação | Base | Período |
| --- | --- | ---: | --- |
| DAS | 12 previsões ativas | R$ 3.921,78/mês | competência 08/2026 a 07/2027 |
| Compra do carrinho - Shopping do Automóvel | cronograma contratual, não previsão estimada | R$ 1.200,00/mês | 20 parcelas abertas, até 04/2028 |

O DAS real de julho, com pagamento em agosto, está registrado separadamente como `DAS - Única - 08/2026`. DARE não terá provisão.

## Folha, FGTS, INSS e consignados

### Base da folha de julho

| Colaborador | Custo bruto reconhecido | Líquido do recibo | FGTS | INSS retido | Consignado efetivo | Centro |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Aliny Rodrigues da Silva Costa | R$ 1.268,60 | R$ 1.066,22 | R$ 101,48 | R$ 95,14 | R$ 0,00 | Shopping do Automóvel |
| Carliane Sousa Ramos | R$ 2.251,88 | R$ 1.614,33 | R$ 180,15 | R$ 178,34 | R$ 459,21 | Tirirical |
| Heucilene Oliveira Ribeiro | R$ 3.070,35 | R$ 1.958,98 | R$ 245,62 | R$ 257,03 | R$ 747,10 | rateio igual entre os três quiosques |
| Maria Edna Gois Ribeiro | R$ 2.524,76 | R$ 832,90 | R$ 201,98 | R$ 202,90 | R$ 586,87 | Tirirical |
| Maria Joana Barbosa Pereira | R$ 1.966,24 | R$ 1.313,98 | R$ 157,29 | R$ 152,64 | R$ 499,62 | João Paulo |
| Samila Valesca Cardoso | R$ 1.968,56 | R$ 1.776,01 | R$ 157,48 | R$ 152,85 | R$ 0,00 | João Paulo |
| Sara Ferreira Coelho | R$ 1.383,72 | R$ 1.172,71 | R$ 110,69 | R$ 103,77 | R$ 0,00 | Shopping do Automóvel |
| **Total** | **R$ 14.434,11** | **R$ 9.735,13** | **R$ 1.154,69** | **R$ 1.142,67** | **R$ 2.292,80** | — |

Maria José não entra na série mensal de salários. Seu registro permanece somente como rescisão no Administrativo.

### Normalização para mês completo

A folha de julho não pode ser repetida literalmente: Aliny e Sara tiveram mês parcial; Maria Edna teve férias; Maria Joana teve afastamento com direitos integrais; horas extras, reflexos e adicional noturno são variáveis. A base mensal integral identificada nos recibos é R$ 1.787,30 por colaborador.

Foram considerados fixos em ambos os cenários:

- salário mensal integral de R$ 1.787,30;
- gratificação de função de 37% da Heucilene, R$ 661,30;
- parcelas de consignado existentes, como previsão patrimonial conciliável;
- vale-transporte conforme os descontos atuais;
- salário-família da Samila, condicionado à manutenção do direito na folha real.

Foram excluídos da base fixa: horas extras, reflexos de DSR, adicional noturno, férias, um terço de férias, médias de férias, adiantamento de férias e estornos de provisão.

As rubricas genéricas `Gratificações` somam R$ 1.090,02 e dependem de confirmação:

| Colaborador | Gratificação genérica observada |
| --- | ---: |
| Carliane | R$ 346,10 |
| Heucilene | R$ 272,50 |
| Maria Edna | R$ 346,10 |
| Maria Joana | R$ 62,66 |
| Samila | R$ 62,66 |

#### Cenário aprovado: somente salário-base e gratificação de função

| Colaborador | Bruto previsto | FGTS estimado | INSS estimado | Consignado | Líquido estimado | Centro |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Aliny | R$ 1.787,30 | R$ 142,98 | R$ 136,53 | R$ 0,00 | R$ 1.543,53 | Shopping do Automóvel |
| Carliane | R$ 1.787,30 | R$ 142,98 | R$ 136,53 | R$ 459,21 | R$ 1.191,56 | Tirirical |
| Heucilene | R$ 2.448,60 | R$ 195,88 | R$ 196,05 | R$ 747,10 | R$ 1.398,21 | rateio igual entre os três quiosques |
| Maria Edna | R$ 1.787,30 | R$ 142,98 | R$ 136,53 | R$ 586,87 | R$ 1.063,90 | Tirirical |
| Maria Joana | R$ 1.787,30 | R$ 142,98 | R$ 136,53 | R$ 499,62 | R$ 1.151,15 | João Paulo |
| Samila | R$ 1.787,30 | R$ 142,98 | R$ 136,53 | R$ 0,00 | R$ 1.611,07 | João Paulo |
| Sara | R$ 1.787,30 | R$ 142,98 | R$ 136,53 | R$ 0,00 | R$ 1.543,53 | Shopping do Automóvel |
| **Total** | **R$ 13.172,40** | **R$ 1.053,76** | **R$ 1.015,23** | **R$ 2.292,80** | **R$ 9.502,95** | — |

O líquido já considera os descontos atuais de vale-transporte e, para Samila, o crédito de salário-família de R$ 67,54. O INSS foi estimado pela tabela progressiva oficial válida desde a competência janeiro de 2026.

#### Comparação dos cenários

| Cenário | Folha bruta | FGTS | INSS líquido após salário-família | FGTS + consignados | Custo de pessoal na DRE |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Somente salário + função da Heucilene — aprovado** | **R$ 13.172,40** | **R$ 1.053,76** | **R$ 947,69** | **R$ 3.346,56** | **R$ 14.226,16** |
| Com gratificações genéricas — não adotado | R$ 14.262,42 | R$ 1.140,96 | R$ 1.045,79 | R$ 3.433,76 | R$ 15.403,38 |

Por decisão do usuário, as gratificações genéricas não integram a previsão. A chegada de cada contracheque ajustará a previsão pelas rubricas reais.

### Séries propostas

1. **Salários**: 84 previsões criadas, uma por colaborador e competência, mantendo favorecido, rubricas e centro. Base mensal de R$ 13.172,40, sem férias, horas extras, adicionais e gratificações genéricas.
2. **FGTS + consignado**: 12 previsões consolidadas. Base mensal de R$ 3.346,56, desmembrada em R$ 1.053,76 de FGTS e R$ 2.292,80 de consignados. O consignado continua patrimonial e fora da DRE.
3. **INSS da folha**: 12 previsões patrimoniais de R$ 947,69, compostas por R$ 1.015,23 de INSS retido e crédito de salário-família de R$ 67,54. O detalhamento preserva o INSS bruto da Samila e mostra a compensação explicitamente.

Para julho, a guia de INSS real foi R$ 1.185,16 porque também continha R$ 110,03 da rescisão de Maria José. Esse componente não deve ser repetido na previsão mensal seguinte.

O custo recorrente de pessoal normalizado na DRE é R$ 14.226,16: R$ 13.172,40 de folha bruta + R$ 1.053,76 de FGTS. INSS retido e consignados não aumentam o custo do empregador; a CPP continua dentro do DAS.

## Demais recorrências propostas

As dez séries confirmadas abaixo foram criadas com `provisionType: forecast`, sem prefixo visível e sem qualquer agendamento bancário. O valor mensal total dessas séries é **R$ 5.669,75**.

| Série | Valor-base mensal | Unidade / divisão | Vencimento-base | Situação para validação |
| --- | ---: | --- | --- | --- |
| Internet - Tirirical \| TVN | R$ 101,32 | Tirirical | dia 10 | provisionado de 09/2026 a 08/2027 |
| Internet - João Paulo \| TVN | R$ 101,32 | João Paulo | dia 10 | provisionado de 09/2026 a 08/2027 |
| Internet - Administrativo \| TVN | R$ 102,93 | Administrativo | dia 20 | provisionado de 09/2026 a 08/2027 |
| Internet - Shopping do Automóvel \| TVN | a definir | Shopping do Automóvel | a definir | aguardar primeiro boleto; não estimar pela igualdade dos demais |
| Honorário contábil - Administrativo \| Maximus | R$ 536,64 | Administrativo | dia 17 como referência | provisionado de 09/2026 a 08/2027; no extrato atual os três débitos idênticos continuam sem identificador individual |
| Honorário contábil - Tirirical \| Maximus | R$ 536,64 | Tirirical | dia 17 como referência | provisionado de 09/2026 a 08/2027; no extrato atual os três débitos idênticos continuam sem identificador individual |
| Honorário contábil - João Paulo \| Maximus | R$ 536,64 | João Paulo | dia 17 como referência | provisionado de 09/2026 a 08/2027; no extrato atual os três débitos idênticos continuam sem identificador individual |
| Honorário contábil - Shopping do Automóvel \| Maximus | R$ 536,64 propostos | Shopping do Automóvel | a definir | confirmar se o novo honorário terá o mesmo valor |
| Aluguel - Tirirical \| Mateus Supermercados | R$ 1.479,33 | Tirirical | dia 11 como referência | provisionado de 09/2026 a 08/2027 |
| Aluguel - João Paulo \| Mateus Supermercados | R$ 1.479,33 | João Paulo | dia 11 como referência | provisionado de 09/2026 a 08/2027 |
| Aluguel - Shopping do Automóvel \| Favorecido | R$ 3.500,00 | Shopping do Automóvel | a definir | título único: R$ 3.000,00 aluguel + R$ 500,00 condomínio em contas separadas |
| Sistema RH - Bizneo | R$ 285,60 | Administrativo | dia 25 | provisionado de 09/2026 a 08/2027 |
| Plano odontológico - Odontoprev \| Heucilene | a recuperar | rateio igual entre João Paulo, Tirirical e Shopping do Automóvel | débito automático | localizar o último débito validado antes de criar a série |
| Consultoria de RH \| Isabela Dominici | a confirmar | Administrativo | a confirmar | o Pix de R$ 26,06 não é evidência suficiente do honorário mensal |
| GPT/Codex \| Tiago Brasil | R$ 510,00 | Administrativo | dia 10 como referência | provisionado de 09/2026 a 08/2027 |

## Itens sem provisão

- DARE, pois depende das compras de estoque;
- Sonic, por ser frete variável;
- transportadora de insumos tratada fora da DRE;
- compras e insumos variáveis;
- rescisão de Maria José;
- parcelas do carrinho, porque já existe cronograma contratual real.

## Decisões pendentes

1. Confirmar o valor e o favorecido do plano Odontoprev.
2. Confirmar o valor do honorário contábil do Shopping.
3. Informar primeiro valor e vencimento da internet do Shopping.
4. Confirmar vencimento e favorecido do aluguel do Shopping.
5. Confirmar o honorário mensal da Isabela; o Pix de R$ 26,06 não será usado automaticamente como base.
