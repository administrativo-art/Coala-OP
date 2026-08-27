import { createHash } from "node:crypto";

import type { UniformTransactionType } from "@/types";

const SIGNATURE_PATTERN = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const MAX_SIGNATURE_BYTES = 750_000;

export function uniformDocumentTypeCode(type: UniformTransactionType) {
  if (type === "exchange") return "UNIFORM_EXCHANGE";
  if (type === "return") return "UNIFORM_RETURN";
  return "UNIFORM_DELIVERY";
}

export function parseUniformSignature(value: unknown, label: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = SIGNATURE_PATTERN.exec(raw);
  if (!match) throw new Error(`Assinatura de ${label} ausente ou inválida.`);
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > MAX_SIGNATURE_BYTES) {
    throw new Error(`Assinatura de ${label} excede o tamanho permitido.`);
  }
  return {
    dataUrl: raw,
    imageHash: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function isUniformTransactionId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
