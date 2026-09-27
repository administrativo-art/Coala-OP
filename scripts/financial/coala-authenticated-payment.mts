import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { firebaseClientConfig } from "../../src/lib/firebase-client-config";
import { validatePaymentCliAction } from "./payment-cli-contract";
import { paymentReadPath, summarizePaymentRead } from "./payment-cli-read-contract";
import { paymentLookupQuery, decodeFirestoreValue } from "./payment-cli-query-contract";
import { PaymentCliError, paymentCliErrorMessage, paymentCliFetch, paymentCliJson } from "./payment-cli-transport";

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
  npx tsx scripts/financial/coala-authenticated-payment.mts find --email EMAIL --query TEXTO --view work|identified [--cursor CURSOR]
  npx tsx scripts/financial/coala-authenticated-payment.mts inspect --email EMAIL --id INBOX_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts document --email EMAIL --collection expenses|bankPaymentRequests|transactions --id ID
  npx tsx scripts/financial/coala-authenticated-payment.mts lookup --email EMAIL --kind expense-amount|expense-supplier|expense-account|expense-account-center|expense-unit-month|expense-center-due-month --value VALOR
  npx tsx scripts/financial/coala-authenticated-payment.mts requests --email EMAIL --amount-cents CENTAVOS
  npx tsx scripts/financial/coala-authenticated-payment.mts status --email EMAIL --id REQUEST_ID
  npx tsx scripts/financial/coala-authenticated-payment.mts authorize --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CPF_OU_CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO
  npx tsx scripts/financial/coala-authenticated-payment.mts send --email EMAIL --id REQUEST_ID --amount-cents CENTAVOS --scheduled-for AAAA-MM-DD --beneficiary-document CPF_OU_CNPJ --expense-id EXPENSE_ID --barcode CODIGO_COMPLETO

O login pede a senha diretamente no terminal e guarda somente o refresh token no Chaves do macOS.
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

async function coalaPost(token: string, id: string, action: "authorize" | "submit") {
  const response = await paymentCliFetch(`${COALA_URL}/api/financial/payment-requests/${encodeURIComponent(id)}/${action}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new PaymentCliError(`O Coala não confirmou ${action} (HTTP ${response.status}). O resultado pode ser incerto; consulte o status antes de tentar novamente.`);
  const body = await paymentCliJson<{ request?: Record<string, unknown> }>(response);
  if (body?.request?.id !== id) throw new PaymentCliError(`O Coala não confirmou a solicitação esperada após ${action}. Consulte o status; não repita o comando automaticamente.`);
  return body.request;
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

function printStatus(request: Record<string, unknown>) {
  const barcode = request.barcodeSnapshot as Record<string, unknown> | undefined;
  stdout.write(`${JSON.stringify({
    id: request.id, status: request.status, amount: request.amount,
    sourceId: request.sourceId ?? null, expenseId: request.expenseId ?? null,
    scheduledFor: barcode?.scheduledFor ?? null,
    barcodeLast8: typeof barcode?.code === "string" ? barcode.code.slice(-8) : null,
    interRequestId: request.interRequestId ?? null, bankStatus: request.bankStatus ?? null,
    bankScheduledFor: request.bankScheduledFor ?? null,
  })}\n`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "help") return help();
  if (!["login", "find", "inspect", "document", "lookup", "requests", "status", "authorize", "send"].includes(command)) throw new PaymentCliError("Comando desconhecido. Use --help.");
  const email = command === "login" ? await loginEmail() : requireOption("email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentCliError("E-mail inválido.");
  if (command === "login") return login(email);
  if (command === "requests") {
    const cents = Number(requireOption("amount-cents"));
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new PaymentCliError("Valor inválido.");
    const rows = await coalaGet(await renewedToken(email));
    const requests = rows.filter((row) => Math.round(Number(row.amount) * 100) === cents)
      .map((doc) => summarizePaymentRead("document", { doc }));
    stdout.write(`${JSON.stringify({ requests, scanned: rows.length, limit: 100,
      coverage: "Até 100 solicitações recentes pela API autorizada; ausência nesta lista não prova inexistência histórica." })}\n`);
    return;
  }
  if (command === "lookup") {
    const kind = requireOption("kind");
    const structuredQuery = paymentLookupQuery(kind, requireOption("value"));
    const token = await renewedToken(email);
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
  if (["find", "inspect", "document"].includes(command)) {
    const path = paymentReadPath({ command, query: option("query"), view: option("view"),
      cursor: option("cursor"), collection: option("collection"), id: option("id") });
    const token = await renewedToken(email);
    const result = await coalaRead(token, path);
    stdout.write(`${JSON.stringify(summarizePaymentRead(command, result))}\n`);
    return;
  }
  const id = requireOption("id");
  if (!/^[a-zA-Z0-9_-]{8,170}$/.test(id)) throw new PaymentCliError("ID da solicitação inválido.");
  const token = await renewedToken(email);
  const request = (await coalaGet(token)).find((item) => item.id === id);
  if (!request) throw new PaymentCliError("A solicitação não apareceu entre as 100 mais recentes da consulta autenticada. Consulte pelo Coala; nenhuma ação foi feita.");
  if (command === "status") return printStatus(request);

  const amountCents = Number(requireOption("amount-cents"));
  const scheduledFor = requireOption("scheduled-for");
  const beneficiaryDocument = requireOption("beneficiary-document").replace(/\D/g, "");
  const expenseId = requireOption("expense-id");
  const barcode = requireOption("barcode").replace(/[.\s-]/g, "");
  validatePaymentCliAction({ request, action: command as "authorize" | "send", amountCents,
    scheduledFor, beneficiaryDocument, expenseId, barcode });
  const current = await coalaPost(token, id, command === "authorize" ? "authorize" : "submit");
  printStatus(current);
  if (command === "send" && !current.interRequestId) throw new PaymentCliError("A resposta não confirmou identificador do Inter. Consulte o status antes de qualquer nova tentativa.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => {
  process.stderr.write(`${paymentCliErrorMessage(error)}\n`);
  process.exitCode = 1;
});
