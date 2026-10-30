import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { firebaseClientConfig } from "../../src/lib/firebase-client-config";
import { validateOverdueSettlementCliRevision, validatePaymentCliAction, validatePaymentCliCancellation, validatePaymentCliPreparation } from "./payment-cli-contract";
import { paymentReadPath, summarizePaymentRead } from "./payment-cli-read-contract";
import { paymentLookupQuery, decodeFirestoreValue } from "./payment-cli-query-contract";
import { mainPaymentLookupQuery, summarizeMainPaymentLookup } from "./payment-cli-main-query-contract";
import { PaymentCliError, paymentCliErrorMessage, paymentCliFetch, paymentCliJson } from "./payment-cli-transport";
import { startMemorySessionServer, tokenFromMemorySession } from "./payment-cli-memory-session";
import { expenseBoletoSchema, validateExpenseBoleto } from "../../src/features/financial/payment-requests/expense-boleto";
import {
  assertPurchaseSnapshot,
  purchaseCreatePayload,
  purchaseFiscalPatch,
  purchaseFiscalSchema,
  purchaseRegistrationSchema,
  supplierEntitySchema,
  type PurchaseRegistration,
} from "./payment-cli-purchase-contract";

const COALA_URL = "https://op.coalashakes.com";
const KEYCHAIN_HELPER = fileURLToPath(new URL("./coala-keychain.swift", import.meta.url));

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? "" : String(process.argv[index + 1] ?? "").trim();
}

function requireOption(name: string) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new PaymentCliError(`Informe --${name}.`);
  return value;
}

function help() {
  stdout.write(`Uso:
  npx tsx scripts/financial/coala-authenticated-payment.mts login
  npx tsx scripts/financial/coala-authenticated-payment.mts session --email EMAIL --memory-session NOME [--minutes 30]
  npx tsx scripts/financial/coala-authenticated-payment.mts find --email EMAIL --query TEXTO --view work|identified [--cursor CURSOR]
  npx tsx scripts/financial/coala-authenticated-payment.mts inspect --email EMAIL --id INBOX_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts analyze --email EMAIL --id INBOX_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts reconcile-vivo --email EMAIL --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts document --email EMAIL --collection expenses|bankPaymentRequests|transactions --id ID
  npx tsx scripts/financial/coala-authenticated-payment.mts lookup --email EMAIL --kind expense-amount|expense-supplier|expense-purchase-order|expense-due-date|expense-account|expense-account-center|expense-unit-month|expense-center-due-month --value VALOR
  npx tsx scripts/financial/coala-authenticated-payment.mts main-lookup --email EMAIL --kind entity-document|entity-name|purchase-supplier|purchase-supplier-name|purchase-invoice-key --value VALOR
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-items --email EMAIL --id ORDER_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-options --email EMAIL
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-categories --email EMAIL
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-units --email EMAIL
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-catalog-search --email EMAIL --query TEXTO
  npx tsx scripts/financial/coala-authenticated-payment.mts supplier-create --email EMAIL --manifest JSON --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-create --email EMAIL --manifest JSON --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-fiscal-link --email EMAIL --id ORDER_ID --manifest JSON --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-confirm --email EMAIL --id ORDER_ID --invoice-access-key CHAVE --expected-total-cents CENTAVOS --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-sync-expense --email EMAIL --id ORDER_ID --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts purchase-document-attach --email EMAIL --id ORDER_ID --receipt-id RECEIPT_ID --role danfe|boletos --file PDF --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts expense-boleto-attach --email EMAIL --expense-id EXPENSE_ID --installment-number N --file PDF --amount-cents CENTAVOS --due-date AAAA-MM-DD --competence-month AAAA-MM --beneficiary-document CNPJ --document-reference REFERENCIA --barcode CODIGO --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts expense-boleto-prepare --email EMAIL --expense-id EXPENSE_ID --installment-number N --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --barcode CODIGO --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts requests --email EMAIL --amount-cents CENTAVOS
  npx tsx scripts/financial/coala-authenticated-payment.mts status --email EMAIL --id REQUEST_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts refresh --email EMAIL --id REQUEST_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts cancel-replace --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --current-scheduled-for AAAA-MM-DD --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO --confirm-financial-actions
  npx tsx scripts/financial/coala-authenticated-payment.mts prepare --email EMAIL --id INBOX_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO
  npx tsx scripts/financial/coala-authenticated-payment.mts authorize --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CPF_OU_CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO
  npx tsx scripts/financial/coala-authenticated-payment.mts send --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CPF_OU_CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO
  npx tsx scripts/financial/coala-authenticated-payment.mts retry-send --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CPF_OU_CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO
  npx tsx scripts/financial/coala-authenticated-payment.mts adjust-overdue --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --settlement-amount-cents CENTAVOS --late-charge-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO --source-attachment-id ANEXO_ID --source-attachment-sha256 SHA256
  npx tsx scripts/financial/coala-authenticated-payment.mts send-adjusted --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --settlement-amount-cents CENTAVOS --late-charge-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO --source-attachment-id ANEXO_ID --source-attachment-sha256 SHA256

O login pede a senha diretamente no terminal e guarda somente o refresh token no Chaves do macOS.
Adicione --temporary-session aos demais comandos para pedir a senha no terminal e usar uma sessão apenas em memória, sem ler ou gravar o Chaves.
Use --memory-session NOME para reutilizar, sem novo prompt, uma sessão iniciada pelo comando session.
Autorizar no Coala e enviar ao Inter são comandos separados. A aprovação final no Inter continua separada.
`);
}

async function hiddenPassword() {
  if (!stdin.isTTY || !stdin.setRawMode) throw new PaymentCliError("Execute login em um terminal interativo.");
  stdout.write("Senha do Coala (não será exibida): ");
  const previousRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(previousRaw);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0003") return finish(new PaymentCliError("Login cancelado."));
        if (character === "\u007f") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

async function loginEmail() {
  const supplied = option("email");
  if (supplied) return supplied.toLowerCase();
  if (!stdin.isTTY) throw new PaymentCliError("Informe --email ou execute login em um terminal interativo.");
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    return (await reader.question("E-mail da conta Coala: ")).trim().toLowerCase();
  } finally {
    reader.close();
  }
}

