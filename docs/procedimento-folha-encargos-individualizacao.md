# Procedimento de folha: recibos, encargos e individualização

## Objetivo

Permitir que o Financeiro registre um único título para cada pagamento sem perder a análise mensal por colaborador. Recibos, guias e recolhimentos vinculados à folha devem conservar a ligação com o cadastro do colaborador, com a competência e com o documento de origem no RH.

O título financeiro representa o que será pago. A individualização representa de quem é o custo, o desconto ou a obrigação. Individualizar não cria vários pagamentos e não transforma o colaborador no favorecido bancário de uma guia governamental.

## Regra obrigatória

Sempre que um documento de folha trouxer valores atribuíveis a pessoas, o registro deverá conter:

- competência da folha;
- colaborador identificado por `employeeId` e nome;
- recibo de pagamento ou evento de folha relacionado, quando disponível;
- conta contábil da rubrica;
- natureza analítica: `Custo do empregador`, `Desconto do colaborador` ou `Informativo`;
- valor individual;
- centro de resultado de apropriação;
- contrato ou referência, quando existir;
- documento-fonte que sustenta o valor.

A soma das linhas individuais deverá fechar por conta contábil e também com o valor total do título. Divergência bloqueia a conclusão da auditoria.

## Relação entre Financeiro e RH

O colaborador vem do cadastro canônico do RH. O Financeiro não cria uma cópia da pessoa para individualizar a despesa.

Cada linha individual deve apontar, quando disponível, para:

```ts
type PayrollSourceReference = {
  employeeId: string;
  payrollDocumentId?: string;
  competence: string;
};
```

Com esse vínculo, o resumo mensal do colaborador poderá reunir salário, verbas, encargos patronais, retenções e empréstimos sem inferência por nome ou por valor.

## Recibo de pagamento

O recibo salarial gera um título financeiro para o valor líquido devido ao colaborador. Nesse título, o favorecido é o próprio colaborador.

As rubricas do contracheque ficam registradas como detalhamento de folha e vinculadas ao mesmo recibo. Proventos, descontos e bases não devem virar pagamentos bancários independentes. Rubricas meramente informativas ou bases de cálculo não entram na DRE como nova despesa.

O centro de resultado segue a alocação definida para o colaborador na competência. Exceções de rateio devem ser gravadas nas linhas individuais, e não alterando artificialmente o favorecido.

## FGTS

O FGTS mensal é custo do empregador e deve ser individualizado por colaborador, mesmo quando a arrecadação ocorre em uma única guia.

- título: um por guia;
- favorecido bancário: entidade arrecadadora indicada na guia;
- conta contábil: `FGTS`;
- natureza analítica: `Custo do empregador`;
- vínculo: colaborador + recibo/evento da competência;
- DRE: `Pessoal`, no centro de resultado de cada colaborador;
- pagamento: único, pelo total da guia.

Se a guia contiver FGTS e outra obrigação, o título permanece único e é desmembrado por conta. Depois, cada componente é individualizado por colaborador.

Padrão do título:

- com consignado: `FGTS - MM/AAAA | FGTS + empréstimo consignado`;
- sem consignado: `FGTS - MM/AAAA | FGTS`.

O mês mostrado na descrição é o mês operacional do pagamento. A competência original da folha permanece gravada no campo `competenceDate` e nos vínculos analíticos, evitando perda da referência contábil.

## INSS relacionado à folha

Antes de lançar INSS, separar sua natureza:

### INSS patronal

É custo do empregador.

- conta contábil: `INSS patronal`, fora das subcontas do DAS;
- natureza analítica: `Custo do empregador`;
- DRE: `Pessoal`;
- individualização: por colaborador e centro de resultado;
- vínculo: recibo/evento da competência.

O componente previdenciário recolhido dentro do DAS continua no procedimento próprio do DAS e não deve ser duplicado como INSS patronal da folha.

### INSS descontado do colaborador

É retenção da remuneração e obrigação a recolher, não um novo custo da empresa.

- conta contábil: passivo `INSS descontado a recolher`;
- natureza analítica: `Desconto do colaborador`;
- DRE: não compõe nova despesa;
- individualização: por colaborador e recibo;
- pagamento: integra a guia correspondente, sem gerar nova despesa de pessoal.

Uma mesma guia previdenciária pode conter parte patronal e retenções. Nesse caso, usar um título, desmembrar pelas contas corretas e individualizar cada conta por colaborador.

