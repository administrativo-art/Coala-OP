import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import test from "node:test";
import axios, { AxiosHeaders } from "axios";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { cancelAndReplaceExpenseBoletoPaymentRequest, refreshPaymentRequest } = await import("../../src/features/financial/payment-requests/service.server.ts");
const { clearInterTokenCache } = await import("../../src/lib/integrations/inter/client.server.ts");

const actor = { uid: "operator", email: "operator@example.test" };
const scheduledFor = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const dueDate = new Date(Date.parse(`${scheduledFor}T12:00:00Z`) + 15 * 86_400_000).toISOString().slice(0, 10);
const certificate = rootCertificates.find((value) => Date.parse(new X509Certificate(value).validTo) > Date.now() + 90 * 86_400_000);
assert.ok(certificate);

async function withBank(adapter, run) {
  const keys = ["INTER_ENVIRONMENT", "INTER_CLIENT_ID", "INTER_CLIENT_SECRET", "INTER_CERTIFICATE_BASE64", "INTER_PRIVATE_KEY_BASE64"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousAdapter = axios.defaults.adapter;
  Object.assign(process.env, {
    INTER_ENVIRONMENT: "production", INTER_CLIENT_ID: "fixture", INTER_CLIENT_SECRET: "fixture",
    INTER_CERTIFICATE_BASE64: Buffer.from(certificate).toString("base64"),
    INTER_PRIVATE_KEY_BASE64: Buffer.from("fixture-private-key").toString("base64"),
  });
  axios.defaults.adapter = async (config) => {
    if (config.url?.endsWith("/oauth/v2/token")) return { config, data: { access_token: "fixture", expires_in: 3600 }, headers: new AxiosHeaders(), status: 200, statusText: "OK" };
    return adapter(config);
  };
  clearInterTokenCache();
  try { return await run(); } finally {
    clearInterTokenCache(); axios.defaults.adapter = previousAdapter;
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
}

function ok(config, data = {}) { return { config, data, headers: new AxiosHeaders(), status: 200, statusText: "OK" }; }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

async function fixture(suffix, overrides = {}) {
  const id = `cancel-${suffix}`;
  const expenseId = `expense-${suffix}`;
  const requestRef = db.collection("bankPaymentRequests").doc(id);
  const expenseRef = db.collection("expenses").doc(expenseId);
  const debitRef = db.collection("expectedBankDebits").doc(`request_${id}`);
  const attachmentRef = db.collection("expenseBoletoAttachments").doc(expenseId);
  const request = {
    workspaceId: "coala", sourceType: "expense_boleto", sourceId: expenseId, expenseId,
    paymentRail: "barcode", status: "scheduled", interRequestId: `inter-${suffix}`,
    amount: 100, barcodeSnapshot: { code: "12345678901234567890123456789012345678901234567", dueDate, scheduledFor: dueDate, beneficiaryDocument: "12345678000195" },
    submissionAttemptCount: 1, createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z",
    ...overrides,
  };
  await Promise.all([
    requestRef.set(request),
    expenseRef.set({ workspaceId: "coala", status: "pending", paymentState: "pending", paymentMethod: "single", paymentRequestId: id, totalValue: 100, dueDate }),
    debitRef.set({ workspaceId: "coala", status: "active", paymentRequestId: id, expenseId, bankTransactionCode: request.interRequestId }),
    attachmentRef.set({ workspaceId: "coala", barcode: request.barcodeSnapshot.code, amountCents: 10000, dueDate, beneficiaryDocument: request.barcodeSnapshot.beneficiaryDocument }),
  ]);
  return { id, expenseId, requestRef, expenseRef, debitRef, attachmentRef };
}

test("concorrência de cancelamento chama DELETE uma vez e cria uma versão", async () => {
  const target = await fixture("concurrent");
  const gate = deferred(); let deletes = 0;
  await withBank(async (config) => {
    if (config.method === "delete") { deletes++; await gate.promise; return ok(config); }
    return ok(config, [{ statusPagamento: "AGENDADO", valorNominal: 100 }]);
  }, async () => {
    const first = cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor);
    const firstState = await Promise.race([
      first.then(() => "completed", (error) => `failed: ${error.message}`),
      (async () => { while (!deletes) await new Promise((resolve) => setTimeout(resolve, 10)); return "delete"; })(),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000)),
    ]);
    if (firstState !== "delete") {
      gate.resolve();
      first.catch(() => undefined);
      assert.equal(firstState, "delete");
    }
    const second = cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor);
    second.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    gate.resolve();
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);
    assert.equal(firstResult.status, "fulfilled");
    assert.equal(secondResult.status, "rejected");
    const replacement = firstResult.value;
    assert.equal(deletes, 1);
    assert.equal((await target.requestRef.get()).get("supersededByPaymentRequestId"), replacement.id);
    assert.equal((await target.debitRef.get()).get("status"), "cancelled");
    assert.equal((await cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor)).id, replacement.id);
    assert.equal(deletes, 1);
  });
});