function keychain(command: "read" | "write", email: string, token?: string) {
  const result = spawnSync("/usr/bin/swift", [
    "-module-cache-path", join(tmpdir(), "coala-swift-module-cache"),
    KEYCHAIN_HELPER, command, email,
  ], {
    encoding: "utf8",
    input: command === "write" ? token : undefined,
    maxBuffer: 8192,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    const status = result.stderr?.match(/\(código (-?\d+):/)?.[1];
    const diagnostic = status ? `O Chaves recusou a operação (código ${status}). Confira a autorização no macOS.` : undefined;
    const timeout = result.error && "code" in result.error && result.error.code === "ETIMEDOUT";
    throw new PaymentCliError(diagnostic || (timeout ? "O Chaves demorou a responder; confira se há uma janela de autorização do macOS aberta." : (command === "read"
      ? "Sessão não encontrada ou acesso negado pelo Chaves. Faça login novamente."
      : "Não foi possível guardar a sessão no Chaves do macOS.")));
  }
  return command === "read" ? result.stdout.trim() : "";
}

async function firebasePost(url: string, body: string, contentType: string) {
  const response = await paymentCliFetch(url, { method: "POST", headers: { "Content-Type": contentType }, body });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const message = payload?.error?.message;
    const code = typeof message === "string" ? message.split(" : ")[0] : undefined;
    const knownCodes = new Set([
      "INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND", "USER_DISABLED",
      "TOO_MANY_ATTEMPTS_TRY_LATER", "OPERATION_NOT_ALLOWED", "API_KEY_INVALID",
      "INVALID_ID_TOKEN", "TOKEN_EXPIRED", "INVALID_REFRESH_TOKEN",
    ]);
    const reason = code && knownCodes.has(code) ? ` ${code}.` : "";
    throw new PaymentCliError(`Autenticação Firebase recusada (HTTP ${response.status}).${reason}`);
  }
  return paymentCliJson<Record<string, unknown>>(response);
}

async function coalaGet(token: string) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/payment-requests`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou a consulta autenticada (HTTP ${response.status}).`);
  const body = await paymentCliJson<{ requests?: Array<Record<string, unknown>> }>(response);
  if (!Array.isArray(body?.requests)) throw new PaymentCliError("O Coala não retornou uma lista válida de solicitações.");
  return body.requests;
}

async function coalaRead(token: string, path: string) {
  const response = await paymentCliFetch(`${COALA_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou a consulta (HTTP ${response.status}). Nenhuma ação financeira foi feita.`);
  return paymentCliJson<Record<string, unknown>>(response);
}

async function coalaPost(token: string, id: string, action: "authorize" | "submit" | "refresh") {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/payment-requests/${encodeURIComponent(id)}/${action}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala não confirmou ${action} (HTTP ${response.status}). O resultado pode ser incerto; consulte o status antes de tentar novamente.`);
  const body = await paymentCliJson<{ request?: Record<string, unknown> }>(response);
  if (body?.request?.id !== id) throw new PaymentCliError(`O Coala não confirmou a solicitação esperada após ${action}. Consulte o status; não repita o comando automaticamente.`);
  return body.request;
}

async function coalaCancelAndReplace(token: string, id: string, scheduledFor: string) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/payment-requests/${encodeURIComponent(id)}/cancel-and-replace`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledFor, confirmed: true }),
    cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala não confirmou o cancelamento e a substituição (HTTP ${response.status}). Consulte o status antes de tentar novamente.`);
  const body = await paymentCliJson<{ request?: Record<string, unknown> }>(response);
  if (!body.request || body.request.supersedesPaymentRequestId !== id) {
    throw new PaymentCliError("O Coala não confirmou a versão substituta esperada. Consulte o status; não repita automaticamente.");
  }
  return body.request;
}

async function coalaAuthorizeOverdueRevision(token: string, id: string, input: Record<string, unknown>) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/payment-requests/${encodeURIComponent(id)}/authorize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala não confirmou a revisão do boleto vencido (HTTP ${response.status}). Consulte o status antes de tentar novamente.`);
  const body = await paymentCliJson<{ request?: Record<string, unknown> }>(response);
  if (body?.request?.id !== id) throw new PaymentCliError("O Coala não confirmou a solicitação revisada esperada. Consulte o status; não repita o comando automaticamente.");
  return body.request;
}

async function coalaPrepareInbox(token: string, id: string, input: {
  scheduledFor: string;
  beneficiaryDocument: string;
  barcode: string;
}) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/inbox/${encodeURIComponent(id)}/payment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new PaymentCliError(`O Coala não confirmou a preparação (HTTP ${response.status}). O resultado pode ser incerto; consulte a cobrança antes de tentar novamente.`);
  const body = await paymentCliJson<{ request?: Record<string, unknown> }>(response);
  if (!body?.request || typeof body.request !== "object") {
    throw new PaymentCliError("O Coala não confirmou a solicitação esperada após preparar. Consulte a cobrança; não repita o comando automaticamente.");
  }
  return body.request;
}

async function coalaAttachExpenseBoleto(token: string, expenseId: string, input: ReturnType<typeof expenseBoletoSchema.parse>, filePath: string) {
  if (!filePath.toLowerCase().endsWith(".pdf")) throw new PaymentCliError("Informe um arquivo PDF de boleto.");
  const bytes = await readFile(filePath).catch(() => { throw new PaymentCliError("Não foi possível ler o PDF informado."); });
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new PaymentCliError("Envie um PDF válido de até 10 MB.");
  const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
  const form = new FormData();
  form.set("file", new File([bytes], basename(filePath), { type: "application/pdf" }));
  for (const [key, value] of Object.entries(input)) form.set(key, String(value));
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/expenses/${encodeURIComponent(expenseId)}/boleto`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou o vínculo do boleto (HTTP ${response.status}). Confira a despesa antes de tentar novamente.`);
  const result = await paymentCliJson<{ attached?: unknown; sha256?: unknown; filename?: unknown }>(response);
  if (result.attached !== true || result.sha256 !== expectedSha256) throw new PaymentCliError("O Coala não confirmou o mesmo PDF após o vínculo. Consulte a despesa; não repita automaticamente.");
  return result;
}

async function coalaPrepareExpenseBoleto(token: string, expenseId: string, installmentNumber: number, scheduledFor: string) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/expenses/${encodeURIComponent(expenseId)}/boleto/payment`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledFor, installmentNumber, confirmed: true }),
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou a preparação da parcela (HTTP ${response.status}). Consulte a despesa antes de tentar novamente.`);
  const body = await paymentCliJson<{ request?: Record<string, unknown> }>(response);
  if (!body.request) throw new PaymentCliError("O Coala não confirmou a solicitação da parcela. Consulte a despesa; não repita automaticamente.");
  return body.request;
}

async function jsonFile(path: string) {
  const raw = await readFile(path, "utf8").catch(() => { throw new PaymentCliError("Não foi possível ler o manifesto JSON."); });
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new PaymentCliError("O manifesto JSON é inválido.");
  }
}

function purchaseId(value: string, label = "compra") {
  if (!/^[a-zA-Z0-9_-]{1,170}$/.test(value)) throw new PaymentCliError(`ID de ${label} inválido.`);
  return value;
}

async function coalaPurchaseGet(token: string, path: string) {
  const response = await paymentCliFetch(`${COALA_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou a conferência da compra (HTTP ${response.status}). Nenhuma nova ação foi feita.`);
  return paymentCliJson<Record<string, unknown>>(response);
}

