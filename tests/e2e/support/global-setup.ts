import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";
import { shiftClosureDate, todayInClosureTimezone } from "../../../src/features/financial/cash-closures/date";
import {
  FINANCIAL_INBOX_RESOLUTION_STATE_ID,
  FINANCIAL_INBOX_RESOLUTION_VERSION,
} from "../../../src/features/financial/inbox/resolution-contract";

const PROJECT_ID = "demo-coala-e2e";
export const E2E_USER = {
  uid: "e2e-admin",
  email: "admin.e2e@coala.test",
  password: "coala-e2e-2026",
};
export const E2E_ABSENCE_BENEFICIARY = { uid: 'employee-absence-e2e', name: 'Colaboradora Ausência E2E' };
export const E2E_ORDER_IDS = {
  issued: "order-e2e-issued-0001",
  confirmed: "order-e2e-confirmed-0002",
};
export const E2E_FINANCIAL_INBOX_IDS = {
  message: "inbox-e2e-vivo-0001",
  expense: "expense-e2e-vivo-0001",
  automaticMessage: "inbox-e2e-automatic-0002",
  automaticExpense: "expense-e2e-automatic-0002",
  noiseA: "inbox-e2e-noise-0003",
  noiseB: "inbox-e2e-noise-0004",
};
export const E2E_FINANCIAL_INBOX_BARCODE = "23793493079001004992396000130003915620000113884";
export const E2E_UBER_EXPENSE_ID = "expense-e2e-uber-0001";
export const E2E_CASH_COUNTING = {
  sessionId: "cash-counting-session-e2e",
  kioskId: "kiosk-e2e",
  kioskName: "Quiosque E2E",
  operatorId: "operator-cash-e2e",
  operatorName: "Operador Caixa E2E",
};
export const E2E_VACATION = {
  employeeId: "employee-vacation-e2e",
  vacationId: "vacation-e2e-planned-0001",
  calendarId: "calendar-vacation-e2e",
};

export const E2E_STOCK_MIN = {
  cdGroupId: "group-cd-e2e",
  storesGroupId: "group-lojas-e2e",
  cdUnitId: "unit-cd-e2e",
  storeUnitId: "unit-loja-e2e",
  cdKioskId: "cd-e2e",
  storeKioskId: "loja-e2e",
  baseProductId: "base-estoque-min-e2e",
};

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
}

function dateOnly(offsetDays = 0) {
  return isoDate(offsetDays).slice(0, 10);
}

function upcomingVacationWindow() {
  let start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() + 30);

  const candidateEnd = new Date(start);
  candidateEnd.setDate(candidateEnd.getDate() + 29);
  if (candidateEnd.getFullYear() !== start.getFullYear()) {
    start = new Date(start.getFullYear() + 1, 0, 15, 12, 0, 0, 0);
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 29);
  const returnDate = new Date(end);
  returnDate.setDate(returnDate.getDate() + 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    returnDate: returnDate.toISOString().slice(0, 10),
  };
}