test("DELETE aceito com persistência interrompida retoma via GET CANCELADO sem segundo DELETE", async () => {
  const target = await fixture("resume");
  let deletes = 0; let reads = 0;
  await withBank(async (config) => {
    if (config.method === "delete") {
      deletes++;
      await target.expenseRef.update({ paymentRequestId: "interrupted" });
      return ok(config);
    }
    reads++;
    return ok(config, [{ statusPagamento: "CANCELADO", valorNominal: 100, aprovacoesRealizadas: 0, aprovacoesNecessarias: 0 }]);
  }, async () => {
    await assert.rejects(cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor));
    await target.expenseRef.update({ paymentRequestId: target.id });
    await refreshPaymentRequest(target.id, actor);
    const replacement = await cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor);
    assert.equal(deletes, 1);
    assert.ok(reads >= 1);
    assert.equal(replacement.supersedesPaymentRequestId, target.id);
  });
});

test("aprovação recusada no Inter retoma a substituição sem repetir DELETE", async () => {
  const target = await fixture("rejected-approval", {
    status: "awaiting_bank_approval",
    bankStatus: "AGUARDANDO_APROVACAO",
    bankCancellation: {
      status: "pending",
      requestedAt: new Date().toISOString(),
      requestedBy: actor.uid,
      requestedByEmail: actor.email,
      bankTransactionCode: "inter-rejected-approval",
      replacementScheduledFor: scheduledFor,
    },
  });
  let deletes = 0;
  await withBank(async (config) => {
    if (config.method === "delete") deletes++;
    return ok(config, [{ statusPagamento: "REJEITADO", valorNominal: 100 }]);
  }, async () => {
    await refreshPaymentRequest(target.id, actor);
    const replacement = await cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor);
    assert.equal(replacement.supersedesPaymentRequestId, target.id);
    assert.equal(deletes, 0);
  });
});

test("liquidação concorrente após DELETE impede substituição", async () => {
  const target = await fixture("paid");
  await withBank(async (config) => {
    if (config.method === "delete") {
      await target.requestRef.update({ status: "awaiting_statement", statementReconciliationStatus: "matched" });
      await target.debitRef.update({ status: "matched" });
    }
    return ok(config);
  }, async () => {
    await assert.rejects(cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor));
    assert.equal((await target.expenseRef.get()).get("paymentRequestId"), target.id);
  });
});

test("falha incerta preserva lock; GET posterior CANCELADO retoma sem segundo DELETE", async () => {
  const target = await fixture("uncertain");
  let deletes = 0; let cancelled = false;
  await withBank(async (config) => {
    if (config.method === "delete") { deletes++; throw new Error("network interrupted"); }
    return ok(config, [{ statusPagamento: cancelled ? "CANCELADO" : "AGENDADO", valorNominal: 100 }]);
  }, async () => {
    await assert.rejects(cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor));
    assert.equal((await target.requestRef.get()).get("bankCancellation.status"), "pending");
    await assert.rejects(cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor));
    assert.equal(deletes, 1);
    cancelled = true;
    const replacement = await cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor);
    assert.equal(replacement.supersedesPaymentRequestId, target.id);
    assert.equal(deletes, 1);
  });
});

test("workspace, anexo e pagamento já conciliado impedem DELETE", async () => {
  const targets = [await fixture("workspace"), await fixture("attachment"), await fixture("matched")];
  await targets[0].expenseRef.update({ workspaceId: "other" });
  await targets[1].attachmentRef.update({ barcode: "changed" });
  await targets[2].debitRef.update({ status: "matched", matchedAt: new Date().toISOString() });
  let deletes = 0;
  await withBank(async (config) => { if (config.method === "delete") deletes++; return ok(config); }, async () => {
    for (const target of targets) await assert.rejects(cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor));
    assert.equal(deletes, 0);
  });
});

test("boleto de despesa única usa anexo base mesmo com installmentNumber 1", async () => {
  const target = await fixture("singleton-installment-one", { installmentNumber: 1 });
  let deletes = 0;
  await withBank(async (config) => {
    if (config.method === "delete") deletes++;
    return ok(config);
  }, async () => {
    const replacement = await cancelAndReplaceExpenseBoletoPaymentRequest(target.id, scheduledFor, actor);
    assert.equal(replacement.installmentNumber, 1);
    assert.equal((await target.expenseRef.get()).get("paymentRequestId"), replacement.id);
    assert.equal(deletes, 1);
  });
});