async function coalaPurchaseWrite(token: string, path: string, method: "POST" | "PATCH", body?: Record<string, unknown>) {
  const response = await paymentCliFetch(`${COALA_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", redirect: "error",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala não confirmou a alteração da compra (HTTP ${response.status}). Confira o pedido antes de tentar novamente.`);
  return paymentCliJson<Record<string, unknown>>(response);
}

async function createPurchase(token: string, input: PurchaseRegistration) {
  const result = await coalaPurchaseWrite(token, "/api/purchasing/orders", "POST", purchaseCreatePayload(input));
  const id = typeof result.id === "string" ? purchaseId(result.id) : "";
  if (!id) throw new PaymentCliError("O Coala não confirmou o identificador da compra. Consulte pelo fornecedor antes de tentar novamente.");
  const order = await coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(id)}`);
  assertPurchaseSnapshot(order, input);
  if (order.status !== "created") throw new PaymentCliError("A compra criada não ficou em revisão. Não confirme sem conferir o pedido.");
  return { id, status: order.status };
}

async function linkPurchaseFiscal(token: string, id: string, expectedTotalCents: number, input: ReturnType<typeof purchaseFiscalSchema.parse>) {
  const before = await coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(id)}`);
  if (before.status !== "created") throw new PaymentCliError("A nota só pode ser vinculada antes da confirmação da compra.");
  if (Math.round(Number(before.totalEstimated) * 100) !== expectedTotalCents || expectedTotalCents !== input.totalCents) {
    throw new PaymentCliError("O total do pedido difere do total confirmado da nota.");
  }
  if (before.invoiceAccessKey && before.invoiceAccessKey !== input.invoiceAccessKey) throw new PaymentCliError("O pedido já possui outra chave de NF-e.");
  await coalaPurchaseWrite(token, `/api/purchasing/orders/${encodeURIComponent(id)}`, "PATCH", purchaseFiscalPatch(input));
  const after = await coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(id)}`);
  if (after.invoiceAccessKey !== input.invoiceAccessKey || after.invoiceNumber !== input.invoiceNumber) {
    throw new PaymentCliError("O Coala não confirmou a mesma NF-e após o vínculo. Consulte o pedido; não repita automaticamente.");
  }
  return { id, invoiceNumber: after.invoiceNumber, invoiceAccessKey: after.invoiceAccessKey };
}

async function syncPurchaseExpense(token: string, id: string) {
  const order = await coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(id)}`);
  if (order.status !== "confirmed") throw new PaymentCliError("Confirme a compra antes de criar a despesa vinculada.");
  const result = await coalaPurchaseWrite(token, `/api/purchasing/orders/${encodeURIComponent(id)}/sync-expense`, "POST");
  const expenseId = typeof result.expenseId === "string" ? purchaseId(result.expenseId, "despesa") : "";
  if (!expenseId) throw new PaymentCliError("A sincronização não confirmou o identificador da despesa. Consulte pelo pedido; não repita automaticamente.");
  const expense = await coalaRead(token, paymentReadPath({ command: "document", collection: "expenses", id: expenseId }));
  const doc = expense.doc as Record<string, unknown> | undefined;
  if (!doc || doc.purchaseOrderId !== id || doc.paymentMethod !== "installments") {
    throw new PaymentCliError("A despesa retornada não preservou o pedido parcelado. Consulte antes de qualquer pagamento.");
  }
  return { expenseId, status: doc.status, installments: doc.installments };
}

async function confirmPurchase(token: string, id: string, invoiceAccessKey: string, expectedTotalCents: number) {
  const order = await coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(id)}`);
  const itemsResponse = await paymentCliFetch(`${COALA_URL}/api/purchasing/orders/${encodeURIComponent(id)}/items`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
  });
  if (!itemsResponse.ok) throw new PaymentCliError("Não foi possível conferir os itens da compra. Nenhuma confirmação foi feita.");
  const items = await paymentCliJson<Array<Record<string, unknown>>>(itemsResponse);
  if (order.status !== "created" || order.invoiceAccessKey !== invoiceAccessKey || items.length === 0
    || Math.round(Number(order.totalEstimated) * 100) !== expectedTotalCents
    || Math.round(items.reduce((sum, item) => sum + Number(item.totalOrdered ?? 0), 0) * 100) !== expectedTotalCents) {
    throw new PaymentCliError("A compra diverge da nota confirmada. Nenhuma confirmação foi feita.");
  }
  const result = await coalaPurchaseWrite(token, `/api/purchasing/orders/${encodeURIComponent(id)}/confirm`, "POST");
  const receiptId = typeof result.receiptId === "string" ? purchaseId(result.receiptId, "recebimento") : "";
  if (!receiptId) throw new PaymentCliError("A confirmação não retornou o recebimento esperado. Consulte o pedido; não confirme novamente.");
  const [confirmed, receipt] = await Promise.all([
    coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(id)}`),
    coalaPurchaseGet(token, `/api/purchasing/receipts/${encodeURIComponent(receiptId)}`),
  ]);
  if (confirmed.status !== "confirmed" || receipt.purchaseOrderId !== id || receipt.status !== "awaiting_delivery") {
    throw new PaymentCliError("A compra foi alterada, mas o estado do recebimento exige conferência manual. Não repita a confirmação.");
  }
  const expense = await syncPurchaseExpense(token, id);
  const taskResponse = await paymentCliFetch(`${COALA_URL}/api/tasks/purchase-receipt-sync`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      receiptId, purchaseOrderId: id, supplierId: String(confirmed.supplierId ?? ""),
      supplierName: String(confirmed.supplierName ?? ""), status: "awaiting_delivery",
      receiptMode: "future_delivery", expectedDate: String(confirmed.estimatedReceiptDate ?? confirmed.paymentDueDate ?? ""),
      notes: typeof confirmed.notes === "string" ? confirmed.notes : undefined,
    }),
  });
  return { id, status: confirmed.status, receiptId, receiptStatus: receipt.status, expenseId: expense.expenseId, taskSynced: taskResponse.ok };
}

