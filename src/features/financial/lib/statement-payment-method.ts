export type StatementPaymentMethodOption<TType extends string = string> = {
  id: string;
  type: TType;
  label: string;
};

export const STATEMENT_PAYMENT_METHOD_IDS = {
  bankDebit: "inter-bank-debit",
  automaticDebit: "inter-automatic-debit",
  boleto: "inter-boleto",
  bankTransfer: "inter-bank-transfer",
  cardStatementSettlement: "inter-card-statement-settlement",
} as const;

export function normalizeStatementText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR");
}

export function isCardStatementSettlementText(value: string) {
  const text = normalizeStatementText(value);
  return /PAGAMENTO(?:\s+DE)?\s+FATURA|LIQUIDACAO(?:\s+DE)?\s+FATURA/.test(text);
}

export function isBoletoPaymentText(value: string) {
  const text = normalizeStatementText(value);
  return /BOLETO|COD(?:IGO)?\s*(?:DE\s*)?BARRA(?:S|\s*LINHA\s*DIGITAVEL)?|LINHA\s*DIGITAVEL|PAGAMENTO\s+DE\s+TITULO|CONVENIO|ARRECADACAO/.test(text);
}

function findByIdentity<TMethod extends StatementPaymentMethodOption>(
  methods: TMethod[],
  id: string,
  labelPattern: RegExp,
) {
  return methods.find((method) => method.id === id) ??
    methods.find((method) => labelPattern.test(normalizeStatementText(method.label)));
}

export function inferStatementPaymentMethodFromText<TMethod extends StatementPaymentMethodOption>(
  value: string,
  methods: TMethod[],
) {
  const text = normalizeStatementText(value);

  if (isCardStatementSettlementText(text)) {
    return findByIdentity(
      methods,
      STATEMENT_PAYMENT_METHOD_IDS.cardStatementSettlement,
      /LIQUIDACAO.*FATURA|PAGAMENTO.*FATURA/,
    ) ?? null;
  }
  if (text.includes("PIX")) {
    return methods.find((method) => method.type === "pix") ?? null;
  }
  if (/DEBITO\s+AUTOMATICO|DEB\.\s*AUTOMATICO/.test(text)) {
    return findByIdentity(
      methods,
      STATEMENT_PAYMENT_METHOD_IDS.automaticDebit,
      /DEBITO\s+AUTOMATICO/,
    ) ?? null;
  }
  if (isBoletoPaymentText(text)) {
    return findByIdentity(methods, STATEMENT_PAYMENT_METHOD_IDS.boleto, /BOLETO|CODIGO\s+DE\s+BARRAS/) ?? null;
  }
  if (/CARTAO.*DEBITO/.test(text)) {
    return methods.find((method) => method.type === "debit_card") ?? null;
  }
  if (/CARTAO.*CREDITO/.test(text)) {
    return methods.find((method) => method.type === "credit_card") ?? null;
  }
  if (/TRANSFERENCIA|\bTED\b|\bDOC\b/.test(text)) {
    return findByIdentity(
      methods,
      STATEMENT_PAYMENT_METHOD_IDS.bankTransfer,
      /TRANSFERENCIA\s+BANCARIA/,
    ) ?? methods.find((method) => method.type === "transfer") ?? null;
  }
  if (/SAQUE|DINHEIRO/.test(text)) {
    return methods.find((method) => method.type === "cash") ?? null;
  }
  if (/PAGAMENTO|DEBITO|SAIDA/.test(text)) {
    return findByIdentity(methods, STATEMENT_PAYMENT_METHOD_IDS.bankDebit, /DEBITO\s+EM\s+CONTA/) ?? null;
  }

  return null;
}
