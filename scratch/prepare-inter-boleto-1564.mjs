import https from "node:https";
import { execFileSync } from "node:child_process";
import axios from "axios";

const PROJECT_ID = "smart-converter-752gf";
const TOKEN_URL = "https://cdpj.partners.bancointer.com.br/oauth/v2/token";
const REQUIRED_SCOPE = "pagamento-boleto.write";

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

function modulo10(field) {
  let sum = 0;
  let weight = 2;
  for (let index = field.length - 1; index >= 0; index -= 1) {
    const product = Number(field[index]) * weight;
    sum += product > 9 ? Math.floor(product / 10) + (product % 10) : product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function modulo11Barcode(barcodeWithoutDv) {
  let sum = 0;
  let weight = 2;
  for (let index = barcodeWithoutDv.length - 1; index >= 0; index -= 1) {
    sum += Number(barcodeWithoutDv[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const digit = 11 - (sum % 11);
  return digit === 0 || digit === 10 || digit === 11 ? 1 : digit;
}

function validatePayment(payment) {
  const line = payment.codBarraLinhaDigitavel;
  if (!/^\d{47}$/.test(line)) {
    throw new Error(`${payment.documento}: linha digitável deve conter exatamente 47 dígitos.`);
  }

  const fields = [
    { data: line.slice(0, 9), digit: Number(line[9]) },
    { data: line.slice(10, 20), digit: Number(line[20]) },
    { data: line.slice(21, 31), digit: Number(line[31]) },
  ];
  fields.forEach((field, index) => {
    if (modulo10(field.data) !== field.digit) {
      throw new Error(`${payment.documento}: dígito verificador inválido no campo ${index + 1}.`);
    }
  });

  const barcode = `${line.slice(0, 4)}${line[32]}${line.slice(33, 47)}${line.slice(4, 9)}${line.slice(10, 20)}${line.slice(21, 31)}`;
  if (modulo11Barcode(`${barcode.slice(0, 4)}${barcode.slice(5)}`) !== Number(barcode[4])) {
    throw new Error(`${payment.documento}: dígito verificador geral inválido.`);
  }

  const embeddedAmount = (Number(barcode.slice(9, 19)) / 100).toFixed(2);
  if (embeddedAmount !== payment.valorPagar) {
    throw new Error(`${payment.documento}: valor do payload não corresponde ao valor da linha digitável.`);
  }
  if (payment.dataPagamento !== payment.dataVencimento) {
    throw new Error(`${payment.documento}: data de pagamento difere do vencimento.`);
  }
}

function payloadFor(payment) {
  const { documento: _documento, ...payload } = payment;
  return payload;
}

function accessSecret(name) {
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT_ID}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

async function testProductionToken() {
  const clientId = accessSecret("INTER_CLIENT_ID");
  const clientSecret = accessSecret("INTER_CLIENT_SECRET");
  const certificate = Buffer.from(accessSecret("INTER_CERTIFICATE_BASE64"), "base64");
  const privateKey = Buffer.from(accessSecret("INTER_PRIVATE_KEY_BASE64"), "base64");

  if (!clientId || !clientSecret || !certificate.length || !privateKey.length) {
    throw new Error("Uma ou mais credenciais de produção do Inter estão vazias.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: REQUIRED_SCOPE,
  });
  const response = await axios.post(TOKEN_URL, body.toString(), {
    httpsAgent: new https.Agent({
      cert: certificate,
      key: privateKey,
      keepAlive: false,
      minVersion: "TLSv1.2",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 20_000,
  });

  if (!response.data?.access_token) {
    throw new Error("O Inter respondeu sem access_token.");
  }
  console.log(JSON.stringify({
    tokenObtido: true,
    ambiente: "production",
    scopeSolicitado: REQUIRED_SCOPE,
    expiresIn: response.data.expires_in ?? null,
    tipoToken: response.data.token_type ?? null,
  }, null, 2));
}

payments.forEach(validatePayment);

if (process.argv.includes("--test-token")) {
  await testProductionToken();
} else {
  console.log(JSON.stringify({
    modo: "DRY_RUN",
    aviso: "Este script não contém chamada ao endpoint de criação de pagamento.",
    endpointFuturo: "POST https://cdpj.partners.bancointer.com.br/banking/v2/pagamento",
    escopo: REQUIRED_SCOPE,
    total: "2753.82",
    pagamentos: payments.map((payment) => ({
      documento: payment.documento,
      payload: payloadFor(payment),
    })),
  }, null, 2));
}