async function attachPurchaseDocument(token: string, orderId: string, receiptId: string, role: "danfe" | "boletos", filePath: string) {
  const [order, receipt] = await Promise.all([
    coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(orderId)}`),
    coalaPurchaseGet(token, `/api/purchasing/receipts/${encodeURIComponent(receiptId)}`),
  ]);
  if (order.status !== "confirmed" || receipt.purchaseOrderId !== orderId || receipt.status !== "awaiting_delivery") {
    throw new PaymentCliError("O documento não corresponde a uma compra confirmada aguardando recebimento.");
  }
  const bytes = await readFile(filePath).catch(() => { throw new PaymentCliError("Não foi possível ler o PDF informado."); });
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new PaymentCliError("Envie um PDF válido de até 10 MB.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const form = new FormData();
  form.set("kind", "purchase-receipt");
  form.set("targetId", receiptId);
  form.set("file", new File([bytes], basename(filePath), { type: "application/pdf" }));
  const upload = await paymentCliFetch(`${COALA_URL}/api/uploads/operations`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  if (!upload.ok) throw new PaymentCliError(`O Coala recusou o documento da compra (HTTP ${upload.status}). Confira o recebimento antes de tentar novamente.`);
  const stored = await paymentCliJson<{ url?: unknown; path?: unknown }>(upload);
  if (typeof stored.url !== "string" || typeof stored.path !== "string") throw new PaymentCliError("O upload não confirmou o documento esperado. Consulte o recebimento; não repita automaticamente.");
  const existing = Array.isArray(order.fiscalDocuments) ? order.fiscalDocuments.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    return (item.role === "danfe" || item.role === "boletos") && typeof item.url === "string" && typeof item.path === "string"
      ? [{ role: item.role, url: item.url, path: item.path, filename: String(item.filename ?? "documento.pdf"), sha256: String(item.sha256 ?? "") }]
      : [];
  }) : [];
  const document = { role, url: stored.url, path: stored.path, filename: basename(filePath), sha256 };
  const fiscalDocuments = [...existing.filter((item) => item.role !== role), document];
  await coalaPurchaseWrite(token, `/api/purchasing/orders/${encodeURIComponent(orderId)}`, "PATCH", {
    fiscalDocuments,
    ...(role === "danfe" ? { documentUrl: stored.url } : { boletoDocumentUrl: stored.url }),
  });
  const after = await coalaPurchaseGet(token, `/api/purchasing/orders/${encodeURIComponent(orderId)}`);
  const confirmed = Array.isArray(after.fiscalDocuments) && after.fiscalDocuments.some((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).role === role
      && (entry as Record<string, unknown>).sha256 === sha256);
  if (!confirmed) throw new PaymentCliError("O PDF foi armazenado, mas o vínculo no pedido não foi confirmado. Confira antes de tentar novamente.");
  return { orderId, receiptId, role, sha256 };
}

async function mainLookupDocs(token: string, kind: string, value: string) {
  const structuredQuery = mainPaymentLookupQuery(kind, value);
  const response = await paymentCliFetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseClientConfig.projectId)}/databases/coala/documents:runQuery`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }), redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new PaymentCliError(`Consulta limitada do cadastro principal recusada (HTTP ${response.status}). Nenhuma escrita foi feita.`);
  const rows = await paymentCliJson<Array<{ document?: { name: string; fields: Record<string, Record<string, unknown>> } }>>(response);
  return rows.flatMap((row) => row.document ? [{
    ...(decodeFirestoreValue({ mapValue: { fields: row.document.fields } }) as Record<string, unknown>),
    id: row.document.name.split("/").at(-1),
  }] : []);
}

async function createSupplier(token: string, input: ReturnType<typeof supplierEntitySchema.parse>) {
  const existing = await mainLookupDocs(token, "entity-document", input.document);
  if (existing.length) throw new PaymentCliError("Já existe fornecedor com esse CNPJ. Use o cadastro encontrado; nenhuma criação foi feita.");
  const formattedDocument = `${input.document.slice(0, 2)}.${input.document.slice(2, 5)}.${input.document.slice(5, 8)}/${input.document.slice(8, 12)}-${input.document.slice(12)}`;
  const formattedZip = `${input.address.zipCode.slice(0, 5)}-${input.address.zipCode.slice(5)}`;
  const result = await coalaPurchaseWrite(token, "/api/registry/entities", "POST", {
    ...input,
    document: formattedDocument,
    cnpj: input.document,
    razao_social: input.name,
    nome_fantasia: input.fantasyName,
    address: { ...input.address, zipCode: formattedZip },
    status: "active",
  });
  const id = typeof result.id === "string" ? purchaseId(result.id, "fornecedor") : "";
  if (!id) throw new PaymentCliError("O cadastro não retornou o fornecedor esperado. Consulte pelo CNPJ antes de tentar novamente.");
  const stored = await coalaPurchaseGet(token, `/api/registry/entities/${encodeURIComponent(id)}`);
  const storedDocument = String(stored.documentNormalized ?? stored.cnpj ?? stored.document ?? "").replace(/\D/g, "");
  if (storedDocument !== input.document || stored.name !== input.name) {
    throw new PaymentCliError("O Coala não confirmou o mesmo fornecedor após o cadastro. Consulte pelo CNPJ; não repita automaticamente.");
  }
  return { id, name: stored.name, fantasyName: stored.fantasyName, document: formattedDocument };
}

