import assert from "node:assert/strict";
import test from "node:test";

import { findUniqueExactExpenseMatch } from "../../src/features/financial/lib/inter-statement-reconciliation";
import {
  inferStatementPaymentMethodFromText,
  isBoletoPaymentText,
  isCardStatementSettlementText,
  STATEMENT_PAYMENT_METHOD_IDS,
} from "../../src/features/financial/lib/statement-payment-method";
import {
  interStatementSessionDocumentId,
  interStatementTransactionDocumentId,
  normalizeInterStatementEntries,
} from "../../src/lib/integrations/inter/statements.server";

test("normaliza débitos e créditos do extrato do Inter", () => {
  const [debit, credit] = normalizeInterStatementEntries([
    {
      idTransacao: "tx-debit",
      dataEntrada: "2026-08-15",
      tipoOperacao: "D",
      valor: "1.200,00",
      titulo: "Pix enviado",
      descricao: "Fornecedor Exemplo",
    },
    {
      idTransacao: "tx-credit",
      dataEntrada: "2026-08-15",
      tipoOperacao: "C",
      valor: "250.50",
      descricao: "Pix recebido",
    },
  ]);

  assert.equal(debit.amount, -1200);
  assert.equal(debit.description, "Pix enviado — Fornecedor Exemplo");
  assert.equal(credit.amount, 250.5);
});

test("gera chaves idempotentes e distingue ocorrências bancárias idênticas sem identificador", () => {
  const raw = {
    dataEntrada: "2026-08-15",
    tipoOperacao: "D",
    valor: "54.55",
    descricao: "Tarifa",
  };
  const firstRun = normalizeInterStatementEntries([raw, raw]);
  const secondRun = normalizeInterStatementEntries([raw, raw]);

  assert.notEqual(firstRun[0].externalId, firstRun[1].externalId);
  assert.deepEqual(firstRun.map((entry) => entry.externalId), secondRun.map((entry) => entry.externalId));
  assert.equal(
    interStatementTransactionDocumentId("conta-inter", firstRun[0].externalId),
    interStatementTransactionDocumentId("conta-inter", secondRun[0].externalId)
  );
  assert.equal(
    interStatementSessionDocumentId("conta-inter", "2026-08"),
    interStatementSessionDocumentId("conta-inter", "2026-08")
  );
});

test("preserva os detalhes completos e referências internas do pagamento retornado pelo Inter", () => {
  const [payment] = normalizeInterStatementEntries([
    {
      idTransacao: "tx-boleto",
      dataTransacao: "2026-08-15",
      tipoOperacao: "D",
      tipoTransacao: "PAGAMENTO_BOLETO",
      valor: "101,32",
      titulo: "Pagamento efetuado",
      descricao: "Fornecedor Exemplo",
      numeroDocumento: "doc-123",
      detalhes: {
        codBarraLinhaDigitavel: "12345678901234567890123456789012345678901234",
        codigoAutenticacao: "auth-456",
        nomeBeneficiario: "Fornecedor Exemplo",
      },
    },
  ]);

  assert.equal(
    (payment.raw.detalhes as Record<string, unknown>).codBarraLinhaDigitavel,
    "12345678901234567890123456789012345678901234"
  );
  assert.equal(payment.references.includes("auth-456"), true);
  assert.equal(payment.references.includes("doc-123"), true);
});

test("baixa automaticamente apenas quando existe um único candidato exato", () => {
  const candidate = {
    expenseId: "expense-1",
    expenseDescription: "Aluguel",
    dueDate: new Date("2026-08-15T12:00:00-03:00"),
    value: 1200,
  };

  assert.equal(
    findUniqueExactExpenseMatch({ date: "2026-08-15", amount: -1200 }, [candidate])?.expenseId,
    "expense-1"
  );
  assert.equal(findUniqueExactExpenseMatch({ date: "2026-08-15", amount: 1200 }, [candidate]), null);
  assert.equal(
    findUniqueExactExpenseMatch(
      { date: "2026-08-15", amount: -1200 },
      [candidate, { ...candidate, expenseId: "expense-2" }]
    ),
    null
  );
  assert.equal(
    findUniqueExactExpenseMatch(
      { date: "2026-08-15", amount: -1200 },
      [candidate],
      new Set(["expense-1:0"])
    ),
    null
  );
});

test("classifica as formas de saída do extrato sem confundir pagamento de fatura com despesa", () => {
  const methods = [
    { id: "pix", type: "pix", label: "PIX Inter" },
    { id: STATEMENT_PAYMENT_METHOD_IDS.bankDebit, type: "transfer", label: "Débito em conta" },
    { id: STATEMENT_PAYMENT_METHOD_IDS.automaticDebit, type: "transfer", label: "Débito automático" },
    { id: STATEMENT_PAYMENT_METHOD_IDS.boleto, type: "transfer", label: "Boleto / código de barras" },
    { id: STATEMENT_PAYMENT_METHOD_IDS.bankTransfer, type: "transfer", label: "Transferência bancária" },
    { id: STATEMENT_PAYMENT_METHOD_IDS.cardStatementSettlement, type: "transfer", label: "Liquidação de fatura" },
    { id: "card", type: "credit_card", label: "Cartão Crédito Inter - 1127" },
  ];

  assert.equal(inferStatementPaymentMethodFromText("Pix enviado — Fornecedor", methods)?.id, "pix");
  assert.equal(
    inferStatementPaymentMethodFromText("Pagamento efetuado — T V N", methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.bankDebit
  );
  assert.equal(
    inferStatementPaymentMethodFromText("Débito automático — Energia", methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.automaticDebit
  );
  assert.equal(
    inferStatementPaymentMethodFromText("Pagamento de título por código de barras", methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.boleto
  );
  assert.equal(
    inferStatementPaymentMethodFromText('{"detalhes":{"codBarraLinhaDigitavel":"123"}}', methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.boleto
  );
  assert.equal(
    inferStatementPaymentMethodFromText("Transferência TED enviada", methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.bankTransfer
  );
  assert.equal(
    inferStatementPaymentMethodFromText("Pagamento efetuado — Pagamento Fatura - TITULAR", methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.cardStatementSettlement
  );
  assert.equal(
    inferStatementPaymentMethodFromText("Pix para pagamento de fatura", methods)?.id,
    STATEMENT_PAYMENT_METHOD_IDS.cardStatementSettlement
  );
  assert.equal(isCardStatementSettlementText("Liquidação de fatura do cartão"), true);
  assert.equal(isBoletoPaymentText("codBarraLinhaDigitavel"), true);
});
