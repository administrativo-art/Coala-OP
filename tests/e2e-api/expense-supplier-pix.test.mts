import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { encryptPaymentDestination } from "../../src/features/financial/beneficiaries/security.server";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-boleto";
assertFirestoreEmulatorSafety({ projectId });
const app = initializeApp({ projectId });
const db = getFirestore(app, "coala");
const financial = getFirestore(app, "coala-financeiro");
const auth = getAuth(app);
const origin = "http://127.0.0.1:3113";
const encryptionKey = "ab".repeat(32);

test("API E2E: prepara Pix por despesa e bloqueia envio divergente antes do banco", { timeout: 240_000 }, async (context) => {
  const originalEncryptionKey = process.env.PAYMENT_DATA_ENCRYPTION_KEY;
  process.env.PAYMENT_DATA_ENCRYPTION_KEY = encryptionKey;
  context.after(() => {
    if (originalEncryptionKey === undefined) delete process.env.PAYMENT_DATA_ENCRYPTION_KEY;
    else process.env.PAYMENT_DATA_ENCRYPTION_KEY = originalEncryptionKey;
  });
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3113"], {
    env: { ...process.env, NODE_ENV: "development", PAYMENT_DATA_ENCRYPTION_KEY: encryptionKey },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });
  }
  context.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await fetch(`${origin}/login`);
      break;
    } catch {
      if (server.exitCode !== null) throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function createUser(uid: string, isDefaultAdmin: boolean) {
    const email = `${uid}@coala.test`;
    await auth.createUser({ uid, email, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({
      username: uid,
      email,
      profileId: uid,
      isActive: true,
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
        nextReviewAt: "2099-01-01T00:00:00Z",
      },
    });
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "test-only-password", returnSecureToken: true }),
      },
    );
    const credentials = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof credentials.idToken, "string");
    return credentials.idToken as string;
  }

  const token = await createUser("supplier-pix-admin", true);
  const restricted = await createUser("supplier-pix-restricted", false);
  const scopedToken = await createUser("supplier-pix-unit-a", false);
  await db.collection("profiles").doc("supplier-pix-unit-a").update({ permissions: { financial: {
    view: true, expenses: { view: true, edit: true, create: true }, paymentRequests: { view: true, create: true, authorize: true, submit: true },
  }, registration: { entities: { edit: true } } } });
  await db.collection("users").doc("supplier-pix-unit-a").update({ unitAccessScope: "selected", unitAccessUnitIds: ["unit-a"] });
  const supplierEntityId = "supplier-pix-entity";
  const document = "11222333000181";
  const expenseId = "supplier-pix-september";
  const expenses = financial.collection("expenses");
  const requests = financial.collection("bankPaymentRequests");
  const profile = financial.collection("supplierPaymentProfiles").doc(supplierEntityId);
  await db.collection("entities").doc(supplierEntityId).set({ name: "Fornecedor de teste", document, status: "active" });
  const now = new Date().toISOString();
  await profile.set({
    active: true, paymentMethod: "pix_key", pixKeyType: "cnpj", holderDocument: document,
    encryptedPaymentData: encryptPaymentDestination({ pixKey: document }, encryptionKey),
    validatedAt: now, updatedAt: now,
  });
  const expense = expenses.doc(expenseId);
  await expense.set({
    workspaceId: "coala", status: "pending", provisionType: "actual", paymentMethod: "single",
    supplierId: supplierEntityId, billingIdentity: { supplierTaxId: document }, totalValue: 536.64,
    description: "Honorário de teste 2026-09", competenceMonth: "2026-09",
    installments: [{ number: 1, value: 536.64, status: "pending" }],
  });

  const post = async (path: string, access: string, body?: Record<string, unknown>) => {
    const response = await fetch(origin + path, {
    method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.match(response.headers.get("content-type") ?? "", /application\/json/,
      `${path} HTTP ${response.status}\n${logs}`);
    return response;
  };

  const deniedCompanyId = "supplier-pix-company-other-unit";
  await expenses.doc(deniedCompanyId).set({ ...(await expense.get()).data(), unitId: "unit-b", paymentRequestId: null });
  assert.equal((await post(`/api/financial/expenses/${deniedCompanyId}/supplier-pix`, scopedToken,
    { supplierEntityId, amountCents: 53664 })).status, 403);
  assert.equal((await requests.doc(`expense_supplier_pix_${deniedCompanyId}`).get()).exists, false);
  assert.equal((await expenses.doc(deniedCompanyId).get()).get("paymentRequestId"), null);
  const raceCompanyId = "supplier-pix-company-unit-race";
  await expenses.doc(raceCompanyId).set({ ...(await expense.get()).data(), unitId: "unit-a", paymentRequestId: null });
  const { prepareExpenseSupplierPix: prepareWithUnitRace } = await import("../../src/features/financial/payment-requests/expense-supplier-pix.server");
  await assert.rejects(() => prepareWithUnitRace(raceCompanyId, supplierEntityId, 53664, "coala",
    { uid: "supplier-pix-unit-a" }, undefined, undefined, undefined,
    async () => { await expenses.doc(raceCompanyId).update({ unitId: "unit-b" }); }), /sem acesso à unidade/);
  assert.equal((await requests.doc(`expense_supplier_pix_${raceCompanyId}`).get()).exists, false);
  assert.equal((await expenses.doc(raceCompanyId).get()).get("paymentRequestId"), null);

  const path = `/api/financial/expenses/${expenseId}/supplier-pix`;
  const prepare = (access = token, amountCents = 53664) => post(path, access, { supplierEntityId, amountCents });
  assert.equal((await prepare(restricted)).status, 403);
  assert.equal((await prepare(token, 53665)).status, 409);
  await profile.update({ active: false });
  assert.ok((await prepare()).status >= 400);
  assert.equal((await requests.where("expenseId", "==", expenseId).get()).size, 0);
  await profile.update({ active: true });

  // Synthetic purchase: fiscal entity and Pix receiver have distinct references.
  const orderId = "purchase-pix-confirmed";
  const goodsId = "purchase-pix-goods";
  const freightId = "purchase-pix-freight";
  const fiscalEntityId = "purchase-pix-fiscal";
  const receiverId = "purchase-pix-receiver";
  const receiverCpf = "52998224725";
  const invoiceKey = `123456${document}${"0".repeat(24)}`;
  const danfe = { role: "danfe", path: "test-only/danfe-a.pdf", sha256: "a".repeat(64), url: "https://example.test/danfe-a.pdf" };
  await db.collection("entities").doc(fiscalEntityId).set({ type: "pessoa_juridica", name: "Empresa exemplo", document, status: "active" });
  await db.collection("entities").doc(receiverId).set({ type: "pessoa_fisica", workspaceId: "coala", name: "Recebedor exemplo", document: receiverCpf, status: "active" });
  await financial.collection("supplierPaymentProfiles").doc(receiverId).set({
    entityId: receiverId, workspaceId: "coala", active: true, paymentMethod: "pix_key", pixKeyType: "cpf",
    holderDocument: receiverCpf, encryptedPaymentData: encryptPaymentDestination({ pixKey: receiverCpf }, encryptionKey),
    validatedAt: now, updatedAt: now,
  });
  await db.collection("purchase_orders").doc(orderId).set({
    workspaceId: "coala", status: "confirmed", supplierId: fiscalEntityId, destinationKioskId: "test-unit",
    linkedExpenseId: goodsId, linkedFreightExpenseId: freightId,
    totalEstimated: 150, deliveryFee: 20, freightPaymentMode: "separate", freightSupplierName: "Transportadora exemplo",
    paymentMethod: "pix", paymentCondition: "single", paymentDueDate: "2026-11-30", createdAt: now,
    invoiceAccessKey: invoiceKey, invoiceNumber: "1",
    fiscal: { issuerCnpj: document, totalCents: 13000, series: "1", protocol: "example" },
    fiscalDocuments: [danfe], documentUrl: danfe.url,
  });
  const commercialOrderId = "purchase-commercial-confirmed";
  await db.collection("purchase_orders").doc(commercialOrderId).set({
    workspaceId: "coala", status: "confirmed", supplierId: fiscalEntityId,
    destinationKioskId: "test-unit", totalEstimated: 130, deliveryFee: 0,
  });
  const patchOrder = (id: string, body: Record<string, unknown>) => fetch(`${origin}/api/purchasing/orders/${id}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await patchOrder(commercialOrderId, { invoiceAccessKey: invoiceKey, invoiceNumber: "2",
    fiscal: { issuerCnpj: document, totalCents: 13000, series: "1", protocol: "example" } })).status, 200);
  assert.equal((await patchOrder(commercialOrderId, { fiscalDocuments: [{ role: "danfe", path: "test-only", sha256: "synthetic" }] })).status, 200);
  assert.equal((await patchOrder(commercialOrderId, { invoiceAccessKey: `${invoiceKey.slice(0, -1)}1`, invoiceNumber: "3",
    fiscal: { issuerCnpj: document, totalCents: 13000, series: "1", protocol: "changed" } })).status, 409);
  assert.equal((await patchOrder(commercialOrderId, { supplierId: receiverId })).status, 409);
  assert.equal((await patchOrder(commercialOrderId, { status: "created" })).status, 409);
  await expenses.doc(goodsId).set({
    workspaceId: "coala", originModule: "purchasing", purchaseOrderId: orderId,
    purchaseExpenseRole: "goods", status: "pending", paymentMethod: "single", totalValue: 130,
    supplierId: fiscalEntityId, billingIdentity: { supplierTaxId: document }, unitId: "test-unit",
    description: "Mercadoria sintética", competenceMonth: "2026-11", dueDate: "2026-11-30",
    accountPlan: "example-account", resultCenterId: "example-center", installments: null,
  });
  await expenses.doc(freightId).set({ ...(await expenses.doc(goodsId).get()).data(),
    purchaseExpenseRole: "freight", totalValue: 20, supplier: "Transportadora exemplo",
    supplierId: null, billingIdentity: null });
  const samePartyCases = [
    { id: "commercial-without-invoice", total: 130, fee: 0, fiscal: null, expected: 200 },
    { id: "invoice-amount-mismatch", total: 150, fee: 0, fiscal: 10000, expected: 409 },
    { id: "invoice-excludes-separate-freight", total: 150, fee: 20, fiscal: 13000, expected: 200 },
  ];
  for (const scenario of samePartyCases) {
    const sameOrderId = `purchase-${scenario.id}`;
    const sameExpenseId = `expense-${scenario.id}`;
    await db.collection("purchase_orders").doc(sameOrderId).set({
      workspaceId: "coala", status: "confirmed", supplierId: supplierEntityId,
      destinationKioskId: "test-unit", linkedExpenseId: sameExpenseId,
      totalEstimated: scenario.total, deliveryFee: scenario.fee,
      freightPaymentMode: scenario.fee ? "separate" : "included_with_goods",
      ...(scenario.fiscal != null ? { invoiceAccessKey: invoiceKey, invoiceNumber: "1",
        fiscal: { issuerCnpj: document, totalCents: scenario.fiscal, series: "1", protocol: "example" } } : {}),
    });
    await expenses.doc(sameExpenseId).set({ ...(await expenses.doc(goodsId).get()).data(),
      purchaseOrderId: sameOrderId, supplierId: supplierEntityId,
      totalValue: scenario.total - scenario.fee, paymentRequestId: null });
    const response = await post(`/api/financial/expenses/${sameExpenseId}/supplier-pix`, token,
      { supplierEntityId, amountCents: (scenario.total - scenario.fee) * 100 });
    assert.equal(response.status, scenario.expected, `${scenario.id}: ${JSON.stringify(await response.clone().json())}`);
  }
  await db.collection("kiosks").doc("test-unit").set({ name: "Unidade sintética" });
  const atomicMarker = "purchase-atomic-create-demo";
  const observedInitialItems = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error("Pedido atômico não apareceu no monitor.")); }, 15000);
    const unsubscribe = db.collection("purchase_orders").where("externalOrderNumber", "==", atomicMarker)
      .onSnapshot(async (snapshot) => {
        if (snapshot.empty) return;
        try {
          const items = await snapshot.docs[0].ref.collection("items").get();
          clearTimeout(timer);
          unsubscribe();
          resolve(items.size);
        } catch (error) { clearTimeout(timer); unsubscribe(); reject(error); }
      }, (error) => { clearTimeout(timer); unsubscribe(); reject(error); });
  });
  const atomicCreate = await post("/api/purchasing/orders", token, {
    supplierId: supplierEntityId, supplierName: "Fornecedor criação atômica",
    externalOrderNumber: atomicMarker, destinationKioskId: "test-unit",
    receiptMode: "future_delivery", paymentMethod: "pix", paymentCondition: "cash",
    paymentDueDate: "2026-11-30", items: [{ baseItemId: "synthetic-item",
      itemName: "Item sintético", itemTreatment: "stock", unit: "un",
      quantityOrdered: 1, unitPriceOrdered: 150 }],
  });
  assert.equal(atomicCreate.status, 201, JSON.stringify(await atomicCreate.clone().json()));
  assert.equal(await observedInitialItems, 1, "o pedido não pode ser observado sem seu item inicial");
  const atomicOrderId = (await atomicCreate.json()).id as string;
  assert.equal((await db.collection("purchase_orders").doc(atomicOrderId).collection("items").get()).size, 1);

  const emptyCreate = await post("/api/purchasing/orders", token, {
    supplierId: supplierEntityId, supplierName: "Fornecedor pedido vazio",
    destinationKioskId: "test-unit", receiptMode: "future_delivery",
    paymentMethod: "pix", paymentCondition: "cash", paymentDueDate: "2026-11-30", items: [],
  });
  assert.equal(emptyCreate.status, 201, JSON.stringify(await emptyCreate.clone().json()));
  const emptyOrderId = (await emptyCreate.json()).id as string;
  assert.equal((await post(`/api/purchasing/orders/${emptyOrderId}/confirm`, token)).status, 409);
  assert.equal((await db.collection("purchase_orders").doc(emptyOrderId).get()).get("status"), "created");
  assert.equal((await db.collection("purchase_receipts").where("purchaseOrderId", "==", emptyOrderId).get()).size, 0);
  assert.equal((await db.collection("purchase_financials").where("purchaseOrderId", "==", emptyOrderId).get()).size, 0);
  assert.equal((await expenses.where("purchaseOrderId", "==", emptyOrderId).get()).size, 0);

  const raceOrderId = "purchase-confirm-item-race";
  const raceOrderRef = db.collection("purchase_orders").doc(raceOrderId);
  const raceItemRef = raceOrderRef.collection("items").doc("item-one");
  await raceOrderRef.set({ workspaceId: "coala", status: "created", supplierId: supplierEntityId,
    supplierName: "Fornecedor concorrência", destinationKioskId: "test-unit",
    receiptMode: "future_delivery", paymentMethod: "pix", paymentCondition: "cash",
    paymentDueDate: "2026-11-30", createdAt: now, totalEstimated: 150,
    accountPlanId: "example-account", resultCenterId: "example-center" });
  await raceItemRef.set({ purchaseOrderId: raceOrderId, baseItemId: "synthetic-item",
    itemName: "Item sintético", itemTreatment: "stock", unit: "un", quantityOrdered: 1,
    unitPriceOrdered: 150, totalOrdered: 150 });
  const [editRace, confirmRace] = await Promise.all([
    patchOrder(raceOrderId, { items: [{ baseItemId: "synthetic-item", itemName: "Item sintético",
      itemTreatment: "stock", unit: "un", quantityOrdered: 1, unitPriceOrdered: 160 }] }),
    post(`/api/purchasing/orders/${raceOrderId}/confirm`, token),
  ]);
  assert.ok([200, 409].includes(editRace.status), `PATCH concorrente: ${editRace.status}`);
  assert.ok([200, 409].includes(confirmRace.status), `confirm concorrente: ${confirmRace.status}`);
  if (confirmRace.status === 409) {
    const retry = await post(`/api/purchasing/orders/${raceOrderId}/confirm`, token);
    assert.equal(retry.status, 200, JSON.stringify(await retry.clone().json()));
  }
  const raceFinalOrder = (await raceOrderRef.get()).data()!;
  const raceFinalItems = await raceOrderRef.collection("items").get();
  const raceReceipts = await db.collection("purchase_receipts").where("purchaseOrderId", "==", raceOrderId).get();
  assert.equal(raceFinalOrder.status, "confirmed");
  assert.equal(raceReceipts.size, 1);
  assert.equal(raceFinalItems.size, 1);
  assert.equal(Math.round(Number(raceFinalOrder.totalEstimated) * 100),
    Math.round(Number(raceFinalItems.docs[0].get("totalOrdered")) * 100));
  assert.equal(Math.round(Number(raceReceipts.docs[0].get("totalEstimated")) * 100),
    Math.round(Number(raceFinalOrder.totalEstimated) * 100));
  assert.equal(raceReceipts.docs[0].get("status"), "awaiting_delivery");
  const raceReceiptItems = await raceReceipts.docs[0].ref.collection("items").get();
  assert.equal(raceReceiptItems.size, 1);
  assert.equal(Math.round(Number(raceReceiptItems.docs[0].get("totalOrdered")) * 100),
    Math.round(Number(raceFinalOrder.totalEstimated) * 100));
  const raceSync = await post(`/api/purchasing/orders/${raceOrderId}/sync-expense`, token);
  assert.equal(raceSync.status, 200, JSON.stringify(await raceSync.clone().json()));
  const raceGoods = await expenses.doc((await raceSync.json()).expenseId).get();
  assert.equal(Math.round(Number(raceGoods.get("totalValue")) * 100),
    Math.round(Number(raceFinalOrder.totalEstimated) * 100));

  // A confirmação e seus efeitos compartilham a versão do pai com qualquer edição de item.
  const staleOrderRef = db.collection("purchase_orders").doc("purchase-stale-version");
  const staleItemRef = staleOrderRef.collection("items").doc("item-one");
  await staleOrderRef.set({ workspaceId: "coala", status: "created", totalEstimated: 150 });
  await staleItemRef.set({ totalOrdered: 150 });
  const staleSnapshot = await staleOrderRef.get();
  const oldItem = await staleItemRef.get();
  const { commitVersionedPurchaseOrderBatch } = await import("../../src/lib/purchasing-order-version.server");
  const itemEditBatch = db.batch();
  itemEditBatch.update(staleItemRef, { totalOrdered: 160 });
  assert.equal(await commitVersionedPurchaseOrderBatch(itemEditBatch, staleOrderRef, staleSnapshot,
    { totalEstimated: 160 }), true);
  const freshParent = await staleOrderRef.get();
  assert.equal(oldItem.get("totalOrdered"), 150);
  assert.equal(freshParent.get("totalEstimated"), 160,
    "ler item antes do pai permitiria um par de versões incompatíveis");
  assert.equal((await staleItemRef.get()).get("totalOrdered"), 160,
    "ler o filho depois do pai atual observa a mesma edição");
  const staleReceiptRef = db.collection("purchase_receipts").doc("receipt-stale-version");
  const staleBatch = db.batch();
  staleBatch.set(staleReceiptRef, { purchaseOrderId: staleOrderRef.id, status: "awaiting_delivery" });
  assert.equal(await commitVersionedPurchaseOrderBatch(staleBatch, staleOrderRef, staleSnapshot,
    { status: "confirmed" }), false);
  assert.equal((await staleReceiptRef.get()).exists, false);
  assert.equal((await staleOrderRef.get()).get("status"), "created");
  assert.equal((await post("/api/financial/payment-requests", token, {
    sourceType: "purchase_order", sourceId: orderId, expenseId: goodsId,
    beneficiaryReference: { sourceType: "entity", sourceId: receiverId }, amount: 130,
    description: "Pedido sintético",
  })).status, 400);
  const purchasePath = `/api/financial/expenses/${goodsId}/supplier-pix`;
  const missingIndication = await post(purchasePath, token, { supplierEntityId: receiverId, amountCents: 13000 });
  assert.equal(missingIndication.status, 409, `${JSON.stringify(await missingIndication.clone().json())}\n${logs}`);
  const indicated = await post(purchasePath, token, { supplierEntityId: receiverId, amountCents: 13000,
    purchaseBeneficiaryIndication: { confirmed: true, invoiceAccessKey: invoiceKey,
      reason: "Recebedor indicado pelo fornecedor fiscal", evidence: "Nota fiscal sintética do pedido" } });
  assert.equal(indicated.status, 200, JSON.stringify(await indicated.clone().json()));
  const purchaseRequestId = `expense_supplier_pix_${goodsId}`;
  assert.equal((await expenses.doc(goodsId).get()).get("billingIdentity.supplierTaxId"), document);
  assert.equal((await requests.doc(purchaseRequestId).get()).get("beneficiaryReference.sourceId"), receiverId);
  const purchaseCreatedEvents = await requests.doc(purchaseRequestId).collection("events")
    .where("type", "==", "PAYMENT_REQUEST_CREATED").get();
  assert.equal(purchaseCreatedEvents.size, 1);
  assert.equal(purchaseCreatedEvents.docs[0].get("purchasePixIndication.confirmedBy"), "supplier-pix-admin");
  assert.equal(purchaseCreatedEvents.docs[0].get("purchasePixIndication.beneficiaryEntityId"), undefined);
  assert.equal((await financial.collection("expenses").doc(goodsId).get()).get("purchaseInvoiceAccessKey"), invoiceKey,
    "o preparo preserva a referência fiscal canônica também em despesas anteriores à nova sincronização");
  assert.equal((await requests.where("expenseId", "==", freightId).get()).size, 0);
  assert.equal((await patchOrder(orderId, { fiscalDocuments: [{ ...danfe, path: "test-only/danfe-b.pdf", sha256: "b".repeat(64) }] })).status, 200);
  assert.ok((await post(`/api/financial/payment-requests/${purchaseRequestId}/authorize`, token)).status >= 400,
    "trocar o DANFE após o preparo impede autorização");
  assert.equal((await patchOrder(orderId, { fiscalDocuments: [danfe] })).status, 200);
  assert.equal((await patchOrder(orderId, { freightSupplierId: fiscalEntityId })).status, 200);
  assert.equal((await patchOrder(orderId, { freightSupplierId: receiverId })).status, 409);
  const freightSync = await post(`/api/purchasing/orders/${orderId}/sync-expense`, token);
  assert.equal(freightSync.status, 200, JSON.stringify(await freightSync.clone().json()));
  assert.equal((await expenses.doc(freightId).get()).get("supplierId"), fiscalEntityId);
  assert.equal((await expenses.doc(freightId).get()).get("billingIdentity.supplierTaxId"), document);
  assert.equal((await expenses.doc(freightId).get()).get("paymentRequestId"), undefined);
  assert.equal((await requests.where("expenseId", "==", freightId).get()).size, 0);
  await db.collection("purchase_orders").doc(orderId).update({ invoiceNumber: "2" });
  assert.ok((await post(`/api/financial/payment-requests/${purchaseRequestId}/authorize`, token)).status >= 400);
  await db.collection("purchase_orders").doc(orderId).update({ invoiceNumber: "1" });
  assert.equal((await post(`/api/financial/payment-requests/${purchaseRequestId}/authorize`, token)).status, 200);
  const { submitPaymentRequest: submitPurchasePix } = await import("../../src/features/financial/payment-requests/service.server");
  assert.equal((await patchOrder(orderId, { documentUrl: "https://example.test/danfe-b.pdf" })).status, 200);
  await assert.rejects(submitPurchasePix(purchaseRequestId, { uid: "supplier-pix-admin" }), /pedido|valor|despesa/i,
    "trocar o link legado do DANFE após autorização impede envio");
  assert.equal((await requests.doc(purchaseRequestId).get()).get("submissionAttemptCount"), undefined);
  assert.equal((await patchOrder(orderId, { documentUrl: danfe.url })).status, 200);
  await expenses.doc(goodsId).update({ totalValue: 131 });
  await assert.rejects(submitPurchasePix(purchaseRequestId, { uid: "supplier-pix-admin" }), /pedido|valor|despesa/i);
  assert.equal((await requests.doc(purchaseRequestId).get()).get("interRequestId"), undefined);
  await expenses.doc(goodsId).update({ totalValue: 130 });

  const results = await Promise.all([prepare(), prepare()]);
  const requestId = `expense_supplier_pix_${expenseId}`;
  for (const response of results) {
    const result = await response.json();
    assert.equal(response.status, 200, `${JSON.stringify(result)}\n${logs}`);
    assert.deepEqual(result.request, { id: requestId, status: "awaiting_financial_authorization" });
  }
  assert.equal((await expense.get()).get("paymentRequestId"), requestId);
  assert.equal((await requests.where("expenseId", "==", expenseId).get()).size, 1);
  assert.equal((await requests.doc(requestId).collection("events").get()).size, 1);

  const { registerReportedPayment } = await import("../../src/features/financial/obligations/service.server");
  const manualInput = {
    idempotencyKey: "manual-supplier-pix-test-2026-11", paidAt: "2026-11-23T12:00:00-03:00",
    interest: 0, fine: 0, notes: "", splits: [{ accountId: "inter", accountName: "Inter",
      paymentMethodId: "pix", paymentMethodLabel: "Pix", amount: 536.64 }],
  };
  await assert.rejects(registerReportedPayment(expenseId, manualInput, { uid: "supplier-pix-admin" }), /Pix vinculado.*encerramento bancário seguro/);
  const missingRequestExpenseId = "supplier-pix-missing-request";
  await expenses.doc(missingRequestExpenseId).set({ ...(await expense.get()).data(), paymentRequestId: "missing-bank-request" });
  await assert.rejects(registerReportedPayment(missingRequestExpenseId, manualInput, { uid: "supplier-pix-admin" }), /solicitação bancária vinculada.*não foi encontrada/);
  assert.equal((await financial.collection("payments").where("expenseId", "==", expenseId).get()).size, 0);

  const requestPath = `/api/financial/payment-requests/${requestId}`;
  const authorization = await post(`${requestPath}/authorize`, token);
  const authorized = await authorization.json();
  assert.equal(authorization.status, 200, JSON.stringify(authorized));
  assert.equal(authorized.request.status, "ready_to_submit");
  // The HTTP submit route requires a real Inter configuration. Exercise the service's
  // transaction directly and verify that it rejects each case before reaching Inter.
  const { submitPaymentRequest } = await import("../../src/features/financial/payment-requests/service.server");
  const submit = () => submitPaymentRequest(requestId, { uid: "supplier-pix-admin" });
  await expense.update({ totalValue: 536.65 });
  await assert.rejects(submit, /valor ou a identidade do fornecedor diverge/);
  assert.equal((await requests.doc(requestId).get()).get("status"), "ready_to_submit");
  await expense.update({ totalValue: 536.64 });
  await financial.collection("payments").doc("supplier-pix-existing-payment").set({ expenseId, totalPaid: 536.64 });
  await assert.rejects(submit, /os pagamentos mudaram/);
  const request = await requests.doc(requestId).get();
  assert.equal(request.get("status"), "ready_to_submit");
  assert.equal(request.get("interRequestId"), undefined);

  const receiptExpenseId = "generated-receipt-direct-api";
  const receiptId = "generated-receipt-direct-api-owned";
  const receiptExpense = expenses.doc(receiptExpenseId);
  await receiptExpense.set({ ...(await expense.get()).data(),
    status: "pending", paymentRequestId: null, originModule: "generated_receipt", generatedReceiptId: receiptId,
    beneficiaryReference: { sourceType: "entity", sourceId: supplierEntityId },
    totalValue: 500, netPayableValue: 450,
    installments: [{ number: 1, value: 500, status: "pending" }],
  });
  const receiptInput = { sourceType: "generated_receipt", sourceId: receiptId, expenseId: receiptExpenseId,
    beneficiaryReference: { sourceType: "entity", sourceId: supplierEntityId },
    amount: 500, description: "Recibo sintético de teste" };
  const receiptPost = (body = receiptInput) => post("/api/financial/payment-requests", token, body);
  assert.equal((await receiptPost()).status, 400, "líquido 450 não permite Pix 500");
  await receiptExpense.update({ netPayableValue: 500 });
  assert.equal((await receiptPost({ ...receiptInput, sourceId: "generated-receipt-other" })).status, 400,
    "recibo sem vínculo com a despesa não pode criar pedido");
  assert.equal((await receiptPost({ ...receiptInput, amount: 450 })).status, 400,
    "valor inferior ao total também não pode criar pedido");
  assert.equal((await requests.where("expenseId", "==", receiptExpenseId).get()).size, 0);
  const receiptCreated = await receiptPost();
  assert.equal(receiptCreated.status, 201, JSON.stringify(await receiptCreated.clone().json()));
  const receiptRequestId = (await receiptCreated.json()).request.id as string;
  assert.equal((await receiptExpense.get()).get("paymentRequestId"), receiptRequestId);
  assert.equal((await post(`/api/financial/payment-requests/${receiptRequestId}/authorize`, token)).status, 200);
  await receiptExpense.update({ netPayableValue: 450 });
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" }), /valor líquido não correspondem/);
  await receiptExpense.update({ netPayableValue: 500, generatedReceiptId: "generated-receipt-other" });
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" }), /recibo.*não correspondem/);
  assert.equal((await requests.doc(receiptRequestId).get()).get("status"), "ready_to_submit");
  assert.equal((await requests.doc(receiptRequestId).get()).get("submissionAttemptCount"), undefined);

  const { createPaymentRequest } = await import("../../src/features/financial/payment-requests/service.server");
  await receiptExpense.update({ generatedReceiptId: receiptId, paymentRequestId: FieldValue.delete() });
  await assert.rejects(() => createPaymentRequest(receiptInput, { uid: "supplier-pix-admin" }, async () => {
    await receiptExpense.update({ netPayableValue: 450 });
  }), /valor líquido não correspondem/);
  assert.equal((await receiptExpense.get()).get("paymentRequestId"), undefined,
    "a religação precisa rejeitar mudança entre consulta e transação");
  await receiptExpense.update({ netPayableValue: 500 });
  assert.equal((await createPaymentRequest(receiptInput, { uid: "supplier-pix-admin" })).id, receiptRequestId);
  assert.equal((await receiptExpense.get()).get("paymentRequestId"), receiptRequestId);

  const afterReservation = async (change: Record<string, unknown>) => {
    const reserved = await requests.doc(receiptRequestId).get();
    assert.equal(reserved.get("status"), "submitting");
    assert.equal(reserved.get("submissionAttemptCount"), 1);
    assert.equal(typeof reserved.get("submissionReservationId"), "string");
    await receiptExpense.update(change);
  };
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" },
    () => afterReservation({ netPayableValue: 450 })), /valor líquido não correspondem/);
  let recovered = await requests.doc(receiptRequestId).get();
  assert.equal(recovered.get("status"), "ready_to_submit");
  assert.equal(recovered.get("submissionStartedAt"), undefined);
  assert.equal(recovered.get("submissionAttemptCount"), undefined);
  assert.equal(recovered.get("submissionReservationId"), undefined);
  await receiptExpense.update({ netPayableValue: 500 });
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" },
    () => afterReservation({ generatedReceiptId: "generated-receipt-other" })), /recibo.*não correspondem/);
  recovered = await requests.doc(receiptRequestId).get();
  assert.equal(recovered.get("status"), "ready_to_submit");
  assert.equal(recovered.get("submissionAttemptCount"), undefined);
  assert.equal((await requests.doc(receiptRequestId).collection("events").where("type", "==", "INTER_SUBMISSION_FAILED").get()).size, 0);
  await receiptExpense.update({ generatedReceiptId: receiptId });
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" }, async () => {
    await profile.update({ updatedAt: "2026-11-24T10:00:00.000Z" });
  }), /dados do favorecido mudaram/);
  recovered = await requests.doc(receiptRequestId).get();
  assert.equal(recovered.get("status"), "ready_to_submit");
  assert.equal(recovered.get("submissionAttemptCount"), undefined);
  await profile.update({ updatedAt: now });
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" },
    undefined, async () => { throw new Error("Resultado bancário sintético incerto"); }), /Não foi possível concluir a comunicação/);
  recovered = await requests.doc(receiptRequestId).get();
  assert.equal(recovered.get("status"), "failed");
  assert.equal(recovered.get("submissionAttemptCount"), 1);
  assert.equal(typeof recovered.get("submissionStartedAt"), "string");
  await assert.rejects(() => submitPaymentRequest(receiptRequestId, { uid: "supplier-pix-admin" }), /Envio anterior exige conferência manual/);

  const cpf = "52998224725";
  const personalKeys = [
    { type: "cpf", key: cpf },
    { type: "email", key: "prestador@example.test" },
    { type: "phone", key: "+5511999998888" },
    { type: "random", key: "123e4567-e89b-12d3-a456-426614174000" },
  ];
  for (const { type, key } of personalKeys) {
    const entityId = `supplier-pix-person-${type}`;
    const actualId = `supplier-pix-person-expense-${type}`;
    const personalProfile = financial.collection("supplierPaymentProfiles").doc(entityId);
    await db.collection("entities").doc(entityId).set({ type: "pessoa_fisica", workspaceId: "coala", name: "Prestador de teste", document: cpf, status: "active" });
    if (type === "phone") {
      const profileResponse = await fetch(`${origin}/api/financial/beneficiaries/entities/${entityId}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pixKey: "(11) 99999-8888", pixKeyType: "phone" }),
      });
      assert.equal(profileResponse.status, 200, JSON.stringify(await profileResponse.json()));
      assert.equal((await personalProfile.get()).get("pixKeyType"), "phone");
    } else {
      await personalProfile.set({
        entityId, workspaceId: "coala", active: true, paymentMethod: "pix_key", pixKeyType: type, holderDocument: cpf,
        encryptedPaymentData: encryptPaymentDestination({ pixKey: key }, encryptionKey),
        validatedAt: now, updatedAt: now,
      });
    }
    const personalExpense = expenses.doc(actualId);
    await personalExpense.set({
      workspaceId: "coala", status: "pending", provisionType: "actual", paymentMethod: "single",
      supplierId: entityId, billingIdentity: { supplierTaxId: cpf }, totalValue: 500,
      description: `Serviço de teste ${type}`, competenceMonth: "2026-11", dueDate: "2026-11-30",
      unitId: "test-unit", accountPlan: "test-account", referenceResultCenterId: "test-center",
      installments: [{ number: 1, value: 500, status: "pending" }],
    });
    const personalPath = `/api/financial/expenses/${actualId}/supplier-pix`;
    const personalPrepare = () => post(personalPath, token, { supplierEntityId: entityId, amountCents: 50000 });
    if (type === "cpf") {
      assert.equal((await post(personalPath, scopedToken, { supplierEntityId: entityId, amountCents: 50000 })).status, 403);
      assert.equal((await requests.doc(`expense_supplier_pix_${actualId}`).get()).exists, false);
      assert.equal((await personalExpense.get()).get("paymentRequestId"), undefined);
    }
    const duplicate = await Promise.all([personalPrepare(), personalPrepare()]);
    const personalRequestId = `expense_supplier_pix_${actualId}`;
    for (const response of duplicate) {
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.request.id, personalRequestId);
    }
    assert.equal((await requests.where("expenseId", "==", actualId).get()).size, 1);
    assert.equal(typeof (await requests.doc(personalRequestId).get()).get("beneficiarySnapshot.destinationHash"), "string");
    if (type === "email") {
      const authorized = await post(`/api/financial/payment-requests/${personalRequestId}/authorize`, token);
      assert.equal(authorized.status, 200);
      await personalProfile.update({ encryptedPaymentData: encryptPaymentDestination({ pixKey: "outro@example.test" }, encryptionKey) });
      await assert.rejects(() => submitPaymentRequest(personalRequestId, { uid: "supplier-pix-admin" }), /chave Pix ou a identidade fiscal mudou/);
      assert.equal((await requests.doc(personalRequestId).get()).get("interRequestId"), undefined);
    }
  }

  const validCpfExpense = (await expenses.doc("supplier-pix-person-expense-cpf").get()).data();
  assert.ok(validCpfExpense);
  const unlinkedExpenseId = "supplier-pix-manual-unlinked";
  await expenses.doc(unlinkedExpenseId).set({ ...validCpfExpense, paymentRequestId: null });
  const manual500 = { ...manualInput, idempotencyKey: "manual-supplier-pix-unlinked-2026-11",
    splits: [{ ...manualInput.splits[0], amount: 500 }] };
  const unlinkedManual = await registerReportedPayment(unlinkedExpenseId, manual500, { uid: "supplier-pix-admin" });
  assert.equal((await financial.collection("payments").doc(unlinkedManual.payment.id).get()).get("expenseId"), unlinkedExpenseId);
  assert.equal((await requests.doc(`expense_supplier_pix_${unlinkedExpenseId}`).get()).exists, false);

  const concurrentExpenseId = "supplier-pix-manual-concurrent";
  await expenses.doc(concurrentExpenseId).set({ ...validCpfExpense, paymentRequestId: null });
  const [concurrentPrepare, concurrentManual] = await Promise.all([
    post(`/api/financial/expenses/${concurrentExpenseId}/supplier-pix`, token,
      { supplierEntityId: "supplier-pix-person-cpf", amountCents: 50000 }),
    registerReportedPayment(concurrentExpenseId,
      { ...manual500, idempotencyKey: "manual-supplier-pix-concurrent-2026-11" },
      { uid: "supplier-pix-admin" }).then(() => true, () => false),
  ]);
  assert.notEqual(concurrentPrepare.status === 200, concurrentManual,
    "preparo Pix e baixa manual concorrentes não podem ambos vencer ou ambos falhar");
  assert.equal((await requests.doc(`expense_supplier_pix_${concurrentExpenseId}`).get()).exists,
    concurrentPrepare.status === 200);
  assert.equal((await financial.collection("payments").where("expenseId", "==", concurrentExpenseId).get()).size,
    concurrentManual ? 1 : 0);

  const netExpenseId = "supplier-pix-net-discount";
  await expenses.doc(netExpenseId).set({ ...validCpfExpense, paymentRequestId: null, netPayableValue: 450 });
  const netPath = `/api/financial/expenses/${netExpenseId}/supplier-pix`;
  assert.equal((await post(netPath, token, { supplierEntityId: "supplier-pix-person-cpf", amountCents: 50000 })).status, 409);
  await expenses.doc(netExpenseId).update({ netPayableValue: 500 });
  assert.equal((await post(netPath, token, { supplierEntityId: "supplier-pix-person-cpf", amountCents: 50000 })).status, 200);
  const netRequestId = `expense_supplier_pix_${netExpenseId}`;
  assert.equal((await post(`/api/financial/payment-requests/${netRequestId}/authorize`, token)).status, 200);
  await expenses.doc(netExpenseId).update({ netPayableValue: 450 });
  await assert.rejects(() => submitPaymentRequest(netRequestId, { uid: "supplier-pix-admin" }), /valor líquido da despesa diverge/);
  assert.equal((await requests.doc(netRequestId).get()).get("status"), "ready_to_submit");
  const invalidAnchors = [
    { name: "missing-type", entity: { workspaceId: "coala" }, profile: {} },
    { name: "missing-workspace", entity: { type: "pessoa_fisica" }, profile: {} },
    { name: "pj-type", entity: { type: "pessoa_juridica", workspaceId: "coala" }, profile: {} },
    { name: "foreign-entity", entity: { type: "pessoa_fisica", workspaceId: "foreign" }, profile: {} },
    { name: "foreign-alias", entity: { type: "pessoa_fisica", workspaceId: "coala", workspace_id: "foreign" }, profile: {} },
    { name: "wrong-profile-id", entity: { type: "pessoa_fisica", workspaceId: "coala" }, profile: { entityId: "other-entity" } },
    { name: "foreign-profile", entity: { type: "pessoa_fisica", workspaceId: "coala" }, profile: { workspaceId: "foreign" } },
    { name: "foreign-profile-alias", entity: { type: "pessoa_fisica", workspaceId: "coala" }, profile: { workspace_id: "foreign" } },
  ];
  for (const item of invalidAnchors) {
    const entityId = `supplier-pix-invalid-${item.name}`;
    const invalidExpenseId = `supplier-pix-invalid-expense-${item.name}`;
    await db.collection("entities").doc(entityId).set({ name: "Prestador de teste", document: cpf, status: "active", ...item.entity });
    await financial.collection("supplierPaymentProfiles").doc(entityId).set({
      entityId, workspaceId: "coala", active: true, paymentMethod: "pix_key", pixKeyType: "cpf", holderDocument: cpf,
      encryptedPaymentData: encryptPaymentDestination({ pixKey: cpf }, encryptionKey), validatedAt: now, updatedAt: now,
      ...item.profile,
    });
    await expenses.doc(invalidExpenseId).set({ ...validCpfExpense, supplierId: entityId, paymentRequestId: null });
    const invalidResponse = await post(`/api/financial/expenses/${invalidExpenseId}/supplier-pix`, token,
      { supplierEntityId: entityId, amountCents: 50000 });
    assert.ok(invalidResponse.status >= 400, `${item.name}: ${invalidResponse.status}`);
    assert.equal((await requests.doc(`expense_supplier_pix_${invalidExpenseId}`).get()).exists, false);
    if (["foreign-entity", "foreign-alias", "wrong-profile-id", "foreign-profile", "foreign-profile-alias"].includes(item.name)) {
      const profileRead = await fetch(`${origin}/api/financial/beneficiaries/entities/${entityId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.ok(profileRead.status >= 400, `${item.name}: GET ${profileRead.status}`);
    }
  }
  const invalidProfilePatch = await fetch(`${origin}/api/financial/beneficiaries/entities/supplier-pix-invalid-missing-type`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pixKey: cpf, pixKeyType: "cpf" }),
  });
  assert.ok(invalidProfilePatch.status >= 400);
  const missingTypePatch = await fetch(`${origin}/api/financial/beneficiaries/entities/supplier-pix-person-cpf`, {
    method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pixKey: cpf }),
  });
  assert.ok(missingTypePatch.status >= 400);

  const legacyCompanyExpenseId = "supplier-pix-legacy-company-scope";
  await expenses.doc(legacyCompanyExpenseId).set({ ...(await expense.get()).data(), paymentRequestId: null });
  const legacyCompanyPrepare = () => post(`/api/financial/expenses/${legacyCompanyExpenseId}/supplier-pix`, token,
    { supplierEntityId, amountCents: 53664 });
  const companyEntityRef = db.collection("entities").doc(supplierEntityId);
  await companyEntityRef.update({ workspaceId: "foreign" });
  assert.ok((await legacyCompanyPrepare()).status >= 400);
  await companyEntityRef.update({ workspaceId: FieldValue.delete() });
  await profile.update({ workspace_id: "foreign" });
  assert.ok((await legacyCompanyPrepare()).status >= 400);
  await profile.update({ workspace_id: FieldValue.delete() });
  assert.equal((await requests.doc(`expense_supplier_pix_${legacyCompanyExpenseId}`).get()).exists, false);
  await expenses.doc(legacyCompanyExpenseId).update({ unitId: "test-unit" });
  assert.equal((await legacyCompanyPrepare()).status, 200);
  const legacyCompanyRequestId = `expense_supplier_pix_${legacyCompanyExpenseId}`;
  await expenses.doc(legacyCompanyExpenseId).update({ status: "paid" });
  assert.equal((await post(`/api/financial/payment-requests/${legacyCompanyRequestId}/authorize`, token)).status, 409);
  await expenses.doc(legacyCompanyExpenseId).update({ status: "pending" });

  const cpfRequestId = "expense_supplier_pix_supplier-pix-person-expense-cpf";
  assert.equal((await post(`/api/financial/payment-requests/${cpfRequestId}/authorize`, scopedToken)).status, 409);
  assert.equal((await requests.doc(cpfRequestId).get()).get("status"), "awaiting_financial_authorization");
  assert.equal((await post(`/api/financial/payment-requests/${cpfRequestId}/authorize`, token)).status, 200);
  assert.equal((await post(`/api/financial/payment-requests/${legacyCompanyRequestId}/authorize`, scopedToken)).status, 409);
  assert.equal((await post(`/api/financial/payment-requests/${legacyCompanyRequestId}/authorize`, token)).status, 200);
  await assert.rejects(() => submitPaymentRequest(legacyCompanyRequestId, { uid: "supplier-pix-unit-a" }), /sem acesso à unidade/);
  const cpfEntityRef = db.collection("entities").doc("supplier-pix-person-cpf");
  const cpfProfileRef = financial.collection("supplierPaymentProfiles").doc("supplier-pix-person-cpf");
  const submitCpf = () => submitPaymentRequest(cpfRequestId, { uid: "supplier-pix-admin" });
  await assert.rejects(() => submitPaymentRequest(cpfRequestId, { uid: "supplier-pix-unit-a" }), /sem acesso à unidade/);
  await cpfProfileRef.update({ entityId: "other-entity" });
  await assert.rejects(submitCpf, /perfil de pagamento precisa estar ativo/);
  await cpfProfileRef.update({ entityId: "supplier-pix-person-cpf" });
  await cpfEntityRef.update({ workspaceId: "foreign" });
  await assert.rejects(submitCpf, /perfil de pagamento precisa estar ativo/);
  await cpfEntityRef.update({ workspaceId: "coala" });
  await cpfProfileRef.update({ workspaceId: "foreign" });
  await assert.rejects(submitCpf, /perfil de pagamento precisa estar ativo/);
  assert.equal((await requests.doc(cpfRequestId).get()).get("status"), "ready_to_submit");
  assert.equal((await requests.doc(cpfRequestId).get()).get("submissionAttemptCount"), undefined);
  await cpfProfileRef.update({ workspaceId: "coala" });

  const wrongEntity = expenses.doc("supplier-pix-person-unlinked");
  await wrongEntity.set({ ...(await expenses.doc("supplier-pix-person-expense-cpf").get()).data(), supplierId: "another-entity", paymentRequestId: null });
  assert.equal((await post(`/api/financial/expenses/${wrongEntity.id}/supplier-pix`, token,
    { supplierEntityId: "supplier-pix-person-cpf", amountCents: 50000 })).status, 409);
  await wrongEntity.update({ supplierId: "supplier-pix-person-cpf", billingIdentity: { supplierTaxId: "11111111111" } });
  assert.equal((await post(`/api/financial/expenses/${wrongEntity.id}/supplier-pix`, token,
    { supplierEntityId: "supplier-pix-person-cpf", amountCents: 50000 })).status, 409);

  const octoberEntity = "supplier-pix-missing-document";
  const octoberDocument = "11444777000161";
  const octoberForecast = "supplier-pix-october-forecast";
  const octoberActual = `supplier_pix_actual_${octoberForecast}`;
  const paidExpense = "supplier-pix-paid-history";
  const paidRequest = "supplier-pix-paid-history";
  await db.collection("entities").doc(octoberEntity).set({ type: "pessoa_juridica", name: "Prestador de Teste Ltda", document: "" });
  await expenses.doc(paidExpense).set({ workspaceId: "coala", supplier: "Prestador de Teste", paymentRequestId: paidRequest });
  await requests.doc(paidRequest).set({
    expenseId: paidExpense, status: "paid", statementReconciliationStatus: "matched",
    barcodeSnapshot: { beneficiaryDocument: octoberDocument },
  });
  const date = new Date("2026-10-17T15:00:00.000Z");
  await expenses.doc(octoberForecast).set({
    status: "provisioned", provisionType: "forecast", sourceType: "recurring_expense_forecast",
    supplier: "Prestador de Teste", description: "Cobrança de teste em outubro", totalValue: 536.64,
    provisionSeriesKey: "recurring:prestador:teste", provisionCompetence: "2026-10", competenceMonth: "2026-10",
    dueDate: date, unitId: "test-unit", accountPlan: "test-account", referenceResultCenterId: "test-center",
  });
  const confirmOctober = (competenceMonth: string) => post(`/api/financial/expenses/${octoberForecast}/supplier-pix`, token, {
    supplierEntityId: octoberEntity, amountCents: 53664,
    confirmation: { beneficiaryDocument: octoberDocument, competenceMonth, previousPaidRequestId: paidRequest, allowExistingBoleto: false },
  });
  assert.equal((await post(`/api/financial/expenses/${octoberForecast}/supplier-pix`, scopedToken, {
    supplierEntityId: octoberEntity, amountCents: 53664,
    confirmation: { beneficiaryDocument: octoberDocument, competenceMonth: "2026-10",
      previousPaidRequestId: paidRequest, allowExistingBoleto: false },
  })).status, 403);
  assert.equal((await expenses.doc(octoberActual).get()).exists, false);
  assert.equal((await confirmOctober("2026-11")).status, 409);
  assert.equal((await expenses.doc(octoberActual).get()).exists, false);
  assert.equal((await db.collection("entities").doc(octoberEntity).get()).get("document"), "");
  assert.equal((await confirmOctober("2026-10")).status, 409,
    "a confirmação não completa CNPJ ou perfil ausente");
  assert.equal((await db.collection("entities").doc(octoberEntity).get()).get("document"), "");
  assert.equal((await financial.collection("supplierPaymentProfiles").doc(octoberEntity).get()).exists, false);
  await db.collection("entities").doc(octoberEntity).update({ document: octoberDocument, documentNormalized: octoberDocument });
  assert.equal((await confirmOctober("2026-10")).status, 409,
    "perfil Pix deve ser configurado e validado em ação própria");
  const octoberProfile = financial.collection("supplierPaymentProfiles").doc(octoberEntity);
  await octoberProfile.set({ entityId: octoberEntity, workspaceId: "coala", active: true, paymentMethod: "pix_key",
    pixKeyType: "cnpj", holderDocument: octoberDocument,
    encryptedPaymentData: encryptPaymentDestination({ pixKey: octoberDocument }, encryptionKey),
    validatedAt: now, updatedAt: now });

  const raceForecastId = "supplier-pix-forecast-unit-race";
  const raceForecastActualId = `supplier_pix_actual_${raceForecastId}`;
  await expenses.doc(raceForecastId).set({ ...(await expenses.doc(octoberForecast).get()).data(),
    unitId: "unit-a", provisionSeriesKey: "recurring:prestador:race", paymentRequestId: null });
  const entityBeforeRace = (await db.collection("entities").doc(octoberEntity).get()).data();
  const profileBeforeRace = (await octoberProfile.get()).data();
  const { confirmSupplierPixSource } = await import("../../src/features/financial/payment-requests/supplier-pix-confirmation.server");
  await assert.rejects(() => confirmSupplierPixSource(raceForecastId, octoberEntity, 53664, "coala",
    { uid: "supplier-pix-unit-a" },
    { beneficiaryDocument: octoberDocument, competenceMonth: "2026-10",
      previousPaidRequestId: paidRequest, allowExistingBoleto: false },
    (current) => { if (current?.unitId !== "unit-a") throw new Error("Operador sem acesso à unidade"); },
    async () => { await expenses.doc(raceForecastId).update({ unitId: "unit-b" }); }), /sem acesso à unidade/);
  assert.deepEqual((await db.collection("entities").doc(octoberEntity).get()).data(), entityBeforeRace);
  assert.deepEqual((await octoberProfile.get()).data(), profileBeforeRace);
  assert.equal((await expenses.doc(raceForecastActualId).get()).exists, false);
  assert.equal((await requests.where("expenseId", "==", raceForecastActualId).get()).size, 0);

  const confirmedOctober = await confirmOctober("2026-10");
  const octoberResponse = await confirmedOctober.json();
  assert.equal(confirmedOctober.status, 200, JSON.stringify(octoberResponse));
  assert.equal(octoberResponse.request.expenseId, octoberActual);
  assert.equal((await expenses.doc(octoberForecast).get()).get("status"), "reconciled");
  const october = await expenses.doc(octoberActual).get();
  assert.equal(october.get("accountPlan"), "test-account");
  assert.equal(october.get("billingIdentity.supplierTaxId"), octoberDocument);
  assert.equal(october.get("paymentRequestId"), octoberResponse.request.id);
  assert.equal((await db.collection("entities").doc(octoberEntity).get()).get("document"), octoberDocument);
  assert.equal((await confirmOctober("2026-10")).status, 200);
  assert.equal((await requests.where("expenseId", "==", octoberActual).get()).size, 1);


  const { assertExpenseSupplierPixTarget } = await import("../../src/features/financial/payment-requests/expense-supplier-pix.server");
  const { paymentBarcodeHash } = await import("../../src/features/financial/inbox/document-identity");
  const syntheticCode = "1".repeat(47);
  const withBoleto = {
    ...october.data(),
    paymentRequestId: null,
    boletoAttachment: {
      barcode: syntheticCode, storagePath: "test-only.pdf", beneficiaryDocument: octoberDocument,
      amountCents: 53664, competenceMonth: "2026-10",
    },
  };
  const pin = { competenceMonth: "2026-10", previousPaidRequestId: paidRequest, replacedBoletoHash: paymentBarcodeHash(syntheticCode) };
  assert.equal(assertExpenseSupplierPixTarget(withBoleto, "coala", octoberEntity, octoberDocument, 53664, pin), "Cobrança de teste em outubro");
  assert.throws(() => assertExpenseSupplierPixTarget(withBoleto, "coala", octoberEntity, octoberDocument, 53664), /boleto ou a competência/);
  const mismatched = { ...withBoleto, boletoAttachment: { ...withBoleto.boletoAttachment, amountCents: 53665 } };
  assert.throws(() => assertExpenseSupplierPixTarget(mismatched, "coala", octoberEntity, octoberDocument, 53664, pin), /arquivo do boleto/);

  const { prepareExpenseSupplierPix } = await import("../../src/features/financial/payment-requests/expense-supplier-pix.server");
  const octoberRequest = requests.doc(octoberResponse.request.id);
  await octoberRequest.update({ status: "approval_expired", interRequestId: "test-expired-pix", bankStatus: "EXPIRADO" });
  const fakeBank = (status: string) => async (id: string) => ({
    transacaoPix: { codigoSolicitacao: id, status, valor: 536.64 },
  });
  const replace = (status: string) => prepareExpenseSupplierPix(
    octoberActual, octoberEntity, 53664, "coala", { uid: "supplier-pix-admin" },
    undefined, octoberRequest.id, fakeBank(status),
  );
  await assert.rejects(replace("PAGO"), /não confirmou o encerramento/);
  await assert.rejects(replace("PENDENTE_APROVACAO"), /não confirmou o encerramento/);
  assert.equal((await expenses.doc(octoberActual).get()).get("paymentRequestId"), octoberRequest.id);
  const replacements = await Promise.all([replace("EXPIRADO"), replace("EXPIRADO")]);
  assert.equal(replacements[0].id, replacements[1].id);
  assert.equal(replacements[0].status, "awaiting_financial_authorization");
  assert.equal((await octoberRequest.get()).get("supersededByPaymentRequestId"), replacements[0].id);
  assert.equal((await requests.doc(replacements[0].id).get()).get("supersedesPaymentRequestId"), octoberRequest.id);
  assert.equal((await expenses.doc(octoberActual).get()).get("paymentRequestId"), replacements[0].id);
  assert.equal((await requests.where("expenseId", "==", octoberActual).get()).size, 2);

});