function normalizeSearch(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function purchaseCatalogSearch(token: string, query: string) {
  const needle = normalizeSearch(query.trim());
  if (needle.length < 3 || needle.length > 80) throw new PaymentCliError("Busca de catálogo exige de 3 a 80 caracteres.");
  const resources = ["products", "base-products", "operational-categories"] as const;
  const results = await Promise.all(resources.map(async (resource) => {
    const response = await paymentCliFetch(`${COALA_URL}/api/registry/${resource}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new PaymentCliError(`O Coala recusou a leitura do catálogo ${resource} (HTTP ${response.status}).`);
    const rows = await paymentCliJson<Array<Record<string, unknown>>>(response);
    const keys = resource === "operational-categories"
      ? ["id", "name", "destination", "active"]
      : ["id", "baseProductId", "baseName", "name", "brand", "packageSize", "packageType", "unit", "operationalCategoryId", "operationalCategoryName", "isArchived"];
    return rows.filter((row) => normalizeSearch([row.name, row.baseName, row.brand, row.packageType].join(" ")).includes(needle))
      .slice(0, 25)
      .map((row) => Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])));
  }));
  return { products: results[0], baseProducts: results[1], operationalCategories: results[2], coverage: "Busca textual local sobre os catálogos devolvidos pelas APIs autenticadas; máximo de 25 correspondências por catálogo." };
}

async function coalaAnalyzeInbox(token: string, id: string) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/inbox/${encodeURIComponent(id)}/analyze`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou a análise (HTTP ${response.status}). Nenhuma conciliação foi feita.`);
  return paymentCliJson<Record<string, unknown>>(response);
}

async function coalaLinkInbox(token: string, id: string, input: Record<string, unknown>) {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/inbox/${encodeURIComponent(id)}/link`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input), cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala recusou a conciliação (HTTP ${response.status}). Nenhuma ordem de pagamento foi enviada.`);
  return paymentCliJson<Record<string, unknown>>(response);
}

function inspectMessage(payload: Record<string, unknown>) {
  const message = payload.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new PaymentCliError("O Coala não retornou a cobrança esperada.");
  return message as Record<string, unknown>;
}

export function existingExpenseLinkInput(message: Record<string, unknown>): Record<string, unknown> | undefined {
  const suggestion = message.existingExpenseSuggestion;
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) return undefined;
  const candidate = suggestion as Record<string, unknown>;
  if (candidate.status !== "suggested" || typeof candidate.expenseId !== "string" || !candidate.expenseId) return undefined;
  const installmentNumber = candidate.installmentNumber;
  return typeof installmentNumber === "number" && Number.isSafeInteger(installmentNumber) && installmentNumber > 0
    ? { expenseId: candidate.expenseId, installmentNumber }
    : { expenseId: candidate.expenseId };
}

async function linkInboxAfterAnalysis(token: string, id: string, message: Record<string, unknown>) {
  const input = existingExpenseLinkInput(message);
  if (!input) {
    throw new PaymentCliError(`A fatura ${id} não tem uma sugestão única de despesa para vínculo automático. Faça a conferência documental no Coala; nenhuma ordem de pagamento foi criada.`);
  }
  try {
    await coalaLinkInbox(token, id, input);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("(HTTP 409)")) throw error;
    const current = inspectMessage(await coalaRead(token, paymentReadPath({ command: "inspect", id })));
    if (current.linkedExpenseId) return current;
    throw new PaymentCliError(`A fatura ${id} mudou durante a conciliação e exige nova conferência no Coala. Nenhuma ordem de pagamento foi criada.`);
  }
  return inspectMessage(await coalaRead(token, paymentReadPath({ command: "inspect", id })));
}

async function reconcileVivo(token: string) {
  const items = [
    { id: "7c1c9815-0167-4132-a1c4-116c0ea8c20d", dueDate: "2026-10-25" },
    { id: "dd5b24aa-19f4-4550-a94a-83ab4e735232", dueDate: "2026-10-17" },
  ];
  const results: Array<Record<string, unknown>> = [];
  for (const item of items) {
    await coalaAnalyzeInbox(token, item.id);
    let message = inspectMessage(await coalaRead(token, paymentReadPath({ command: "inspect", id: item.id })));
    if (!message.linkedExpenseId) message = await linkInboxAfterAnalysis(token, item.id, message);
    if (!message.linkedExpenseId) throw new PaymentCliError(`A fatura ${item.id} não recebeu vínculo automático com a provisão.`);
    let request: Record<string, unknown> | undefined;
    if (message.paymentRequestId) {
      request = (await coalaGet(token)).find((row) => row.id === message.paymentRequestId);
      if (!request) throw new PaymentCliError(`A fatura ${item.id} já possui uma ordem ${String(message.paymentRequestId)}, mas ela não apareceu na consulta limitada. Nenhuma nova ordem foi criada.`);
    }
    const classification = message.classification && typeof message.classification === "object" && !Array.isArray(message.classification)
      ? message.classification as Record<string, unknown>
      : undefined;
    if (!request) {
      const barcode = String(classification?.barcode ?? "").replace(/\D/g, "");
      if (!barcode) throw new PaymentCliError(`A fatura ${item.id} foi conciliada, mas não tem linha digitável para preparar o pagamento.`);
      request = await coalaPrepareInbox(token, item.id, {
        scheduledFor: String(classification?.dueDate || item.dueDate),
        beneficiaryDocument: "02558157000405",
        barcode,
      });
    }
    if (request.status === "awaiting_financial_authorization") request = await coalaPost(token, String(request.id), "authorize");
    if (request.status === "ready_to_submit") request = await coalaPost(token, String(request.id), "submit");
    results.push({ id: item.id, expenseId: message.linkedExpenseId, paymentRequestId: request.id, status: request.status, interRequestId: request.interRequestId ?? null, bankStatus: request.bankStatus ?? null });
  }
  stdout.write(`${JSON.stringify({ results })}\n`);
}

async function login(email: string) {
  let password = await hiddenPassword();
  let credentials: Record<string, unknown>;
  try {
    credentials = await firebasePost(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseClientConfig.apiKey)}`,
      JSON.stringify({ email, password, returnSecureToken: true }), "application/json",
    );
  } finally {
    password = "";
  }
  if (String(credentials.email ?? "").toLowerCase() !== email.toLowerCase()
    || !credentials.idToken || !credentials.refreshToken) throw new PaymentCliError("O login não retornou a conta ou a sessão esperada.");
  await coalaGet(String(credentials.idToken));
  keychain("write", email, String(credentials.refreshToken));
  stdout.write("Login do Coala validado; sessão guardada no Chaves do macOS. Nenhuma senha foi gravada.\n");
}

export async function authenticateWithPassword(email: string, password: string) {
  const credentials = await firebasePost(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseClientConfig.apiKey)}`,
    JSON.stringify({ email, password, returnSecureToken: true }), "application/json",
  );
  if (String(credentials.email ?? "").toLowerCase() !== email.toLowerCase()
    || !credentials.idToken) throw new PaymentCliError("O login não retornou a conta ou a sessão esperada.");
  return String(credentials.idToken);
}

async function temporaryToken(email: string) {
  let password = await hiddenPassword();
  try {
    return await authenticateWithPassword(email, password);
  } finally {
    password = "";
  }
}

async function renewedToken(email: string) {
  const refreshToken = keychain("read", email);
  const credentials = await firebasePost(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseClientConfig.apiKey)}`,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    "application/x-www-form-urlencoded",
  );
  if (!credentials.id_token || !credentials.refresh_token) throw new PaymentCliError("A renovação não retornou uma sessão válida.");
  if (String(credentials.user_id ?? "").trim() === "") throw new PaymentCliError("A renovação não retornou a identidade do usuário.");
  const account = await firebasePost(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseClientConfig.apiKey)}`,
    JSON.stringify({ idToken: credentials.id_token }),
    "application/json",
  ) as { users?: Array<{ email?: string }> };
  if (account.users?.[0]?.email?.toLowerCase() !== email) {
    throw new PaymentCliError("A sessão guardada não pertence ao e-mail informado. Faça login novamente.");
  }
  if (String(credentials.refresh_token) !== refreshToken) keychain("write", email, String(credentials.refresh_token));
  return String(credentials.id_token);
}

// Reuso interno por operações locais autorizadas; nunca imprimir o token retornado ao callback.
export async function withCoalaSession<T>(email: string, operation: (token: string) => Promise<T>): Promise<T> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentCliError("E-mail inválido.");
  return operation(await renewedToken(email.toLowerCase()));
}

async function commandToken(email: string) {
  const memorySession = option("memory-session");
  if (memorySession) {
    if (process.argv.includes("--temporary-session")) throw new PaymentCliError("Escolha sessão temporária ou sessão em memória, não ambas.");
    return tokenFromMemorySession(memorySession, email);
  }
  return process.argv.includes("--temporary-session") ? temporaryToken(email) : renewedToken(email);
}

async function serveMemorySession(email: string) {
  const name = requireOption("memory-session");
  const minutes = option("minutes") ? Number(option("minutes")) : 30;
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 60) throw new PaymentCliError("Informe --minutes entre 1 e 60.");
  const token = await temporaryToken(email);
  await coalaGet(token);
  const session = await startMemorySessionServer({ name, email, token, ttlMs: minutes * 60_000 });
  stdout.write(`${JSON.stringify({ session: name, status: "ready", expiresAt: session.expiresAt })}\n`);
  const stop = () => void session.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  await session.closed;
  stdout.write(`${JSON.stringify({ session: name, status: "closed" })}\n`);
}

function printStatus(request: Record<string, unknown>) {
  const barcode = request.barcodeSnapshot as Record<string, unknown> | undefined;
  stdout.write(`${JSON.stringify({
    id: request.id, status: request.status, amount: request.amount,
    requestedSettlementAmount: request.requestedSettlementAmount ?? null,
    requestedLateChargeAmount: request.requestedLateChargeAmount ?? null,
    submissionAttemptCount: request.submissionAttemptCount ?? null,
    sourceId: request.sourceId ?? null, expenseId: request.expenseId ?? null,
    scheduledFor: barcode?.scheduledFor ?? null,
    barcodeLast8: typeof barcode?.code === "string" ? barcode.code.slice(-8) : null,
    interRequestId: request.interRequestId ?? null, bankStatus: request.bankStatus ?? null,
    bankScheduledFor: request.bankScheduledFor ?? null,
    bankPreflight: request.bankPreflight ?? null,
  })}\n`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "help") return help();
  if (!["login", "session", "find", "inspect", "analyze", "reconcile-vivo", "document", "lookup", "main-lookup", "purchase-items", "purchase-options", "purchase-categories", "purchase-units", "purchase-catalog-search", "supplier-create", "purchase-create", "purchase-fiscal-link", "purchase-confirm", "purchase-sync-expense", "purchase-document-attach", "expense-boleto-attach", "expense-boleto-prepare", "requests", "status", "refresh", "cancel-replace", "prepare", "authorize", "send", "retry-send", "adjust-overdue", "send-adjusted"].includes(command)) throw new PaymentCliError("Comando desconhecido. Use --help.");
  const email = command === "login" ? await loginEmail() : requireOption("email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentCliError("E-mail inválido.");
  if (command === "login") return login(email);
  if (command === "session") return serveMemorySession(email);
  if (command === "reconcile-vivo") {
    if (!process.argv.includes("--confirm-financial-actions")) {
      throw new PaymentCliError("reconcile-vivo analisa, vincula, autoriza e envia pagamentos. Repita com --confirm-financial-actions somente após conferir as duas cobranças.");
    }
    return reconcileVivo(await commandToken(email));
  }
  if (command === "requests") {
    const cents = Number(requireOption("amount-cents"));
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new PaymentCliError("Valor inválido.");
    const rows = await coalaGet(await commandToken(email));
    const requests = rows.filter((row) => Math.round(Number(row.amount) * 100) === cents)
      .map((doc) => summarizePaymentRead("document", { doc }));
    stdout.write(`${JSON.stringify({ requests, scanned: rows.length, limit: 100,
      coverage: "Até 100 solicitações recentes pela API autorizada; ausência nesta lista não prova inexistência histórica." })}\n`);
    return;
  }
  if (command === "lookup") {
    const kind = requireOption("kind");
    const structuredQuery = paymentLookupQuery(kind, requireOption("value"));
    const token = await commandToken(email);
    // runQuery é uma leitura, apesar do verbo HTTP POST. Não usar credenciais Admin/IAM.
    const response = await paymentCliFetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseClientConfig.projectId)}/databases/coala-financeiro/documents:runQuery`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery }), redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new PaymentCliError(`Consulta filtrada recusada pelas permissões do Firestore (HTTP ${response.status}). Nenhuma escrita foi feita.`);
    const rows = await paymentCliJson<Array<{ document?: { name: string; fields: Record<string, Record<string, unknown>> } }>>(response);
    const docs = rows.flatMap((row) => row.document ? [{
      ...(decodeFirestoreValue({ mapValue: { fields: row.document.fields } }) as Record<string, unknown>),
      id: row.document.name.split("/").at(-1),
    }] : []);
    const results = docs.slice(0, 25).map((doc) => summarizePaymentRead("document", { doc }));
    stdout.write(`${JSON.stringify({ results, truncated: docs.length > 25,
      coverage: "Busca exata filtrada, no máximo 25 resultados; não comprova ausência em outros campos, códigos equivalentes ou coleções." })}\n`);
    return;
  }
  if (command === "main-lookup") {
    const token = await commandToken(email);
    const docs = await mainLookupDocs(token, requireOption("kind"), requireOption("value"));
    stdout.write(`${JSON.stringify({ results: docs.slice(0, 25).map(summarizeMainPaymentLookup), truncated: docs.length > 25,
      coverage: "Busca exata e limitada no cadastro principal; resultado vazio não comprova ausência por outro campo." })}\n`);
    return;
  }
  if (command === "purchase-items") {
    const id = requireOption("id");
    if (!/^[a-zA-Z0-9_-]{1,170}$/.test(id)) throw new PaymentCliError("ID de compra inválido.");
    const response = await paymentCliFetch(`${COALA_URL}/api/purchasing/orders/${encodeURIComponent(id)}/items`, {
      headers: { Authorization: `Bearer ${await commandToken(email)}` }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new PaymentCliError(`O Coala recusou a leitura dos itens da compra (HTTP ${response.status}).`);
    const rows = await paymentCliJson<Array<Record<string, unknown>>>(response);
    const keys = ["id", "baseItemId", "productId", "itemName", "operationalCategoryId", "operationalCategoryName", "itemDestination", "unit", "purchaseUnitType", "purchaseUnitLabel", "quantityOrdered", "unitPriceOrdered", "discountOrdered", "totalOrdered", "entryType", "itemTreatment"];
    stdout.write(`${JSON.stringify({ items: rows.map((row) => Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]))) })}\n`);
    return;
  }
  if (command === "purchase-options") {
    const response = await paymentCliFetch(`${COALA_URL}/api/purchasing/classification-options`, {
      headers: { Authorization: `Bearer ${await commandToken(email)}` }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new PaymentCliError(`O Coala recusou as opções financeiras da compra (HTTP ${response.status}).`);
    const payload = await paymentCliJson<{ accountPlans?: Array<Record<string, unknown>>; resultCenters?: Array<Record<string, unknown>> }>(response);
    const compact = (rows: Array<Record<string, unknown>> | undefined) => (rows ?? []).map((row) => ({
      id: row.id, name: row.name, parentId: row.parentId ?? null, active: row.active ?? true,
    }));
    stdout.write(`${JSON.stringify({ accountPlans: compact(payload.accountPlans), resultCenters: compact(payload.resultCenters) })}\n`);
    return;
  }
  if (command === "purchase-categories") {
    const response = await paymentCliFetch(`${COALA_URL}/api/registry/operational-categories`, {
      headers: { Authorization: `Bearer ${await commandToken(email)}` }, cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new PaymentCliError(`O Coala recusou as categorias operacionais (HTTP ${response.status}).`);
    const rows = await paymentCliJson<Array<Record<string, unknown>>>(response);
    stdout.write(`${JSON.stringify({ categories: rows.slice(0, 100).map((row) => ({ id: row.id, name: row.name, destination: row.destination, active: row.active ?? true })), truncated: rows.length > 100 })}\n`);
    return;
  }
  if (command === "purchase-units") {
    const response = await paymentCliFetch(`${COALA_URL}/api/client/bootstrap?collections=kiosks`, {
      headers: { Authorization: `Bearer ${await commandToken(email)}` }, cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new PaymentCliError(`O Coala recusou as unidades acessíveis (HTTP ${response.status}).`);
    const payload = await paymentCliJson<{ kiosks?: Array<Record<string, unknown>> }>(response);
    stdout.write(`${JSON.stringify({ units: (payload.kiosks ?? []).slice(0, 100).map((row) => ({ id: row.id, name: row.name })), truncated: (payload.kiosks?.length ?? 0) > 100 })}\n`);
    return;
  }
  if (command === "purchase-catalog-search") {
    stdout.write(`${JSON.stringify(await purchaseCatalogSearch(await commandToken(email), requireOption("query")))}\n`);
    return;
  }
  if (command === "supplier-create") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente o cadastro do fornecedor com --confirm-financial-actions.");
    const parsed = supplierEntitySchema.safeParse(await jsonFile(requireOption("manifest")));
    if (!parsed.success) throw new PaymentCliError(`Manifesto do fornecedor inválido: ${parsed.error.issues[0]?.message ?? "revise os campos"}`);
    stdout.write(`${JSON.stringify(await createSupplier(await commandToken(email), parsed.data))}\n`);
    return;
  }
  if (command === "purchase-create") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente o cadastro da compra com --confirm-financial-actions.");
    const parsed = purchaseRegistrationSchema.safeParse(await jsonFile(requireOption("manifest")));
    if (!parsed.success) throw new PaymentCliError(`Manifesto da compra inválido: ${parsed.error.issues[0]?.message ?? "revise os campos"}`);
    stdout.write(`${JSON.stringify(await createPurchase(await commandToken(email), parsed.data))}\n`);
    return;
  }
  if (command === "purchase-fiscal-link") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente o vínculo da NF-e com --confirm-financial-actions.");
    const id = purchaseId(requireOption("id"));
    const expectedTotalCents = Number(requireOption("expected-total-cents"));
    const parsed = purchaseFiscalSchema.safeParse(await jsonFile(requireOption("manifest")));
    if (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents <= 0 || !parsed.success) throw new PaymentCliError("Dados confirmados da NF-e inválidos.");
    stdout.write(`${JSON.stringify(await linkPurchaseFiscal(await commandToken(email), id, expectedTotalCents, parsed.data))}\n`);
    return;
  }
  if (command === "purchase-confirm") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente a compra e a despesa com --confirm-financial-actions.");
    const id = purchaseId(requireOption("id"));
    const invoiceAccessKey = requireOption("invoice-access-key").replace(/\D/g, "");
    const expectedTotalCents = Number(requireOption("expected-total-cents"));
    if (!/^\d{44}$/.test(invoiceAccessKey) || !Number.isSafeInteger(expectedTotalCents) || expectedTotalCents <= 0) throw new PaymentCliError("Chave ou total da NF-e inválido.");
    stdout.write(`${JSON.stringify(await confirmPurchase(await commandToken(email), id, invoiceAccessKey, expectedTotalCents))}\n`);
    return;
  }
  if (command === "purchase-sync-expense") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente a criação da despesa com --confirm-financial-actions.");
    const id = purchaseId(requireOption("id"));
    stdout.write(`${JSON.stringify(await syncPurchaseExpense(await commandToken(email), id))}\n`);
    return;
  }
  if (command === "purchase-document-attach") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente o vínculo do documento com --confirm-financial-actions.");
    const id = purchaseId(requireOption("id"));
    const receiptId = purchaseId(requireOption("receipt-id"), "recebimento");
    const role = requireOption("role");
    if (role !== "danfe" && role !== "boletos") throw new PaymentCliError("Papel do documento inválido.");
    stdout.write(`${JSON.stringify(await attachPurchaseDocument(await commandToken(email), id, receiptId, role, requireOption("file")))}\n`);
    return;
  }
  if (command === "expense-boleto-attach") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente o vínculo do boleto com --confirm-financial-actions.");
    const expenseId = requireOption("expense-id");
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(expenseId)) throw new PaymentCliError("ID da despesa inválido.");
    const parsed = expenseBoletoSchema.safeParse({
      installmentNumber: requireOption("installment-number"), barcode: requireOption("barcode"),
      amountCents: requireOption("amount-cents"), dueDate: requireOption("due-date"),
      competenceMonth: requireOption("competence-month"), beneficiaryDocument: requireOption("beneficiary-document"),
      documentReference: requireOption("document-reference"), confirmed: true,
    });
    if (!parsed.success) throw new PaymentCliError("Os dados confirmados do boleto são inválidos.");
    try { validateExpenseBoleto(parsed.data); } catch { throw new PaymentCliError("A linha digitável diverge do valor ou vencimento confirmados."); }
    const result = await coalaAttachExpenseBoleto(await commandToken(email), expenseId, parsed.data, requireOption("file"));
    stdout.write(`${JSON.stringify({ attached: true, expenseId, installmentNumber: parsed.data.installmentNumber, sha256: result.sha256, filename: result.filename })}\n`);
    return;
  }
  if (command === "expense-boleto-prepare") {
    if (!process.argv.includes("--confirm-financial-actions")) throw new PaymentCliError("Confirme explicitamente a preparação com --confirm-financial-actions.");
    const expenseId = requireOption("expense-id");
    const installmentNumber = Number(requireOption("installment-number"));
    const amountCents = Number(requireOption("amount-cents"));
    const scheduledFor = requireOption("scheduled-for");
    const beneficiaryDocument = requireOption("beneficiary-document").replace(/\D/g, "");
    const barcode = requireOption("barcode").replace(/[.\s-]/g, "");
    if (!/^[a-zA-Z0-9_-]{1,150}$/.test(expenseId) || !Number.isSafeInteger(installmentNumber) || installmentNumber <= 0) throw new PaymentCliError("Despesa ou parcela inválida.");
    const request = await coalaPrepareExpenseBoleto(await commandToken(email), expenseId, installmentNumber, scheduledFor);
    if (request.installmentNumber !== installmentNumber) throw new PaymentCliError("O Coala confirmou outra parcela. Consulte a despesa; não repita automaticamente.");
    validatePaymentCliAction({ request, action: "authorize", amountCents, scheduledFor, beneficiaryDocument, expenseId, barcode });
    return printStatus(request);
  }
  if (command === "analyze") {
    const id = requireOption("id");
    if (!/^[a-zA-Z0-9_-]{8,170}$/.test(id)) throw new PaymentCliError("ID da cobrança inválido.");
    const result = await coalaAnalyzeInbox(await commandToken(email), id);
    stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (["find", "inspect", "document"].includes(command)) {
    const path = paymentReadPath({ command, query: option("query"), view: option("view"),
      cursor: option("cursor"), collection: option("collection"), id: option("id") });
    const token = await commandToken(email);
    const result = await coalaRead(token, path);
    stdout.write(`${JSON.stringify(summarizePaymentRead(command, result))}\n`);
    return;
  }
  const id = requireOption("id");
  if (!/^[a-zA-Z0-9_-]{8,170}$/.test(id)) throw new PaymentCliError("ID da solicitação inválido.");
  const token = await commandToken(email);
  if (command === "prepare") {
    const amountCents = Number(requireOption("amount-cents"));
    const scheduledFor = requireOption("scheduled-for");
    const beneficiaryDocument = requireOption("beneficiary-document").replace(/\D/g, "");
    const expenseId = requireOption("expense-id");
    const barcode = requireOption("barcode").replace(/[.\s-]/g, "");
    const body = await coalaRead(token, paymentReadPath({ command: "inspect", id }));
    const message = body.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) throw new PaymentCliError("O Coala não retornou a cobrança esperada. Nenhuma ação foi feita.");
    validatePaymentCliPreparation({ message: message as Record<string, unknown>, inboxMessageId: id,
      amountCents, scheduledFor, beneficiaryDocument, expenseId, barcode });
    const current = await coalaPrepareInbox(token, id, { scheduledFor, beneficiaryDocument, barcode });
    try {
      if (current.sourceId !== id) throw new Error("source");
      validatePaymentCliAction({ request: current, action: "authorize", amountCents,
        scheduledFor, beneficiaryDocument, expenseId, barcode });
    } catch {
      throw new PaymentCliError("O Coala não confirmou os dados esperados após preparar. Consulte a solicitação; não repita o comando automaticamente.");
    }
    return printStatus(current);
  }
  const request = (await coalaGet(token)).find((item) => item.id === id);
  if (!request) throw new PaymentCliError("A solicitação não apareceu entre as 100 mais recentes da consulta autenticada. Consulte pelo Coala; nenhuma ação foi feita.");
  if (command === "status") return printStatus(request);
  if (command === "refresh") return printStatus(await coalaPost(token, id, "refresh"));

  if (command === "cancel-replace") {
    if (!process.argv.includes("--confirm-financial-actions")) {
      throw new PaymentCliError("Confirme explicitamente o cancelamento no banco e a substituição com --confirm-financial-actions.");
    }
    const amountCents = Number(requireOption("amount-cents"));
    const currentScheduledFor = requireOption("current-scheduled-for");
    const scheduledFor = requireOption("scheduled-for");
    const beneficiaryDocument = requireOption("beneficiary-document").replace(/\D/g, "");
    const expenseId = requireOption("expense-id");
    const barcode = requireOption("barcode").replace(/[.\s-]/g, "");
    validatePaymentCliCancellation({ request, amountCents, currentScheduledFor,
      replacementScheduledFor: scheduledFor, beneficiaryDocument, expenseId, barcode });
    const replacement = await coalaCancelAndReplace(token, id, scheduledFor);
    validatePaymentCliAction({ request: replacement, action: "authorize", amountCents,
      scheduledFor, beneficiaryDocument, expenseId, barcode });
    return printStatus(replacement);
  }

  const amountCents = Number(requireOption("amount-cents"));
  const scheduledFor = requireOption("scheduled-for");
  const beneficiaryDocument = requireOption("beneficiary-document").replace(/\D/g, "");
  const expenseId = requireOption("expense-id");
  const barcode = requireOption("barcode").replace(/[.\s-]/g, "");
  if (command === "adjust-overdue") {
    const settlementAmountCents = Number(requireOption("settlement-amount-cents"));
    const lateChargeAmountCents = Number(requireOption("late-charge-cents"));
    const sourceAttachmentId = requireOption("source-attachment-id");
    const sourceAttachmentSha256 = requireOption("source-attachment-sha256").toLowerCase();
    const revision = validateOverdueSettlementCliRevision({ request, principalAmountCents: amountCents,
      settlementAmountCents, lateChargeAmountCents, scheduledFor, beneficiaryDocument, expenseId,
      barcode, sourceAttachmentId, sourceAttachmentSha256 });
    const current = await coalaAuthorizeOverdueRevision(token, id, revision);
    try {
      validatePaymentCliAction({ request: current, action: "send-adjusted", amountCents,
        scheduledFor, beneficiaryDocument, expenseId, barcode, settlementAmountCents,
        lateChargeAmountCents, sourceAttachmentId, sourceAttachmentSha256 });
    } catch {
      throw new PaymentCliError("O Coala não confirmou a revisão esperada do boleto vencido. Consulte o status; não repita o comando automaticamente.");
    }
    return printStatus(current);
  }
  const settlementAmountCents = command === "send-adjusted" ? Number(requireOption("settlement-amount-cents")) : undefined;
  const lateChargeAmountCents = command === "send-adjusted" ? Number(requireOption("late-charge-cents")) : undefined;
  const sourceAttachmentId = command === "send-adjusted" ? requireOption("source-attachment-id") : undefined;
  const sourceAttachmentSha256 = command === "send-adjusted" ? requireOption("source-attachment-sha256").toLowerCase() : undefined;
  validatePaymentCliAction({ request, action: command as "authorize" | "send" | "retry-send" | "send-adjusted", amountCents,
    scheduledFor, beneficiaryDocument, expenseId, barcode, settlementAmountCents, lateChargeAmountCents, sourceAttachmentId, sourceAttachmentSha256 });
  const current = await coalaPost(token, id, command === "authorize" ? "authorize" : "submit");
  printStatus(current);
  if ((command === "send" || command === "retry-send" || command === "send-adjusted") && !current.interRequestId) throw new PaymentCliError("A resposta não confirmou identificador do Inter. Consulte o status antes de qualquer nova tentativa.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => {
  process.stderr.write(`${paymentCliErrorMessage(error)}\n`);
  process.exitCode = 1;
});