// A listagem de despesas abre em "Mês atual"; datas relativas a hoje ou fixas saem do filtro na virada do mês.
function currentMonthDate(day: number) {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  const now = new Date().toISOString();
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
  batch.set(mainDb.collection("users").doc(E2E_ABSENCE_BENEFICIARY.uid), {
    username: E2E_ABSENCE_BENEFICIARY.name,
    email: 'ausencia.e2e@coala.test',
    profileId: 'user',
    assignedKioskIds: [],
    unitIds: [],
    employmentRelationshipType: 'clt',
    admissionDate: '2024-01-01',
    isActive: true,
    operacional: true,
    createdAt: now,
  });
  batch.set(mainDb.collection("kiosks").doc(E2E_STOCK_MIN.cdKioskId), { name: "CD E2E" });
  batch.set(mainDb.collection("kiosks").doc(E2E_STOCK_MIN.storeKioskId), { name: "Loja E2E" });
  batch.set(mainDb.collection("dp_unitGroups").doc(E2E_STOCK_MIN.cdGroupId), { name: "Grupo CD E2E", unitCount: 1, createdAt: now });
  batch.set(mainDb.collection("dp_unitGroups").doc(E2E_STOCK_MIN.storesGroupId), { name: "Grupo Lojas E2E", unitCount: 1, createdAt: now });
  batch.set(mainDb.collection("dp_units").doc(E2E_STOCK_MIN.cdUnitId), {
    name: "CD E2E",
    groupId: E2E_STOCK_MIN.cdGroupId,
    externalSource: "kiosk",
    externalId: E2E_STOCK_MIN.cdKioskId,
    coverageMode: "on_demand",
    createdAt: now,
  });
  batch.set(mainDb.collection("dp_units").doc(E2E_STOCK_MIN.storeUnitId), {
    name: "Loja E2E",
    groupId: E2E_STOCK_MIN.storesGroupId,
    externalSource: "kiosk",
    externalId: E2E_STOCK_MIN.storeKioskId,
    coverageMode: "on_demand",
    createdAt: now,
  });
  batch.set(mainDb.collection("baseProducts").doc(E2E_STOCK_MIN.baseProductId), {
    name: "INSUMO E2E ESTOQUE",
    category: "Massa",
    unit: "kg",
    initialCostPerUnit: 1,
    consumptionMonths: 0,
    stockLevels: {
      [E2E_STOCK_MIN.cdKioskId]: { min: 100, safetyStock: 0, leadTime: 0, override: false, lastAutoCalculatedAt: now },
      [E2E_STOCK_MIN.storeKioskId]: { min: 20, safetyStock: 0, leadTime: 0, override: true },
    },
  });
  const vacationWindow = upcomingVacationWindow();
  const vacationStart = vacationWindow.start;
  const vacationEnd = vacationWindow.end;
  const vacationYear = Number(vacationStart.slice(0, 4));
  const weeklyRestDay = (new Date(`${vacationStart}T12:00:00Z`).getUTCDay() + 3) % 7;
  batch.set(mainDb.collection("users").doc(E2E_VACATION.employeeId), {
    username: "Colaboradora Férias E2E",
    email: "ferias.e2e@coala.test",
    profileId: "user",
    assignedKioskIds: [],
    unitIds: [],
    isActive: true,
    operacional: true,
    employmentRelationshipType: "clt",
    admissionDate: "2024-01-01",
    createdAt: now,
  });
  batch.set(mainDb.collection("dp_calendars").doc(E2E_VACATION.calendarId), {
    name: `Calendário E2E ${vacationYear}`,
    year: vacationYear,
    holidayCount: 0,
    createdAt: now,
  });
  batch.set(mainDb.collection("dp_vacations").doc(E2E_VACATION.vacationId), {
    userId: E2E_VACATION.employeeId,
    cycleId: `${vacationYear - 1}-${vacationYear}`,
    recordType: "gozo",
    startDate: vacationStart,
    endDate: vacationEnd,
    returnDate: vacationWindow.returnDate,
    days: 30,
    unjustifiedAbsences: 0,
    entitledDays: 30,
    calendarId: E2E_VACATION.calendarId,
    weeklyRestDay,
    employeeAgreedToSplit: false,
    thirteenthAdvanceRequested: false,
    status: "PLANNED",
    warnings: [],
    createdAt: now,
    updatedAt: now,
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

  await resetFinancialE2EFixtures();
}

export async function resetFinancialE2EFixtures() {
  assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });
  const app = getApps().find((entry) => entry.name === "coala-e2e-seed")
    ?? initializeApp({ projectId: PROJECT_ID }, "coala-e2e-seed");
  const financialDb = getFirestore(app, "coala-financeiro");
  const now = new Date().toISOString();
  const cashClosureDate = shiftClosureDate(todayInClosureTimezone(), -1);
  const cashClosureId = `${E2E_CASH_COUNTING.kioskId}_${cashClosureDate}`;
  const cashClosureYear = Number(cashClosureDate.slice(0, 4));
  const cashClosureMonth = Number(cashClosureDate.slice(5, 7));
  const cashClosureDay = Number(cashClosureDate.slice(8, 10));
  const channelTotals = {
    cash: 12_500,
    pix: 0,
    debit_card: 0,
    credit_card: 0,
    voucher: 0,
    signed_account: 0,
    other: 0,
  };
  const emptyChannelTotals = Object.fromEntries(Object.keys(channelTotals).map((channel) => [channel, 0]));

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
  financialBatch.set(financialDb.collection("cashCountingSessions").doc(E2E_CASH_COUNTING.sessionId), {
    id: E2E_CASH_COUNTING.sessionId,
    workspaceId: "coala",
    status: "open",
    scopes: [],
    scopeKeys: [],
    kioskIds: [E2E_CASH_COUNTING.kioskId],
    kioskNames: [E2E_CASH_COUNTING.kioskName],
    periodKeys: [],
    scopeAggregationVersion: 1,
    finalizedOperatorCountsByScope: {},
    finalizedOperatorCountsByDate: {},
    finalizedOperatorCount: 0,
    countedCashCents: 0,
    depositEligibleCents: 0,
    dreOnlyCashCents: 0,
    denominationTotalCents: 0,
    noteTotalCents: 0,
    coinTotalCents: 0,
    coinPendingExchangeCents: 0,
    coinExchangedCents: 0,
    coinReturnedToTillCents: 0,
    denominations: [],
    bags: [],
    batchIds: [],
    paidBatchCount: 0,
    openedAt: now,
    openedBy: E2E_USER.uid,
    openedByName: "Administrador E2E",
    lastDraftKioskId: null,
    lastDraftDate: null,
    lastDraftUpdatedAt: null,
    lastDraftUpdatedBy: null,
    countingFinishedAt: null,
    countingFinishedBy: null,
    denominationsConfirmedAt: null,
    denominationsConfirmedBy: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: now,
    updatedAt: now,
  });
  financialBatch.set(financialDb.collection("cashCountingSessionLocks").doc(`coala:unit:${E2E_CASH_COUNTING.kioskId}`), {
    id: `coala:unit:${E2E_CASH_COUNTING.kioskId}`,
    workspaceId: "coala",
    lockKind: "unit",
    scopeKey: null,
    sessionId: E2E_CASH_COUNTING.sessionId,
    kioskId: E2E_CASH_COUNTING.kioskId,
    year: null,
    month: null,
    lockedAt: now,
    lockedBy: E2E_USER.uid,
  });
  financialBatch.set(financialDb.collection("cashClosures").doc(cashClosureId), {
    id: cashClosureId,
    workspaceId: "coala",
    kioskId: E2E_CASH_COUNTING.kioskId,
    kioskName: E2E_CASH_COUNTING.kioskName,
    pdvFilialId: "filial-e2e",
    date: cashClosureDate,
    year: cashClosureYear,
    month: cashClosureMonth,
    day: cashClosureDay,
    status: "draft",
    expectedTotalCents: 12_500,
    reportedTotalCents: 0,
    countedTotalCents: 0,
    reportedDifferenceTotalCents: 0,
    differenceTotalCents: 0,
    expectedCashCents: 12_500,
    reportedCashCents: 0,
    countedCashCents: 0,
    finalizedCountedTotalCents: 0,
    finalizedDifferenceTotalCents: 0,
    finalizedCountedCashCents: 0,
    cashDepositEligibleCents: 0,
    expectedByChannelCents: channelTotals,
    reportedByChannelCents: emptyChannelTotals,
    countedByChannelCents: emptyChannelTotals,
    reportedDifferenceByChannelCents: emptyChannelTotals,
    differenceByChannelCents: emptyChannelTotals,
    operatorCount: 1,
    finalizedOperatorCount: 0,
    unreportedLineCount: 1,
    pendingLineCount: 1,
    reportedDivergentLineCount: 0,
    divergentLineCount: 0,
    reportedMatchedLineCount: 0,
    matchedLineCount: 0,
    pdvSales: { version: 1, amountCents: 12_500 },
    source: {
      provider: "pdvlegal",
      endpoint: "cupom/get",
      couponCount: 1,
      validCouponCount: 1,
      ignoredCancelledCouponCount: 0,
      estornadoCouponCount: 0,
      itemCount: 1,
      paymentRowCount: 1,
      rawPaymentNames: ["DINHEIRO"],
      unknownPaymentNames: [],
      integrityWarnings: [],
      movementCount: 0,
      ignoredCancelledMovementCount: 0,
      ignoredNonCashMovementCount: 0,
      unassignedMovementCount: 0,
    },
    sourceHash: "cash-counting-e2e",
    cashDepositPolicy: "standard",
    cashDepositPolicyReason: null,
    cashDeposit: {
      eligibleCents: 0,
      allocatedCents: 0,
      issuedCents: 0,
      paidCents: 0,
      batchId: null,
      batchItemId: null,
      status: "not_eligible",
      manualSplitRequired: false,
      allocationReason: null,
      pendingSince: null,
    },
    approvedWithDivergence: false,
    pdvChangedAfterApproval: false,
    syncedAt: now,
    syncError: null,
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    approvalReason: null,
    reopenedAt: null,
    reopenedBy: null,
    reopenedReason: null,
    createdAt: now,
    updatedAt: now,
  });
  financialBatch.set(financialDb.collection("cashClosures").doc(cashClosureId).collection("lines").doc(`${E2E_CASH_COUNTING.operatorId}_cash`), {
    id: `${E2E_CASH_COUNTING.operatorId}_cash`,
    closureId: cashClosureId,
    workspaceId: "coala",
    kioskId: E2E_CASH_COUNTING.kioskId,
    date: cashClosureDate,
    operatorId: E2E_CASH_COUNTING.operatorId,
    operatorName: E2E_CASH_COUNTING.operatorName,
    channel: "cash",
    channelLabel: "Dinheiro",
    pdvSales: { version: 1, amountCents: 12_500 },
    calculatedExpectedCents: 12_500,
    expectedCents: 12_500,
    expectedAdjustmentCents: 0,
    expectedAdjustmentReason: null,
    expectedAdjustedBy: null,
    expectedAdjustedAt: null,
    expectedAdjustmentNeedsReview: false,
    reportedCents: null,
    reportedDifferenceCents: null,
    countedCents: null,
    conferenceDifferenceCents: null,
    differenceCents: null,
    status: "pending",
    rawPaymentNames: ["DINHEIRO"],
    metadata: { grossCashCents: 12_500, changeCents: 0, supplyCents: 0, withdrawalCents: 0, cashMovements: [] },
    reportedNote: null,
    note: null,
    reportedBy: null,
    reportedAt: null,
    countedBy: null,
    countedAt: null,
    updatedAt: now,
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
    dueDate: currentMonthDate(15),
    installments: [{ number: 1, value: 249.9, dueDate: currentMonthDate(15), status: "pending" }],
    billingIdentity: {
      supplierTaxId: null,
      customerAccount: "00192837",
      contractNumber: null,
      serviceType: "mobile",
      serviceNumbers: ["+5598999991234"],
    },
    createdAt: now,
  });
  financialBatch.set(financialDb.collection("expenses").doc(E2E_FINANCIAL_INBOX_IDS.automaticExpense), {
    workspaceId: "coala",
    description: "Cobrança automática documental E2E",
    supplier: "Fornecedor Automatizado",
    status: "pending",
    totalValue: 77.31,
    dueDate: currentMonthDate(28),
    installments: [{
      number: 1,
      value: 77.31,
      dueDate: currentMonthDate(28),
      status: "pending",
      bankLine: E2E_FINANCIAL_INBOX_BARCODE,
    }],
    createdAt: now,
  });
  financialBatch.set(financialDb.collection("expenses").doc(E2E_UBER_EXPENSE_ID), {
    workspaceId: "coala",
    description: "UBER *TRIP E2E",
    supplier: "Uber do Brasil",
    status: "pending",
    totalValue: 38.7,
    dueDate: currentMonthDate(28),
    competenceDate: now,
    accountId: "account-e2e",
    resultCenter: "Operação E2E",
    installments: [{ number: 1, value: 38.7, dueDate: currentMonthDate(28), status: "pending" }],
    uberCandidate: true,
    uberProvider: "uber",
    uberRecognitionStatus: "matched",
    uberTripDocumentId: "uber-trip-e2e",
    uberTripId: "trip-e2e-123",
    uberRequesterName: "Maria Operações",
    uberRequesterEmail: "maria.operacoes@coala.test",
    uberService: "UberX",
    uberRequestDateLocal: isoDate().slice(0, 10),
    uberTripAmount: 38.7,
    uberTripAmountCents: 3870,
    uberTripCurrency: "BRL",
    uberMatchConfidence: "high",
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
      dueDate: currentMonthDate(15),
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
      dueDate: currentMonthDate(15),
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
    resolution: {
      status: "pending",
      kind: null,
      targetType: null,
      targetId: null,
      installmentNumber: null,
      financialState: null,
      mode: null,
      confidence: null,
      reasons: [],
      resolvedAt: null,
      resolvedBy: null,
    },
    resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  financialBatch.set(financialDb.collection("financialInboxMessages").doc(E2E_FINANCIAL_INBOX_IDS.automaticMessage), {
    workspaceId: "coala",
    provider: "resend",
    providerEmailId: "email-e2e-automatic",
    providerEventId: "event-e2e-automatic",
    messageId: null,
    status: "pending_review",
    from: "Fornecedor Automatizado <cobranca@billing.example>",
    fromAddress: "cobranca@billing.example",
    senderDomain: "billing.example",
    to: ["financeiro@coala.test"],
    originalRecipients: [],
    subject: "Cobrança automática documental E2E",
    receivedAt: "2026-09-10T12:00:00.000Z",
    textPreview: `Valor total R$ 77,31. Vencimento 30/09/2026. Linha digitável ${E2E_FINANCIAL_INBOX_BARCODE}`,
    textContent: `Boleto. Valor total: R$ 77,31. Vencimento: 30/09/2026. Linha digitável: ${E2E_FINANCIAL_INBOX_BARCODE}`,
    classification: {
      documentType: "charge",
      financeLikely: true,
      confidence: "high",
      supplierName: "Fornecedor Automatizado",
      competence: null,
      dueDate: currentMonthDate(28),
      amountCents: 7731,
      barcode: E2E_FINANCIAL_INBOX_BARCODE,
      barcodeMasked: "23793••••••••••••••••••••••••••••••13884",
      links: [],
      billingIdentity: {
        supplierTaxId: null,
        customerAccount: null,
        contractNumber: null,
        serviceType: "other",
        serviceNumbers: [],
      },
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    linkedProvisionId: null,
    obligationId: null,
    paymentRequestId: null,
    existingExpenseSuggestion: null,
    provisionSuggestion: null,
    creationSuggestion: null,
    linkResolution: { status: "not_needed", checkedAt: now, sourceDomain: null, message: null },
    bankState: "not_prepared",
    statementTransactionId: null,
    resolution: {
      status: "pending",
      kind: null,
      targetType: null,
      targetId: null,
      installmentNumber: null,
      financialState: null,
      mode: null,
      confidence: null,
      reasons: [],
      resolvedAt: null,
      resolvedBy: null,
    },
    resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  const noiseFixture = {
    workspaceId: "coala",
    provider: "resend",
    messageId: null,
    status: "ignored",
    from: "Boletim <news@example.test>",
    fromAddress: "news@example.test",
    senderDomain: "example.test",
    to: ["financeiro@coala.test"],
    originalRecipients: [],
    receivedAt: "2026-09-11T12:00:00.000Z",
    textPreview: "Newsletter sem cobrança.",
    textContent: "Newsletter sem cobrança.",
    classification: { documentType: "other", financeLikely: false, confidence: "high", supplierName: null,
      competence: null, dueDate: null, amountCents: null, barcode: null, barcodeMasked: null, links: [] },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    linkedProvisionId: null,
    obligationId: null,
    paymentRequestId: null,
    existingBankPayment: null,
    statementTransactionId: null,
    bankState: "not_prepared",
    resolution: { status: "discarded", kind: "non_financial", targetType: null, targetId: null,
      installmentNumber: null, financialState: null, mode: "automatic", confidence: "high", reasons: [],
      resolvedAt: now, resolvedBy: null },
    resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
    reviewedAt: now,
    reviewedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  financialBatch.set(financialDb.collection("financialInboxMessages").doc(E2E_FINANCIAL_INBOX_IDS.noiseA), {
    ...noiseFixture, providerEmailId: "email-e2e-noise-a", providerEventId: "event-e2e-noise-a", subject: "Boletim sem cobrança A E2E",
  });
  financialBatch.set(financialDb.collection("financialInboxMessages").doc(E2E_FINANCIAL_INBOX_IDS.noiseB), {
    ...noiseFixture, providerEmailId: "email-e2e-noise-b", providerEventId: "event-e2e-noise-b", subject: "Boletim sem cobrança B E2E",
  });
  financialBatch.set(financialDb.collection("financialInboxSettings").doc("coala"), {
    mode: "manual",
    policyVersion: 1,
    updatedAt: now,
    updatedBy: E2E_USER.uid,
  });
  financialBatch.set(financialDb.collection("financialSystemState").doc(FINANCIAL_INBOX_RESOLUTION_STATE_ID), {
    version: FINANCIAL_INBOX_RESOLUTION_VERSION,
    complete: true,
    cursor: null,
    lastRunAt: now,
    updatedInLastRun: 0,
  });
  await financialBatch.commit();
}
