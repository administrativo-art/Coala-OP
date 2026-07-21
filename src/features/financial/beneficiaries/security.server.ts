import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ProtectedPaymentDestination } from "./types";

const VERSION = "v1";

function resolveKey(explicitKey?: string) {
  const raw = explicitKey ?? process.env.PAYMENT_DATA_ENCRYPTION_KEY ?? "";
  if (!raw) {
    throw new Error("PAYMENT_DATA_ENCRYPTION_KEY não configurada.");
  }

  const hex = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
  const base64 = hex ?? Buffer.from(raw, "base64");
  if (base64.length !== 32) {
    throw new Error("PAYMENT_DATA_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64 ou 64 caracteres hexadecimais.");
  }
  return base64;
}
export function encryptPaymentDestination(
  value: ProtectedPaymentDestination,
  explicitKey?: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(explicitKey), iv);
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptPaymentDestination(
  sealed: string,
  explicitKey?: string,
): ProtectedPaymentDestination {
  const [version, ivRaw, tagRaw, encryptedRaw] = sealed.split(".");
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Dados de pagamento protegidos em formato inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", resolveKey(explicitKey), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as ProtectedPaymentDestination;
}
