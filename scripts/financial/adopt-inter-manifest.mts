import { readFileSync } from "node:fs";

import { withCoalaSession } from "./coala-authenticated-payment.mts";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const email = option("email");
const manifestPath = option("manifest");
if (!email || !manifestPath) throw new Error("Informe --email e --manifest.");
const rows: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!Array.isArray(rows) || rows.length === 0 || rows.length > 30) throw new Error("Manifesto inválido ou grande demais.");
const keys = ["interRequestId", "targetExpenseId", "barcode", "amountCents", "scheduledFor", "beneficiaryDocument"];
for (const row of rows) {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || Object.keys(row).sort().join() !== [...keys].sort().join()
    || !/^[a-f\d-]{36}$/i.test(String(row.interRequestId))
    || !/^[a-zA-Z0-9_-]{1,150}$/.test(String(row.targetExpenseId))
    || !/^\d{44}(?:\d{3})?$/.test(String(row.barcode))
    || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.scheduledFor))
    || !/^(?:\d{11}|\d{14})$/.test(String(row.beneficiaryDocument))) throw new Error("Uma linha do manifesto é inválida.");
}
if (new Set(rows.map((row) => row.interRequestId)).size !== rows.length
  || new Set(rows.map((row) => row.targetExpenseId)).size !== rows.length
  || new Set(rows.map((row) => row.barcode)).size !== rows.length) throw new Error("Manifesto contém duplicidade.");

if (!process.argv.includes("--confirm-financial-actions")) {
  console.log(JSON.stringify({ mode: "preview", count: rows.length, totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    items: rows.map((row) => ({ interRequestId: row.interRequestId, targetExpenseId: row.targetExpenseId,
      amountCents: row.amountCents, scheduledFor: row.scheduledFor, barcodeLast8: row.barcode.slice(-8) })) }));
} else {
  await withCoalaSession(email, async (token) => {
    for (const row of rows) {
      const response = await fetch("https://op.coalashakes.com/api/financial/payment-requests/adopt-inter", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(row), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Adoção interrompida em ${row.interRequestId} (HTTP ${response.status}). Consulte o Coala antes de repetir.`);
      const result = await response.json();
      console.log(JSON.stringify({ interRequestId: row.interRequestId, expenseId: result.expenseId, requestId: result.requestId,
        status: result.status, alreadyLinked: result.alreadyLinked }));
    }
  });
}
