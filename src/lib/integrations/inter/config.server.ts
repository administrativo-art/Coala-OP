export type InterEnvironment = "sandbox" | "production";

export type InterConfig = {
  environment: InterEnvironment;
  clientId: string;
  clientSecret: string;
  certificate: Buffer;
  privateKey: Buffer;
  accountNumber?: string;
  apiBaseUrl: string;
  tokenUrl: string;
  webhookSecret?: string;
};

export type InterCobrancaPayer = {
  cpfCnpj: string;
  tipoPessoa: "FISICA" | "JURIDICA";
  nome: string;
  endereco: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  complemento?: string;
  email?: string;
  ddd?: string;
  telefone?: string;
};

export type InterCobrancaSettings = {
  environment: InterEnvironment;
  payerCnpj: string;
  dueBusinessDays: number;
  numDiasAgenda: number;
  minimumCents: number;
  holidays: string[];
};

export type InterCobrancaLedgerSettings = {
  enabled: boolean;
  bankAccountId: string | null;
  bankPaymentMethodId: string | null;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`A configuração ${name} do Banco Inter não foi informada.`);
  return value;
}

function decodeBase64(name: string) {
  const raw = required(name);
  const decoded = Buffer.from(raw, "base64");
  if (!decoded.length) throw new Error(`A configuração ${name} do Banco Inter é inválida.`);
  return decoded;
}

function environmentFrom(value: string | undefined, safeDefault: InterEnvironment): InterEnvironment {
  return value?.trim().toLowerCase() === "production" ? "production" : safeDefault;
}

function credentialVariable(environment: InterEnvironment, suffix: string) {
  return environment === "sandbox" ? `INTER_SANDBOX_${suffix}` : `INTER_${suffix}`;
}

export function getInterConfig(environmentOverride?: InterEnvironment): InterConfig {
  const environment = environmentOverride ?? environmentFrom(process.env.INTER_ENVIRONMENT, "sandbox");
  const apiBaseUrl = environment === "production"
    ? "https://cdpj.partners.bancointer.com.br"
    : "https://cdpj-sandbox.partners.uatinter.co";
  const accountVariable = credentialVariable(environment, "ACCOUNT_NUMBER");
  return {
    environment,
    clientId: required(credentialVariable(environment, "CLIENT_ID")),
    clientSecret: required(credentialVariable(environment, "CLIENT_SECRET")),
    certificate: decodeBase64(credentialVariable(environment, "CERTIFICATE_BASE64")),
    privateKey: decodeBase64(credentialVariable(environment, "PRIVATE_KEY_BASE64")),
    accountNumber: process.env[accountVariable]?.trim() || undefined,
    apiBaseUrl,
    tokenUrl: `${apiBaseUrl}/oauth/v2/token`,
    webhookSecret: process.env.INTER_WEBHOOK_SECRET?.trim() || undefined,
  };
}

function integerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`A configuração ${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

export function getInterCobrancaEnvironment(): InterEnvironment {
  return environmentFrom(process.env.INTER_COBRANCA_ENVIRONMENT, "sandbox");
}

export function getInterCobrancaSettings(): InterCobrancaSettings {
  const payerCnpj = required("INTER_COBRANCA_PAYER_CNPJ").replace(/\D/g, "");
  if (payerCnpj.length !== 14) {
    throw new Error("O CNPJ do pagador institucional da Cobrança Inter é inválido.");
  }
  return {
    environment: getInterCobrancaEnvironment(),
    payerCnpj,
    dueBusinessDays: integerSetting("INTER_COBRANCA_DUE_BUSINESS_DAYS", 2, 0, 30),
    numDiasAgenda: integerSetting("INTER_COBRANCA_NUM_DIAS_AGENDA", 30, 0, 60),
    minimumCents: integerSetting("INTER_COBRANCA_MIN_CENTS", 250, 250, 500_000),
    holidays: (process.env.INTER_COBRANCA_HOLIDAYS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
  };
}

export function getInterCobrancaLedgerSettings(): InterCobrancaLedgerSettings {
  const environment = getInterCobrancaEnvironment();
  return {
    enabled: environment === "production",
    bankAccountId: process.env.INTER_COBRANCA_BANK_ACCOUNT_ID?.trim() || null,
    bankPaymentMethodId: process.env.INTER_COBRANCA_BANK_PAYMENT_METHOD_ID?.trim() || null,
  };
}

export function isInterConfigured(environmentOverride?: InterEnvironment) {
  const environment = environmentOverride ?? environmentFrom(process.env.INTER_ENVIRONMENT, "sandbox");
  return ["CLIENT_ID", "CLIENT_SECRET", "CERTIFICATE_BASE64", "PRIVATE_KEY_BASE64"]
    .every((suffix) => Boolean(process.env[credentialVariable(environment, suffix)]?.trim()));
}

export function interCobrancaReadiness() {
  const environment = getInterCobrancaEnvironment();
  const credentialsConfigured = isInterConfigured(environment);
  const ledger = getInterCobrancaLedgerSettings();
  let reason: string | null = null;
  if (!credentialsConfigured) reason = `Credenciais ${environment} da Cobrança Inter não configuradas.`;
  else if (ledger.enabled && !ledger.bankAccountId) reason = "Conta bancária de destino da Cobrança Inter não configurada.";
  else {
    try {
      getInterCobrancaSettings();
    } catch (error) {
      reason = error instanceof Error ? error.message : "Configuração da Cobrança Inter inválida.";
    }
  }
  return { ready: reason === null, environment, reason };
}
