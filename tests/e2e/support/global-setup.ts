import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

const PROJECT_ID = "demo-coala-e2e";
export const E2E_USER = {
  uid: "e2e-admin",
  email: "admin.e2e@coala.test",
  password: "coala-e2e-2026",
};
export const E2E_ORDER_IDS = {
  issued: "order-e2e-issued-0001",
  confirmed: "order-e2e-confirmed-0002",
};
export const E2E_FINANCIAL_INBOX_IDS = {
  message: "inbox-e2e-vivo-0001",
  expense: "expense-e2e-vivo-0001",
};

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
}

export default async function seedE2E() {
  assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST ausente; seed E2E abortado.");
  }

  const app = getApps().find((entry) => entry.name === "coala-e2e-seed")
    ?? initializeApp({ projectId: PROJECT_ID }, "coala-e2e-seed");
  const auth = getAuth(app);
  const mainDb = getFirestore(app, "coala");
  const financialDb = getFirestore(app, "coala-financeiro");

  try {
    await auth.createUser({
      uid: E2E_USER.uid,
      email: E2E_USER.email,
      password: E2E_USER.password,
      emailVerified: true,
      displayName: "Administrador E2E",
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/uid-already-exists") throw error;
  }
  await auth.setCustomUserClaims(E2E_USER.uid, {
    profileId: "admin",
    isDefaultAdmin: true,
  });

  const now = isoDate();
  const batch = mainDb.batch();
  batch.set(mainDb.collection("profiles").doc("admin"), {
    name: "Administrador",
    permissions: {},
    isDefaultAdmin: true,
  });
  batch.set(mainDb.collection("users").doc(E2E_USER.uid), {
    username: "Administrador E2E",
    email: E2E_USER.email,
    profileId: "admin",
    assignedKioskIds: [],
    isActive: true,
    loginRestrictionEnabled: false,
    phone: "5598999999999",
    birthDate: "1990-01-01",
    profileCompliance: {
      status: "complete",
      policyVersion: 1,
      missingFields: [],
      invalidFields: [],
      evaluatedAt: now,
      completedAt: now,
      lastConfirmedAt: now,
      nextReviewAt: isoDate(180),
    },
  });
  batch.set(mainDb.collection("entities").doc("supplier-e2e"), {
    type: "pessoa_juridica",
    name: "Fornecedor E2E Confirmado Ltda.",
    fantasyName: "Fornecedor E2E Confirmado",
    document: "00000000000191",
    status: "active",
    address: {
      street: "Rua dos Testes",
      number: "100",
      neighborhood: "Centro",
      city: "São Luís",
      state: "MA",
      zipCode: "65000-000",
    },
  });
  batch.set(mainDb.collection("entities").doc("supplier-e2e-issued"), {
    type: "pessoa_juridica",
    name: "Fornecedor E2E Emitido Ltda.",
    fantasyName: "Fornecedor E2E Emitido",
    document: "00000000000272",
    status: "active",
    address: {
      street: "Avenida do Emulador",
      number: "200",
      neighborhood: "Centro",
      city: "São Luís",
      state: "MA",
      zipCode: "65000-001",
    },
  });
  batch.set(mainDb.collection("baseProducts").doc("base-item-e2e"), {
    name: "Escada 2 Degraus Alumínio",
    baseUnit: "un",
    category: "Equipamentos",
    createdAt: now,
  });
  batch.set(mainDb.collection("settings").doc("company"), {
    labelSizeId: "6080",
    pricingParameters: {
      averageTaxPercentage: 0,
      averageCardFeePercentage: 0,
      profitGoals: [45, 50, 55, 60, 65],
      profitRanges: [
        { id: "1", from: 50, to: 1000, color: "text-green-600" },
        { id: "2", from: 45, to: 50, color: "text-yellow-600" },
        { id: "3", from: 0, to: 45, color: "text-destructive" },
      ],
    },
    purchasingDefaults: {
      goodsAccountPlanId: "account-e2e",
      freightAccountPlanId: null,
    },
  });
  batch.set(mainDb.collection("kiosks").doc("kiosk-e2e"), {
    name: "Quiosque E2E",
    address: "Ambiente isolado",
    active: true,
  });
  batch.set(mainDb.collection("channels").doc("channel-e2e"), {
    name: "Canal E2E",
    active: true,
    createdAt: now,
  });

  const commonOrder = {
    workspaceId: "coala",
    origin: "direct",
    receiptMode: "future_delivery",
    paymentMethod: "card_credit",
    paymentCondition: "cash",
    paymentDueDate: isoDate(2),
    estimatedReceiptDate: isoDate(4),
    accountPlanId: "account-e2e",
    accountPlanName: "Equipamentos e maquinários",
    resultCenterId: "result-center-e2e",
    resultCenterName: "Operação E2E",
    deliveryFee: 0,
    createdAt: now,
    createdBy: E2E_USER.uid,
  };
  batch.set(mainDb.collection("purchase_orders").doc(E2E_ORDER_IDS.issued), {
    ...commonOrder,
    supplierId: "supplier-e2e-issued",
    supplierName: "Fornecedor E2E Emitido",
    status: "created",
    totalEstimated: 23,
    trackingInfo: "Pedido emitido para teste do filtro.",
  });
  batch.set(mainDb.collection("purchase_orders").doc(E2E_ORDER_IDS.confirmed), {
    ...commonOrder,
    supplierId: "supplier-e2e",
    supplierName: "Fornecedor E2E Confirmado",
    status: "confirmed",
    totalEstimated: 119.25,
    totalConfirmed: 119.25,
    confirmedAt: now,
    confirmedBy: E2E_USER.uid,
    linkedExpenseId: "expense-e2e",
    trackingInfo: "Entrega prevista pelo ambiente E2E.",
    notes: "Pedido determinístico criado pelo teste automatizado.",
  });
  batch.set(mainDb.collection("purchase_orders").doc(E2E_ORDER_IDS.issued).collection("items").doc("item-issued"), {
    purchaseOrderId: E2E_ORDER_IDS.issued,
    baseItemId: "base-item-e2e",
    itemName: "Cabo USB-C para teste",
    unit: "un",
    purchaseUnitType: "content",
    purchaseUnitLabel: "Unidade",
    quantityOrdered: 1,
    unitPriceOrdered: 23,
    totalOrdered: 23,
    itemTreatment: "expense",
  });
  batch.set(mainDb.collection("purchase_orders").doc(E2E_ORDER_IDS.confirmed).collection("items").doc("item-confirmed"), {
    purchaseOrderId: E2E_ORDER_IDS.confirmed,
    baseItemId: "base-item-e2e",
    itemName: "Escada 2 Degraus Alumínio",
    unit: "un",
    purchaseUnitType: "content",
    purchaseUnitLabel: "Unidade",
    quantityOrdered: 1,
    unitPriceOrdered: 119.25,
    totalOrdered: 119.25,
    itemTreatment: "expense",
  });
  batch.set(mainDb.collection("purchase_receipts").doc("receipt-e2e"), {
    workspaceId: "coala",
    purchaseOrderId: E2E_ORDER_IDS.confirmed,
    supplierId: "supplier-e2e",
    supplierName: "Fornecedor E2E Confirmado",
    receiptMode: "future_delivery",
    status: "awaiting_delivery",
    expectedDate: isoDate(4),
    totalEstimated: 119.25,
    createdAt: now,
  });
  batch.set(mainDb.collection("purchase_receipts").doc("receipt-e2e").collection("items").doc("receipt-item-e2e"), {
    purchaseReceiptId: "receipt-e2e",
    purchaseOrderItemId: "item-confirmed",
    baseItemId: "base-item-e2e",
    itemName: "Escada 2 Degraus Alumínio",
    unit: "un",
    quantityOrdered: 1,
    quantityReceived: 0,
    unitPriceOrdered: 119.25,
    unitPriceConfirmed: 119.25,
    status: "pending",
  });
  batch.set(mainDb.collection("purchase_financials").doc("financial-e2e"), {
    workspaceId: "coala",
    purchaseOrderId: E2E_ORDER_IDS.confirmed,
    status: "confirmed",
    paymentDueDate: isoDate(2),
    totalExpected: 119.25,
    linkedExpenseId: "expense-e2e",
    createdAt: now,
  });
  await batch.commit();

  const financialBatch = financialDb.batch();
  financialBatch.set(financialDb.collection("accounts").doc("account-e2e"), {
    name: "Equipamentos e maquinários",
    active: true,
    parentId: null,
  });
  financialBatch.set(financialDb.collection("resultCenters").doc("result-center-e2e"), {
    name: "Operação E2E",
    active: true,
  });
  financialBatch.set(financialDb.collection("bankAccounts").doc("bank-e2e"), {
    name: "Conta E2E",
    active: true,
    paymentMethods: [],
  });
  financialBatch.set(financialDb.collection("expenses").doc("expense-e2e"), {
    purchaseOrderId: E2E_ORDER_IDS.confirmed,
    originModule: "purchasing",
    status: "pending",
    totalValue: 119.25,
    notes: "Despesa isolada para validar o retrocesso E2E.",
  });
  financialBatch.set(financialDb.collection("expenses").doc(E2E_FINANCIAL_INBOX_IDS.expense), {
    workspaceId: "coala",
    description: "Vivo móvel · Linha (98) 99999-1234",
    supplier: "Telefônica Brasil S.A.",
    status: "pending",
    totalValue: 249.9,
    dueDate: "2026-09-15",
    installments: [{ number: 1, value: 249.9, dueDate: "2026-09-15", status: "pending" }],
    billingIdentity: {
      supplierTaxId: null,
      customerAccount: "00192837",
      contractNumber: null,
      serviceType: "mobile",
      serviceNumbers: ["+5598999991234"],
    },
    createdAt: now,
  });
  financialBatch.set(financialDb.collection("financialInboxMessages").doc(E2E_FINANCIAL_INBOX_IDS.message), {
    workspaceId: "coala",
    provider: "resend",
    providerEmailId: "email-e2e-vivo",
    providerEventId: "event-e2e-vivo",
    messageId: null,
    status: "suggestion_available",
    from: "Vivo <contadigitalvivo@vivo.com.br>",
    fromAddress: "contadigitalvivo@vivo.com.br",
    senderDomain: "vivo.com.br",
    to: ["financeiro@coala.test"],
    originalRecipients: [],
    subject: "A fatura Vivo Móvel da sua empresa chegou",
    receivedAt: "2026-09-09T03:16:45.000Z",
    textPreview: "A sua fatura está disponível.",
    textContent: "A sua fatura está disponível.",
    classification: {
      documentType: "utility_bill",
      financeLikely: true,
      confidence: "high",
      supplierName: "Vivo",
      competence: "2026-08",
      dueDate: "2026-09-15",
      amountCents: 24990,
      barcode: null,
      barcodeMasked: null,
      links: [],
      billingIdentity: {
        supplierTaxId: null,
        customerAccount: "00192837",
        contractNumber: null,
        serviceType: "mobile",
        serviceNumbers: ["+5598999991234"],
      },
    },
    attachments: [{
      id: "fatura-vivo-e2e",
      filename: "fatura-vivo.pdf",
      contentType: "application/pdf",
      size: 1024,
      contentDisposition: "attachment",
      storagePath: "financial-inbox/e2e/fatura-vivo.pdf",
      sha256: "a".repeat(64),
      archiveStatus: "stored",
      sourceType: "attachment",
      extractionStatus: "extracted",
      extractionMethod: "pdf_text",
      extractionVersion: "e2e",
      extractedTextStoragePath: null,
      extractedAt: now,
      pageCount: 1,
      extractedHints: null,
    }],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    linkedProvisionId: null,
    obligationId: null,
    paymentRequestId: null,
    existingExpenseSuggestion: {
      status: "suggested",
      expenseId: E2E_FINANCIAL_INBOX_IDS.expense,
      installmentNumber: 1,
      installmentTotal: 1,
      description: "Vivo móvel · Linha (98) 99999-1234",
      supplier: "Telefônica Brasil S.A.",
      amountCents: 24990,
      dueDate: "2026-09-15",
      reasons: ["mesmo valor", "mesmo vencimento", "mesmo favorecido", "mesma linha telefônica"],
      paymentState: "needs_scheduling",
      existingBankPayment: null,
      existingSettlement: null,
      alternatives: [],
    },
    provisionSuggestion: null,
    creationSuggestion: null,
    linkResolution: { status: "not_needed", checkedAt: now, sourceDomain: null, message: "O documento chegou anexado ao e-mail." },
    bankState: "not_prepared",
    statementTransactionId: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  await financialBatch.commit();
}
