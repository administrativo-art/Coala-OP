import { z } from "zod";

export const INTER_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
export const INTER_WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const situationSchema = z.string().trim().min(1).max(80);

export const interCobrancaWebhookItemSchema = z.object({
  codigoSolicitacao: z.string().uuid(),
  seuNumero: z.string().trim().min(1).max(80),
  situacao: situationSchema,
  dataHoraSituacao: z.string().trim().min(1).max(80),
  valorTotalRecebido: z.union([z.number(), z.string().max(80)]).optional(),
  origemRecebimento: z.string().trim().max(80).optional(),
  nossoNumero: z.string().trim().max(100).optional(),
  codigoBarras: z.string().trim().max(200).optional(),
  linhaDigitavel: z.string().trim().max(200).optional(),
  txid: z.string().trim().max(200).optional(),
  pixCopiaECola: z.string().trim().max(1_000).optional(),
});

export const interCobrancaWebhookSchema = z.array(interCobrancaWebhookItemSchema).min(1).max(25);
export type InterCobrancaWebhookItem = z.infer<typeof interCobrancaWebhookItemSchema>;

export const interBankingWebhookSchema = z.object({
  codigoTransacao: z.string().trim().min(1).max(160).optional(),
  codigoSolicitacao: z.string().trim().min(1).max(160).optional(),
  statusPagamento: z.string().trim().max(100).optional(),
  status: z.string().trim().max(100).optional(),
  transacaoPix: z.object({
    codigoSolicitacao: z.string().trim().min(1).max(160).optional(),
  }).optional(),
}).refine(
  (value) => Boolean(value.codigoTransacao || value.codigoSolicitacao || value.transacaoPix?.codigoSolicitacao),
  "Evento sem código bancário da transação.",
);

export type InterBankingWebhook = z.infer<typeof interBankingWebhookSchema>;

export function interWebhookBodyFits(rawBody: string, declaredLength: string | null) {
  const declared = Number(declaredLength ?? 0);
  if (Number.isFinite(declared) && declared > INTER_WEBHOOK_MAX_BODY_BYTES) return false;
  return Buffer.byteLength(rawBody, "utf8") <= INTER_WEBHOOK_MAX_BODY_BYTES;
}

export async function readBoundedInterWebhookBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  const declared = Number(declaredLength ?? 0);
  if (Number.isFinite(declared) && declared > INTER_WEBHOOK_MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > INTER_WEBHOOK_MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function interWebhookExpiry(now = Date.now()) {
  return new Date(now + INTER_WEBHOOK_RETENTION_MS);
}

export function cleanInterCobrancaWebhookUrl(appUrl: string) {
  const base = new URL(appUrl);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("A URL pública do Coala precisa usar HTTPS e não pode conter credenciais.");
  }
  const url = new URL("/api/webhooks/inter/cobranca", base);
  url.search = "";
  url.hash = "";
  return url;
}

