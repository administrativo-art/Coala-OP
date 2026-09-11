# Contrato contábil das despesas financeiras

## Três datas, três finalidades

- `competenceMonth`: mês contábil (`AAAA-MM`) usado exclusivamente para selecionar a despesa na DRE.
- `dueDate`: vencimento usado no contas a pagar e nas projeções de caixa.
- `paidAt`: evento de liquidação usado no realizado de caixa e na conciliação bancária.

Alterar ou registrar o pagamento não desloca a competência. Uma despesa sem competência válida não entra na DRE, ainda que já tenha vencimento ou pagamento.

## Participação na DRE

Entram por competência os títulos com status `pending`, `partially_paid`, `paid` e `provisioned`. Ficam fora `draft`, `cancelled` e `reconciled`; neste último caso, a previsão foi substituída pelo título real.

A linha é definida pela conta folha em `accountPlan`/`accountId` e pelos campos `is_dre_account` e `dre_position` dessa conta. Contas patrimoniais não entram. Apropriações por conta, colaborador e centro de resultado precisam fechar o valor total; uma divergência é exibida como pendência de integridade e bloqueia a exportação.

## Adiantamento salarial

O adiantamento usa a conta `adiantamento-salarial-v1` e a competência da folha em que será descontado. O título posterior do salário deve registrar o saldo líquido já reduzido. Assim, a DRE soma adiantamento e saldo líquido uma única vez na linha `Pessoal`, enquanto cada saída aparece no caixa em sua data real de pagamento.

## Compatibilidade e versão

`accountingContractVersion: 1` identifica o contrato. Os gravadores persistem essa versão e `competenceMonth`; registros legados são migrados a partir de `provisionCompetence` ou `competenceDate`, interpretada como período UTC para que o primeiro dia do mês não recue no fuso de Belém.
