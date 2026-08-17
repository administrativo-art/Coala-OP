import { execFileSync } from "node:child_process";
import https from "node:https";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import axios from "axios";

const PROJECT_ID = "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const BASE_URL = "https://cdpj.partners.bancointer.com.br";
const TOKEN_URL = `${BASE_URL}/oauth/v2/token`;
const PAYMENT_PATH = "/banking/v2/pagamento";
const PAYMENT_DATE = "2026-08-20";
const CONFIRMATION = "CONFIRMO-AGENDAMENTO-DARES-CT-2026-07-476.45-2026-08-20";
let currentStage = "INICIALIZACAO";

const PAYMENTS = [
  {
    expenseId: "dare-icms-antecipado-ct-matriz-2026-07-177445139",
    document: "DARE ICMS antecipado CT Matriz 07/2026",
    ourNumber: "177445139",
    barcode: "856700000040054000102001000000000000001774451395",
    amount: "405.40",
  },
  {
    expenseId: "dare-icms-antecipado-ct-filial-003-2026-07-177445641",
    document: "DARE ICMS antecipado CT Filial 003 07/2026",
    ourNumber: "177445641",
    barcode: "856800000007710500102003000000000000001774456410",
    amount: "71.05",
  },
];

function abortSafely(error) {
  const detail = error?.response?.data;
  console.error(JSON.stringify({
    etapa: currentStage,
    resultado: "ABORTADO",
    httpStatus: error?.response?.status ?? null,
    codigo: error?.code ?? null,
    mensagem: error instanceof Error ? error.message : "Falha inesperada.",
    resposta: typeof detail === "object" && detail !== null
      ? {
          title: detail.title ?? null,
          status: detail.status ?? null,
          detail: detail.detail ?? detail.message ?? null,
        }
      : null,
  }, null, 2));
  process.exit(1);
}

process.on("uncaughtException", abortSafely);
process.on("unhandledRejection", abortSafely);

function modulo10(value) {
  let sum = 0;
  let weight = 2;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const product = Number(value[index]) * weight;
    sum += Math.floor(product / 10) + (product % 10);
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function modulo11Arrecadacao(value) {
  let sum = 0;
  let weight = 2;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    sum += Number(value[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  if (remainder === 0 || remainder === 1) return 0;
  if (remainder === 10) return 1;
  return 11 - remainder;
}

function validatePayment(payment) {
  const line = payment.barcode;
  if (!/^8\d{47}$/.test(line)) throw new Error(`${payment.document}: linha digitável inválida.`);
  const referenceDigit = line[2];
  const calculateDigit = referenceDigit === "6" || referenceDigit === "7"
    ? modulo10
    : referenceDigit === "8" || referenceDigit === "9"
      ? modulo11Arrecadacao
      : null;
  if (!calculateDigit) throw new Error(`${payment.document}: referência de arrecadação inválida.`);

  const blocks = Array.from({ length: 4 }, (_, index) => line.slice(index * 12, (index + 1) * 12));
  for (const [index, block] of blocks.entries()) {
    if (calculateDigit(block.slice(0, 11)) !== Number(block[11])) {
      throw new Error(`${payment.document}: dígito verificador inválido no bloco ${index + 1}.`);
    }
  }
  const barcode = blocks.map((block) => block.slice(0, 11)).join("");
  if (calculateDigit(`${barcode.slice(0, 3)}${barcode.slice(4)}`) !== Number(barcode[3])) {
    throw new Error(`${payment.document}: dígito verificador geral inválido.`);
  }
  if (referenceDigit !== "6" && referenceDigit !== "8") {
    throw new Error(`${payment.document}: o código não contém valor efetivo para conferência.`);
  }
  const embeddedAmount = (Number(barcode.slice(4, 15)) / 100).toFixed(2);
  if (embeddedAmount !== payment.amount) {
    throw new Error(`${payment.document}: valor embutido ${embeddedAmount} diverge de ${payment.amount}.`);
  }
}

function accessSecret(name, { optional = false } = {}) {
  try {
    return execFileSync(
      "gcloud",
      ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT_ID}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    if (optional) return "";
    throw error;
  }
}

function loadCredentials() {
  const credentials = {
    clientId: accessSecret("INTER_CLIENT_ID"),
    clientSecret: accessSecret("INTER_CLIENT_SECRET"),
    certificate: Buffer.from(accessSecret("INTER_CERTIFICATE_BASE64"), "base64"),
    privateKey: Buffer.from(accessSecret("INTER_PRIVATE_KEY_BASE64"), "base64"),
    accountNumber: accessSecret("INTER_ACCOUNT_NUMBER", { optional: true }),
  };
  if (!credentials.clientId || !credentials.clientSecret || !credentials.certificate.length || !credentials.privateKey.length) {
    throw new Error("As credenciais do Banco Inter estão incompletas.");
  }
  return credentials;
}

function agent(credentials) {
  return new https.Agent({
    cert: credentials.certificate,
    key: credentials.privateKey,
    keepAlive: false,
    minVersion: "TLSv1.2",
  });
}

async function accessToken(credentials, scope) {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
    scope,
  });
  const response = await axios.post(TOKEN_URL, body.toString(), {
    httpsAgent: agent(credentials),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });
  if (!response.data?.access_token) throw new Error(`O Inter não retornou access_token para ${scope}.`);
  return response.data.access_token;
}

function interClient(credentials, token) {
  return axios.create({
    baseURL: BASE_URL,
    httpsAgent: agent(credentials),
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(credentials.accountNumber ? { "x-conta-corrente": credentials.accountNumber } : {}),
    },
  });
}

