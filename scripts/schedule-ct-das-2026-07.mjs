import https from "node:https";
import { execFileSync } from "node:child_process";
import axios from "axios";

const PROJECT_ID = "smart-converter-752gf";
const BASE_URL = "https://cdpj.partners.bancointer.com.br";
const TOKEN_URL = `${BASE_URL}/oauth/v2/token`;
const PAYMENT_PATH = "/banking/v2/pagamento";
const PAYMENT_DATE = "2026-08-20";
const CONFIRMATION = "CONFIRMO-DAS-CT-2026-07-3921.78-2026-08-20";
let currentStage = "INICIALIZACAO";

const payment = {
  documento: "DAS CT Sorvetes 07/2026",
  codBarraLinhaDigitavel: "858100000390217803282629320720262252987202400215",
  valorPagar: "3921.78",
  dataPagamento: PAYMENT_DATE,
  dataVencimento: PAYMENT_DATE,
};

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

function validatePayment(input) {
  const line = input.codBarraLinhaDigitavel;
  if (!/^8\d{47}$/.test(line)) throw new Error("A linha digitável de arrecadação deve conter 48 dígitos e começar por 8.");
  const referenceDigit = line[2];
  const calculateDigit = referenceDigit === "6" || referenceDigit === "7"
    ? modulo10
    : referenceDigit === "8" || referenceDigit === "9"
      ? modulo11Arrecadacao
      : null;
  if (!calculateDigit) throw new Error("O identificador de valor efetivo/referência da linha é inválido.");

  const blocks = Array.from({ length: 4 }, (_, index) => line.slice(index * 12, (index + 1) * 12));
  for (const [index, block] of blocks.entries()) {
    if (calculateDigit(block.slice(0, 11)) !== Number(block[11])) {
      throw new Error(`Dígito verificador inválido no bloco ${index + 1}.`);
    }
  }

  const barcode = blocks.map((block) => block.slice(0, 11)).join("");
  if (calculateDigit(`${barcode.slice(0, 3)}${barcode.slice(4)}`) !== Number(barcode[3])) {
    throw new Error("Dígito verificador geral inválido.");
  }
  if (referenceDigit !== "6" && referenceDigit !== "8") {
    throw new Error("O código não traz valor efetivo para conferência automática.");
  }
  const embeddedAmount = (Number(barcode.slice(4, 15)) / 100).toFixed(2);
  if (embeddedAmount !== input.valorPagar) {
    throw new Error(`O código contém ${embeddedAmount}, diferente do valor ${input.valorPagar}.`);
  }
  if (input.dataPagamento !== input.dataVencimento) {
    throw new Error("O agendamento deve ocorrer no vencimento informado pelo DAS.");
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

async function findDuplicates(client) {
  const response = await client.get(PAYMENT_PATH, {
    params: { dataInicio: PAYMENT_DATE, dataFim: PAYMENT_DATE, filtrarDataPor: "PAGAMENTO" },
  });
  return asPaymentList(response.data).filter((record) => {
    const amount = Number(record.valorPago ?? record.valorNominal ?? record.valorPagar);
    const date = normalizeDate(record.dataPagamento ?? record.dataVencimentoDigitada ?? record.dataVencimentoTitulo);
    return amount === Number(payment.valorPagar) && date === PAYMENT_DATE && isActiveStatus(record.statusPagamento ?? record.status);
  });
}

validatePayment(payment);
const executeRequested = process.argv.includes("--execute");
const credentials = loadCredentials();
currentStage = "AUTENTICACAO_INTER";
const token = await accessToken(
  credentials,
  executeRequested ? "pagamento-boleto.read pagamento-boleto.write" : "pagamento-boleto.read",
);
currentStage = "PREFLIGHT_INTER";
const duplicates = await findDuplicates(interClient(credentials, token));

if (duplicates.length > 0) {
  console.log(JSON.stringify({
    etapa: "PREFLIGHT",
    seguroParaEnviar: false,
    motivo: "O Inter já possui pagamento ativo com a mesma data e valor do DAS.",
    duplicidades: duplicates.map((record) => ({
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
    validacoes: "linha digitável, quatro blocos, dígito geral, valor embutido e vencimento conferidos",
    agendamento: { documento: payment.documento, valor: payment.valorPagar, data: payment.dataPagamento },
    proximoPasso: `Executar com --execute --confirmation=${CONFIRMATION}`,
  }, null, 2));
} else {
  const providedConfirmation = process.argv
    .find((argument) => argument.startsWith("--confirmation="))
    ?.slice("--confirmation=".length);
  if (providedConfirmation !== CONFIRMATION) {
    throw new Error("Confirmação específica ausente ou incorreta; nenhum pagamento foi enviado.");
  }

  currentStage = "ENVIO_DAS";
  const response = await interClient(credentials, token).post(PAYMENT_PATH, {
    codBarraLinhaDigitavel: payment.codBarraLinhaDigitavel,
    valorPagar: payment.valorPagar,
    dataPagamento: payment.dataPagamento,
    dataVencimento: payment.dataVencimento,
  });
  console.log(JSON.stringify({
    etapa: "CONCLUIDO",
    documento: payment.documento,
    valor: payment.valorPagar,
    dataPagamento: payment.dataPagamento,
    httpStatus: response.status,
    codigoTransacao: response.data?.codigoTransacao ?? null,
    statusPagamento: response.data?.statusPagamento ?? null,
    quantidadeAprovadores: response.data?.quantidadeAprovadores ?? null,
    dataAgendamento: response.data?.dataAgendamento ?? null,
  }, null, 2));
}
