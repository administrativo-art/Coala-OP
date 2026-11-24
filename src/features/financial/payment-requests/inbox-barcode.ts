import { z } from "zod";

import { CnpjValidator } from "@/lib/company/cnpj-validator";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}, "Data de pagamento inválida.");

export const inboxBarcodePaymentPreparationSchema = z.object({
  scheduledFor: isoDate,
  barcode: z.string().trim().max(80).optional(),
  // Opcional somente para guia de arrecadação de órgão público; o serviço exige o
  // CNPJ para qualquer outro código (ver governmentCollectionBarcode).
  beneficiaryDocument: z.string()
    .transform((value) => CnpjValidator.clean(value))
    .refine((value) => CnpjValidator.validate(value).valid, "CNPJ do favorecido inválido.")
    .optional(),
}).strict();

export type InboxBarcodePaymentPreparation = z.infer<typeof inboxBarcodePaymentPreparationSchema>;

function collectionMod10(value: string) {
  let sum = 0;
  for (let index = value.length - 1, weight = 2; index >= 0; index--, weight = weight === 2 ? 1 : 2) {
    const product = Number(value[index]) * weight;
    sum += Math.floor(product / 10) + product % 10;
  }
  return (10 - sum % 10) % 10;
}

function collectionMod11(value: string) {
  let sum = 0;
  for (let index = value.length - 1, weight = 2; index >= 0; index--, weight = weight === 9 ? 2 : weight + 1) {
    sum += Number(value[index]) * weight;
  }
  const rest = sum % 11;
  if (rest === 0 || rest === 1) return 0;
  if (rest === 10) return 1;
  return 11 - rest;
}

/**
 * Guia de arrecadação de órgão público (FEBRABAN, segmento 5: DARF, DAS, GPS e
 * similares). Essas guias não identificam um favorecido por CPF/CNPJ; em troca,
 * só são aceitas sem documento quando a linha digitável é íntegra (dígitos
 * verificadores de cada bloco e geral) e traz o valor efetivo, que o chamador
 * deve comparar com o valor confirmado da cobrança.
 */
export function validatedCollectionBarcode(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^8/.test(digits) || ![44, 48].includes(digits.length)) return null;
  const valueIdentifier = digits[2];
  if (!["6", "7", "8", "9"].includes(valueIdentifier)) return null;
  const mod = valueIdentifier === "6" || valueIdentifier === "7" ? collectionMod10 : collectionMod11;
  let barcode = digits;
  if (digits.length === 48) {
    const blocks = [0, 12, 24, 36].map((start) => digits.slice(start, start + 12));
    if (blocks.some((block) => mod(block.slice(0, 11)) !== Number(block[11]))) return null;
    barcode = blocks.map((block) => block.slice(0, 11)).join("");
  }
  if (mod(barcode.slice(0, 3) + barcode.slice(4)) !== Number(barcode[3])) return null;
  const effectiveValue = valueIdentifier === "6" || valueIdentifier === "8";
  const amountCents = effectiveValue ? Number(barcode.slice(4, 15)) : null;
  return { barcode, segment: barcode[1], amountCents: amountCents && amountCents > 0 ? amountCents : null };
}

export function governmentCollectionBarcode(value: string) {
  const parsed = validatedCollectionBarcode(value);
  return parsed?.segment === "5" ? { barcode: parsed.barcode, amountCents: parsed.amountCents } : null;
}