## Empréstimo consignado

O consignado descontado em folha pertence ao colaborador para fins analíticos, mas não é custo adicional da empresa.

- conta contábil: passivo `Empréstimos consignados a recolher`;
- natureza analítica: `Desconto do colaborador`;
- individualização: colaborador + contrato/instituição + recibo;
- DRE: não compõe despesa;
- favorecido do título: entidade arrecadadora ou credor efetivamente pago;
- pagamento: um por guia, quando a arrecadação for unificada.

Quando houver mais de um contrato para a mesma pessoa, cada contrato deverá ocupar uma linha própria. Isso permite analisar quanto o colaborador está pagando em cada empréstimo.

Quando o consignado vier na mesma guia do FGTS Digital, não criar um segundo título. Usar o título consolidado do FGTS e registrar as linhas de consignado na conta patrimonial `Empréstimos consignados a recolher`.

## Centro de resultado

O centro de resultado é definido em cada linha individual. Essa alocação prevalece sobre um rateio global do título para fins de DRE e análise por unidade.

Para a configuração definida atualmente:

- Aliny Rodrigues: Quiosque Shopping do Automóvel;
- Heucilene Oliveira: cadastro financeiro no Centro administrativo, mas despesas rateadas igualmente entre todos os quiosques;
- Samila: Quiosque João Paulo;
- Carliane e Maria Edna: Quiosque Tirirical;
- Maria José: somente registro de rescisão, apropriado ao Centro administrativo, sem recibo salarial mensal.

O rateio de Heucilene deverá gerar uma linha por quiosque para cada conta individualizada, preservando o mesmo `employeeId` e fechando exatamente o valor da rubrica.

## Etapas no sistema

### Lançamento de despesa

1. `Identificação`: documento, favorecido do pagamento, competência, vencimento e valor total.
2. `Classificação`: conta única ou desmembramento entre contas.
3. `Individualização`: colaborador, recibo/evento, natureza, valor, centro de resultado e contrato.
4. `Vencimento e parcelas`: condição do título, sem alterar a apropriação individual.
5. `Revisão`: conferência dos fechamentos e dos vínculos antes de salvar.

### Auditoria de despesa importada

A seção `Individualizar por colaborador ou contrato` aparece antes da confirmação da auditoria. O auditor deve conferir:

- se todas as pessoas da memória de cálculo estão presentes;
- se as contas das linhas correspondem ao desmembramento;
- se os vínculos com RH e competência estão corretos;
- se contratos de consignado estão separados;
- se os centros de resultado estão corretos;
- se a soma por conta e a soma total fecham.

Documento sem memória suficiente pode ser mantido pendente, mas não deve ser aprovado com uma individualização inventada. O documento complementar deve ser anexado e usado como fonte da conciliação.

## Consultas e relatórios esperados

O resumo mensal de cada colaborador deverá mostrar, sem dupla contagem:

- remuneração e demais proventos;
- descontos do recibo;
- valor líquido pago;
- FGTS patronal;
- INSS patronal, quando aplicável fora do DAS;
- INSS retido;
- consignados por contrato;
- custo total do empregador;
- unidade ou rateio usado na competência;
- links para recibos, guias e demais documentos-fonte.

`Custo total do empregador` soma apenas remuneração e encargos patronais. INSS retido, consignados e outros descontos do colaborador aparecem na análise, mas não aumentam esse custo.

## Controles

- Um título financeiro pode ter várias pessoas e contratos, mas continua tendo um único favorecido bancário.
- Nunca usar o colaborador como favorecido de FGTS, INSS ou guia unificada apenas porque o valor foi individualizado para ele.
- Não duplicar na DRE descontos já abatidos do salário bruto.
- Não misturar CPP do DAS com INSS patronal fora do DAS.
- Não aprovar valores individuais que não fechem com a conta e com o documento.
- Alterações posteriores preservam o histórico da individualização auditada.
- O assistente não autoriza nem confirma pagamentos. A autorização final só pode ser feita pelo usuário, diretamente no aplicativo bancário, quando ele solicitar o envio.

## Evidências mínimas

- recibo de pagamento ou evento de folha da competência;
- guia de arrecadação;
- memória de cálculo por trabalhador;
- competência e vencimento;
- conta contábil e natureza analítica;
- centro de resultado individual;
- contrato/instituição, para consignado;
- conciliação entre linhas, contas e total do título.
