import https from "node:https";
import { execFileSync } from "node:child_process";
import axios from "axios";

function abortSafely(error) {
  console.error(JSON.stringify({
    etapa: "ABORTADO",
    httpStatus: error?.response?.status ?? null,
    codigo: error?.code ?? null,
    mensagem: error instanceof Error && !axios.isAxiosError(error)
      ? error.message
      : "Falha na comunicação bancária; detalhes sensíveis foram omitidos.",
  }));
  process.exit(1);
}

process.on("uncaughtException", abortSafely);
process.on("unhandledRejection", abortSafely);

const PROJECT_ID = "smart-converter-752gf";
const BASE_URL = "https://cdpj.partners.bancointer.com.br";
const TOKEN_URL = `${BASE_URL}/oauth/v2/token`;
const PAYMENT_PATH = "/banking/v2/pagamento";
const CONFIRMATION = "CONFIRMO-1564-3-AGENDAMENTOS-2753.82";

const payments = [
  {
    documento: "1564-01",
    codBarraLinhaDigitavel: "75691326110118606820900024370017615480000091794",
    valorPagar: "917.94",
    dataPagamento: "2026-08-24",
    dataVencimento: "2026-08-24",
    cpfCnpjBeneficiario: "64433090000197",
  },
  {
    documento: "1564-02",
    codBarraLinhaDigitavel: "75691326110118606820900024380024815550000091794",
    valorPagar: "917.94",
    dataPagamento: "2026-08-31",
    dataVencimento: "2026-08-31",
    cpfCnpjBeneficiario: "64433090000197",
  },
  {
    documento: "1564-03",
    codBarraLinhaDigitavel: "75691326110118606820900024390031115620000091794",
    valorPagar: "917.94",
    dataPagamento: "2026-09-07",
    dataVencimento: "2026-09-07",
    cpfCnpjBeneficiario: "64433090000197",
  },
];

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

const credentials = {
  clientId: accessSecret("INTER_CLIENT_ID"),
  clientSecret: accessSecret("INTER_CLIENT_SECRET"),
  certificate: Buffer.from(accessSecret("INTER_CERTIFICATE_BASE64"), "base64"),
  privateKey: Buffer.from(accessSecret("INTER_PRIVATE_KEY_BASE64"), "base64"),
  accountNumber: accessSecret("INTER_ACCOUNT_NUMBER", { optional: true }),
};

const httpsAgent = new https.Agent({
  cert: credentials.certificate,
  key: credentials.privateKey,
  keepAlive: false,
  minVersion: "TLSv1.2",
});

async function accessToken(scope) {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: "client_credentials",
    scope,
  });
  const response = await axios.post(TOKEN_URL, body.toString(), {
    httpsAgent,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });
  if (!response.data?.access_token) throw new Error(`Token sem access_token para ${scope}.`);
  return response.data.access_token;
}

function client(accessToken) {
  return axios.create({
    baseURL: BASE_URL,
    httpsAgent,
    timeout: 25_000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
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

async function findExisting(readClient, payment) {
  try {
    const response = await readClient.get(PAYMENT_PATH, {
      params: { codBarraLinhaDigitavel: payment.codBarraLinhaDigitavel },
    });
    return asPaymentList(response.data);
  } catch (error) {
    const detail = error.response?.data;
    throw new Error(JSON.stringify({
      etapa: "PREFLIGHT",
      documento: payment.documento,
      httpStatus: error.response?.status ?? null,
      codigo: error.code ?? null,
      resposta: typeof detail === "object" && detail !== null
        ? {
            title: detail.title ?? null,
            status: detail.status ?? null,
            detail: detail.detail ?? detail.message ?? null,
          }
        : null,
      mensagem: "A consulta de duplicidade falhou; nenhum pagamento foi enviado.",
    }));
  }
}

const existingByDocument = {};
let preflightUnavailable = null;

try {
  const readToken = await accessToken("pagamento-boleto.read");
  const readClient = client(readToken);
  for (const payment of payments) {
    existingByDocument[payment.documento] = await findExisting(readClient, payment);
  }
} catch (error) {
  preflightUnavailable = error;
}

const duplicateSummary = Object.entries(existingByDocument)
  .filter(([, records]) => records.length > 0)
  .map(([documento, records]) => ({
    documento,
    encontrados: records.map((record) => ({
      codigoTransacao: record.codigoTransacao ?? null,
      statusPagamento: record.statusPagamento ?? record.status ?? null,
      dataPagamento: record.dataPagamento ?? null,
      valorPago: record.valorPago ?? record.valorPagar ?? null,
    })),
  }));

const executeRequested = process.argv.includes("--execute");
const providedNoPreflightAuthorization = process.argv
  .find((argument) => argument.startsWith("--allow-no-preflight="))
  ?.slice("--allow-no-preflight=".length);
const mayProceedWithoutPreflight = executeRequested
  && providedNoPreflightAuthorization === "AUTORIZO-CONTINUAR-SEM-CONSULTA-1564";

if (preflightUnavailable && !mayProceedWithoutPreflight) {
  throw preflightUnavailable;
} else if (duplicateSummary.length > 0) {
  console.log(JSON.stringify({
    etapa: "PREFLIGHT",
    seguroParaEnviar: false,
    motivo: "O Inter já retornou pagamento(s) para uma ou mais linhas digitáveis.",
    duplicidades: duplicateSummary,
  }, null, 2));
  process.exitCode = 2;
} else if (!executeRequested) {
  console.log(JSON.stringify({
    etapa: "PREFLIGHT",
    seguroParaEnviar: true,
    pagamentosExistentes: 0,
    proximoPasso: "Executar somente com a confirmação específica.",
  }, null, 2));
} else {
  if (preflightUnavailable) {
    console.error(JSON.stringify({
      etapa: "PREFLIGHT_INDISPONIVEL",
      autorizadoContinuar: true,
      motivo: "A consulta retornou erro de autorização; nenhum pagamento havia sido enviado por este fluxo.",
    }));
  }
  const providedConfirmation = process.argv
    .find((argument) => argument.startsWith("--confirmation="))
    ?.slice("--confirmation=".length);
  if (providedConfirmation !== CONFIRMATION) {
    throw new Error("Confirmação específica ausente ou incorreta; nenhum pagamento foi enviado.");
  }

  const writeToken = await accessToken("pagamento-boleto.write");
  const writeClient = client(writeToken);
  const results = [];

  for (const payment of payments) {
    const { documento, ...payload } = payment;
    try {
      const response = await writeClient.post(PAYMENT_PATH, payload);
      const result = {
        documento,
        httpStatus: response.status,
        codigoTransacao: response.data?.codigoTransacao ?? null,
        statusPagamento: response.data?.statusPagamento ?? null,
        quantidadeAprovadores: response.data?.quantidadeAprovadores ?? null,
        dataAgendamento: response.data?.dataAgendamento ?? null,
      };
      results.push(result);
      console.log(JSON.stringify({ etapa: "ENVIADO", ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        etapa: "ERRO",
        documento,
        aviso: "A execução foi interrompida. Não repetir sem consultar o Inter.",
        httpStatus: error.response?.status ?? null,
        resposta: error.response?.data ?? null,
        codigo: error.code ?? null,
        mensagem: error.message,
        enviadosAntesDoErro: results,
      }));
      process.exit(1);
    }
  }

  console.log(JSON.stringify({
    etapa: "CONCLUIDO",
    quantidade: results.length,
    total: "2753.82",
    resultados: results,
  }, null, 2));
}