function asPaymentList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.content)) return data.content;
  return [];
}

function normalizeDate(value) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}|^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  if (match[1]) return `${match[3]}-${match[2]}-${match[1]}`;
  return match[0];
}

function isActiveStatus(value) {
  const status = String(value ?? "").toUpperCase();
  return !["CANCELADO", "CANCELADA", "REJEITADO", "REJEITADA", "EXCLUIDO", "EXCLUIDA"].includes(status);
}

async function findDuplicates(client, payment) {
  const response = await client.get(PAYMENT_PATH, {
    params: { dataInicio: PAYMENT_DATE, dataFim: PAYMENT_DATE, filtrarDataPor: "PAGAMENTO" },
  });
  return asPaymentList(response.data).filter((record) => {
    const amount = Number(record.valorPago ?? record.valorNominal ?? record.valorPagar);
    const date = normalizeDate(record.dataPagamento ?? record.dataVencimentoDigitada ?? record.dataVencimentoTitulo);
    return amount === Number(payment.amount) && date === PAYMENT_DATE && isActiveStatus(record.statusPagamento ?? record.status);
  });
}

for (const payment of PAYMENTS) validatePayment(payment);
const executeRequested = process.argv.includes("--execute");
const credentials = loadCredentials();
currentStage = "AUTENTICACAO_INTER";
const token = await accessToken(
  credentials,
  executeRequested ? "pagamento-boleto.read pagamento-boleto.write" : "pagamento-boleto.read",
);
const client = interClient(credentials, token);
currentStage = "PREFLIGHT_INTER";
const duplicateChecks = await Promise.all(PAYMENTS.map((payment) => findDuplicates(client, payment)));
const duplicates = PAYMENTS.flatMap((payment, index) => duplicateChecks[index].map((record) => ({ payment, record })));

