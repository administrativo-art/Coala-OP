import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import test from "node:test";
import axios, { AxiosHeaders } from "axios";
import { Timestamp } from "firebase-admin/firestore";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { adoptInterBarcodePayment } = await import("../../src/features/financial/payment-requests/adopt-inter-payment.server.ts");
const { clearInterTokenCache } = await import("../../src/lib/integrations/inter/client.server.ts");
const certificate = rootCertificates.find((value) => Date.parse(new X509Certificate(value).validTo) > Date.now() + 90 * 86_400_000);
assert.ok(certificate);

const actor = { uid: "adoption-test", email: "operator@example.test" };
const barcode = "46196163100001200001110000000000043035730501";
const dueDate = "2026-11-20";
const scheduledFor = "2026-11-20";

async function withBank(bank, run) {
  const keys = ["INTER_ENVIRONMENT", "INTER_CLIENT_ID", "INTER_CLIENT_SECRET", "INTER_CERTIFICATE_BASE64", "INTER_PRIVATE_KEY_BASE64"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousAdapter = axios.defaults.adapter;
  const methods = [];
  Object.assign(process.env, {
    INTER_ENVIRONMENT: "production", INTER_CLIENT_ID: "fixture", INTER_CLIENT_SECRET: "fixture",
    INTER_CERTIFICATE_BASE64: Buffer.from(certificate).toString("base64"),
    INTER_PRIVATE_KEY_BASE64: Buffer.from("fixture-private-key").toString("base64"),
  });
  axios.defaults.adapter = async (config) => {
    methods.push(config.method);
    const data = config.url?.endsWith("/oauth/v2/token") ? { access_token: "fixture", expires_in: 3600 } : [bank];
    return { config, data, headers: new AxiosHeaders(), status: 200, statusText: "OK" };
  };
  clearInterTokenCache();
  try { await run(methods); } finally {
    clearInterTokenCache(); axios.defaults.adapter = previousAdapter;
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  }
}

function input(id, targetExpenseId) {
  return { interRequestId: id, targetExpenseId, barcode, amountCents: 120000, scheduledFor, beneficiaryDocument: "23623057000142" };
}
function bank(id) {
  return {
    codigoTransacao: id, codigoBarra: barcode, dataVencimentoTitulo: dueDate,
    dataPagamento: scheduledFor, valorNominal: 1200, valorPago: 1200,
    cpfCnpjBeneficiario: "23623057000142", nomeBeneficiario: "CESAR THIMOTHEO",
    statusPagamento: "AGENDADO",
  };
}

test("agendamento Inter vincula despesa e débito esperado sem enviar outro pagamento", async () => {
  const id = "e6d36b9f-842d-4f72-a842-131164568100";
  const expenseId = "adoption-test-actual";
  await db.collection("expenses").doc(expenseId).set({
    workspaceId: "coala", description: "CESAR THIMOTHEO", supplier: "CESAR THIMOTHEO",
    status: "pending", totalValue: 1200, dueDate: Timestamp.fromDate(new Date(`${dueDate}T12:00:00-03:00`)),
    paymentMethod: "single", installments: [{ number: 1, value: 1200, status: "pending" }],
  });
  await withBank(bank(id), async (methods) => {
    const first = await adoptInterBarcodePayment(input(id, expenseId), actor, "coala");
    const second = await adoptInterBarcodePayment(input(id, expenseId), actor, "coala");
    assert.equal(first.alreadyLinked, false);
    assert.equal(second.alreadyLinked, true);
    assert.equal((await db.collection("expenses").doc(expenseId).get()).get("paymentRequestId"), first.requestId);
    assert.equal((await db.collection("bankPaymentRequests").doc(first.requestId).get()).get("bankInstructionOrigin"), "inter_dda");
    assert.equal((await db.collection("expectedBankDebits").doc(`request_${first.requestId}`).get()).get("bankTransactionCode"), id);
    assert.deepEqual(methods.filter((method) => method !== "post"), ["get", "get"]);
  });
});

test("agendamento Inter concilia provisão e cria despesa real vinculada", async () => {
  const id = "e6d36b9f-842d-4f72-a842-131164568101";
  const forecastId = "adoption-test-forecast";
  await db.collection("expenses").doc(forecastId).set({
    workspaceId: "coala", description: "CESAR THIMOTHEO", supplier: "CESAR THIMOTHEO",
    provisionType: "forecast", provisionSeriesKey: "adoption-test-series", provisionCompetence: "2026-11",
    competenceMonth: "2026-11", status: "provisioned", totalValue: 1200,
    dueDate: Timestamp.fromDate(new Date(`${dueDate}T12:00:00-03:00`)),
  });
  await withBank(bank(id), async (methods) => {
    const result = await adoptInterBarcodePayment(input(id, forecastId), actor, "coala");
    assert.equal(result.expenseId, `inter_dda_${forecastId}`);
    assert.equal((await db.collection("expenses").doc(forecastId).get()).get("status"), "reconciled");
    assert.equal((await db.collection("expenses").doc(result.expenseId).get()).get("paymentRequestId"), result.requestId);
    assert.ok(methods.every((method) => method === "post" || method === "get"));
    assert.equal(methods.filter((method) => method === "post").length, 1); // OAuth only.
  });
});
