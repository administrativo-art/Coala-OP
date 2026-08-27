import assert from "node:assert/strict";
import test from "node:test";

import {
  findExpenseMatchSuggestion,
  findUniqueExactExpenseMatch,
  refreshStatementSessionItem,
  sanitizeStatementSessionItemForFirestore,
} from "../../src/features/financial/lib/inter-statement-reconciliation";
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

function undefinedPaths(value: unknown, path = "payload"): string[] {
  if (value === undefined) return [path];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => undefinedPaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) => undefinedPaths(entry, `${path}.${key}`));
}

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

test("distingue dois pagamentos informados da mesma despesa pela chave do pagamento", () => {
  const first = {
    candidateKey: "reported:payment-1",
    expenseId: "expense-1",
    expenseDescription: "Pagamento parcial informado",
    dueDate: new Date("2026-08-15T12:00:00-03:00"),
    value: 600,
    settlementPrincipalValue: 600,
    reportedPaymentId: "payment-1",
  };
  const second = {
    ...first,
    candidateKey: "reported:payment-2",
    value: 400,
    settlementPrincipalValue: 400,
    reportedPaymentId: "payment-2",
  };

  const match = findUniqueExactExpenseMatch(
    { date: "2026-08-15", amount: -400 },
    [first, second],
    new Set(["reported:payment-1"]),
  );

  assert.equal(match?.reportedPaymentId, "payment-2");
  assert.equal(match?.settlementPrincipalValue, 400);
});

test("sugere principal e encargos quando o pagamento vencido é maior que a despesa", () => {
  const suggestion = findExpenseMatchSuggestion({
    date: "2026-08-20",
    amount: -110,
    description: "Pagamento TVN Telecomunicacoes",
  }, [{
    expenseId: "internet-admin",
    expenseDescription: "Internet - Administrativo | TVN",
    supplier: "TVN Telecomunicações Nordeste",
    dueDate: new Date("2026-08-15T12:00:00-03:00"),
    value: 100,
  }]);

  assert.equal(suggestion?.expenseId, "internet-admin");
  assert.equal(suggestion?.confidence, "medium");
  assert.equal(suggestion?.additionalCharges, 10);
});

test("não sugere encargos quando existem dois candidatos equivalentes", () => {
  const base = {
    expenseDescription: "Internet",
    supplier: "TVN",
    dueDate: new Date("2026-08-15T12:00:00-03:00"),
    value: 100,
  };
  const suggestion = findExpenseMatchSuggestion({
    date: "2026-08-20",
    amount: -110,
    description: "Pagamento TVN",
  }, [
    { ...base, expenseId: "internet-admin" },
    { ...base, expenseId: "internet-jp" },
  ]);
  assert.equal(suggestion, null);
});

test("atualiza uma linha pendente quando a conciliação bancária já foi resolvida", () => {
  const current = {
    id: "bank-row",
    status: "pending",
    expenseDraft: { mode: "new" },
    auditHistory: [{ action: "audit_confirmed" }],
  };
  const incoming = {
    id: "bank-row",
    status: "completed",
    expenseDraft: { mode: "existing", linkedExpenseId: "salary-expense" },
  };

  assert.deepEqual(refreshStatementSessionItem(current, incoming), {
    ...current,
    ...incoming,
    auditHistory: current.auditHistory,
  });
});

test("não introduz undefined no payload persistido da sessão do extrato", () => {
  const refreshed = refreshStatementSessionItem({
    id: "bank-row",
    status: "pending",
  }, {
    id: "bank-row",
    status: "completed",
  });

  assert.deepEqual(undefinedPaths({ items: [refreshed] }), []);
});

test("remove undefined aninhado sem alterar tipos especiais do Firestore", () => {
  const createdAt = new Date("2026-08-27T12:00:00Z");
  const sanitized = sanitizeStatementSessionItemForFirestore({
    auditHistory: [{ action: "sync", note: undefined }],
    auditSnapshot: {
      confirmed: true,
      optionalValue: undefined,
    },
    bankReferences: ["ref-1", undefined, "ref-2"],
    createdAt,
  });

  assert.deepEqual(sanitized, {
    auditHistory: [{ action: "sync" }],
    auditSnapshot: { confirmed: true },
    bankReferences: ["ref-1", "ref-2"],
    createdAt,
  });
  assert.equal(sanitized.createdAt, createdAt);
  assert.deepEqual(undefinedPaths({ items: [sanitized] }), []);
});

test("preserva a auditoria humana ao refrescar apenas os metadados bancários", () => {
  const current = {
    id: "bank-row",
    status: "audited",
    expenseDraft: { description: "Descrição confirmada" },
    bankReferences: ["old"],
  };
  const incoming = {
    id: "bank-row",
    status: "pending",
    expenseDraft: { description: "Sugestão nova" },
    bankReferences: ["new"],
    bankOperationType: "PIX",
  };

  assert.deepEqual(refreshStatementSessionItem(current, incoming), {
    ...current,
    bankReferences: ["new"],
    bankOperationType: "PIX",
  });
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