if (duplicates.length > 0) {
  console.log(JSON.stringify({
    etapa: "PREFLIGHT",
    seguroParaEnviar: false,
    motivo: "O Inter já possui pagamento ativo com a mesma data e valor de uma ou mais guias.",
    duplicidades: duplicates.map(({ payment, record }) => ({
      documento: payment.document,
      codigoTransacao: record.codigoTransacao ?? null,
      statusPagamento: record.statusPagamento ?? record.status ?? null,
      dataPagamento: normalizeDate(record.dataPagamento) ?? record.dataPagamento ?? null,
      valor: record.valorPago ?? record.valorNominal ?? record.valorPagar ?? null,
    })),
  }, null, 2));
  process.exitCode = 2;
} else if (!executeRequested) {
  console.log(JSON.stringify({
    etapa: "PREFLIGHT",
    seguroParaEnviar: true,
    pagamentosCoincidentes: 0,
    validacoes: "linhas digitáveis, blocos, dígitos gerais, valores embutidos, vencimento e duplicidades conferidos",
    agendamentos: PAYMENTS.map((payment) => ({ documento: payment.document, valor: payment.amount, data: PAYMENT_DATE })),
    total: "476.45",
    proximoPasso: `Executar com --execute --confirmation=${CONFIRMATION}`,
  }, null, 2));
} else {
  const providedConfirmation = process.argv
    .find((argument) => argument.startsWith("--confirmation="))
    ?.slice("--confirmation=".length);
  if (providedConfirmation !== CONFIRMATION) {
    throw new Error("Confirmação específica ausente ou incorreta; nenhum pagamento foi enviado.");
  }

  const app = getApps().find((candidate) => candidate.name === "schedule-ct-dares-2026-07")
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, "schedule-ct-dares-2026-07");
  const db = getFirestore(app, FINANCIAL_DATABASE);
  const expenses = await Promise.all(PAYMENTS.map((payment) => db.collection("expenses").doc(payment.expenseId).get()));
  for (const [index, expense] of expenses.entries()) {
    const payment = PAYMENTS[index];
    if (!expense.exists || expense.data()?.sourceReference !== payment.ourNumber || expense.data()?.status !== "pending") {
      throw new Error(`${payment.document}: despesa pendente correspondente não foi encontrada; nenhum pagamento foi enviado.`);
    }
    if (expense.data()?.bankPaymentTransactionId) {
      throw new Error(`${payment.document}: despesa já possui transação bancária vinculada; nenhum pagamento foi enviado.`);
    }
  }

  const results = [];
  for (const payment of PAYMENTS) {
    currentStage = `ENVIO_${payment.ourNumber}`;
    const response = await client.post(PAYMENT_PATH, {
      codBarraLinhaDigitavel: payment.barcode,
      valorPagar: payment.amount,
      dataPagamento: PAYMENT_DATE,
      dataVencimento: PAYMENT_DATE,
    });
    const result = {
      expenseId: payment.expenseId,
      documento: payment.document,
      valor: payment.amount,
      dataPagamento: PAYMENT_DATE,
      httpStatus: response.status,
      codigoTransacao: response.data?.codigoTransacao ?? null,
      statusPagamento: response.data?.statusPagamento ?? null,
      quantidadeAprovadores: response.data?.quantidadeAprovadores ?? null,
      dataAgendamento: response.data?.dataAgendamento ?? null,
    };
    if (!result.codigoTransacao) throw new Error(`${payment.document}: o Inter aceitou a requisição sem retornar código de transação.`);
    await db.collection("expenses").doc(payment.expenseId).set({
      bankPaymentTransactionId: result.codigoTransacao,
      bankPaymentStatus: result.statusPagamento,
      bankPaymentApproversRequired: result.quantidadeAprovadores,
      bankPaymentScheduledFor: Timestamp.fromDate(new Date(`${PAYMENT_DATE}T12:00:00-03:00`)),
      paymentSchedulingStatus: "awaiting_approval",
      bankPaymentLinkedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    results.push(result);
  }
  currentStage = "CONCLUIDO";
  console.log(JSON.stringify({
    etapa: "CONCLUIDO",
    observacao: "Solicitações criadas no Inter. A autorização final deve ser feita exclusivamente pelo usuário no aplicativo.",
    resultados: results,
  }, null, 2));
}
