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

export function getInterConfig(): InterConfig {
  const environment: InterEnvironment = process.env.INTER_ENVIRONMENT === "production" ? "production" : "sandbox";
  const apiBaseUrl = environment === "production"
    ? "https://cdpj.partners.bancointer.com.br"
    : "https://cdpj-sandbox.partners.uatinter.co";
  return {
    environment,
    clientId: required("INTER_CLIENT_ID"),
    clientSecret: required("INTER_CLIENT_SECRET"),
    certificate: decodeBase64("INTER_CERTIFICATE_BASE64"),
    privateKey: decodeBase64("INTER_PRIVATE_KEY_BASE64"),
    accountNumber: process.env.INTER_ACCOUNT_NUMBER?.trim() || undefined,
    apiBaseUrl,
    tokenUrl: `${apiBaseUrl}/oauth/v2/token`,
    webhookSecret: process.env.INTER_WEBHOOK_SECRET?.trim() || undefined,
  };
}

export function isInterConfigured() {
  return ["INTER_CLIENT_ID", "INTER_CLIENT_SECRET", "INTER_CERTIFICATE_BASE64", "INTER_PRIVATE_KEY_BASE64"]
    .every((name) => Boolean(process.env[name]?.trim()));
}
