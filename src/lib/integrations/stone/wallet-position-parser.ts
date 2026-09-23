import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { AppError } from "../../observability/app-error";
import { stoneAgendaQuerySchema } from "./agenda-query";
import { STONE_AGENDA_MAX_BYTES } from "./agenda-transport";

export const MAX_STONE_WALLETS = 500;
const civil = (value: string) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
const date = z.string().regex(/^\d{8}$/).refine(value =>
  stoneAgendaQuerySchema.shape.referenceDate.safeParse(civil(value)).success);
const timestamp = z.string().regex(/^\d{8}([01]\d|2[0-3])[0-5]\d[0-5]\d$/)
  .refine(value => date.safeParse(value.slice(0, 8)).success);
const wallet = z.object({
  WalletTypeId: z.string().regex(/^\d{1,2}$/),
  WalletNatureId: z.string().regex(/^\d$/),
  Category: z.string().trim().min(1).max(80),
  Amount: z.string().regex(/^-?\d{1,15}(?:\.\d{1,12})?$/),
  "#text": z.never().optional(),
});
const walletPosition = z.union([z.literal(""), z.object({
  Wallets: z.union([z.literal(""), z.object({
    Wallet: z.array(wallet).max(MAX_STONE_WALLETS), "#text": z.never().optional(),
  })]),
  "#text": z.never().optional(),
})]);
const schema = z.object({
  Conciliation: z.object({
    Header: z.object({
      StoneCode: z.string().regex(/^\d{1,20}$/), ReferenceDate: date,
      LayoutVersion: z.literal("2.4"), FileId: z.string().trim().min(1).max(128),
      GenerationDateTime: timestamp,
    }),
    WalletPosition: walletPosition.optional(),
  }),
});
const natures = {
  "1": "regular", "5": "warranty", "7": "ownership_assignment", "8": "stone_anticipation",
} as const;
function invalid(): never {
  throw new AppError({ code: "STONE_WALLET_INVALID_FILE", kind: "PERMANENT_EXTERNAL",
    safeMessage: "O arquivo de posição de carteira Stone não corresponde ao contrato esperado." });
}

/** Daily reported position, not a maturity schedule, bank balance or free collateral.
 * Other sections of the XML are intentionally neither interpreted nor returned. */
export function parseStoneWalletPosition(xml: string, expected: { stoneCode: string; referenceDate: string }) {
  if (Buffer.byteLength(xml, "utf8") > STONE_AGENDA_MAX_BYTES || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) invalid();
  let raw: unknown;
  try {
    if (XMLValidator.validate(xml) !== true) invalid();
    raw = new XMLParser({ parseTagValue: false, ignoreAttributes: true, processEntities: false,
      isArray: name => name === "Wallet" }).parse(xml);
  } catch { invalid(); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) invalid();
  const { Header: header, WalletPosition: position } = parsed.data.Conciliation;
  const normalizedCode = (code: string) => code.replace(/^0+(?=\d)/, "");
  if (normalizedCode(header.StoneCode) !== normalizedCode(expected.stoneCode)
    || civil(header.ReferenceDate) !== expected.referenceDate) {
    throw new AppError({ code: "STONE_WALLET_SCOPE_MISMATCH", kind: "DATA_INTEGRITY" });
  }
  const values = position && position.Wallets ? position.Wallets.Wallet : [];
  const seen = new Set<string>();
  const rows = values.map(row => {
    const walletTypeId = String(Number(row.WalletTypeId));
    const key = JSON.stringify([walletTypeId, row.WalletNatureId, row.Category]);
    if (seen.has(key)) invalid();
    seen.add(key);
    const nature = row.WalletNatureId in natures
      ? natures[row.WalletNatureId as keyof typeof natures] : "unknown" as const;
    return { walletTypeId, walletNatureId: row.WalletNatureId,
      nature,
      category: row.Category, amount: row.Amount };
  });
  return {
    source: "stone_wallet_position" as const, layout: header.LayoutVersion,
    stoneCode: header.StoneCode, referenceDate: civil(header.ReferenceDate),
    fileId: header.FileId, generatedAtProvider: header.GenerationDateTime,
    sourceHash: createHash("sha256").update(xml).digest("hex"),
    status: position === undefined ? "not_provided" as const : rows.length ? "reported" as const : "empty" as const,
    amountFormat: "provider_decimal_not_integer_cents" as const,
    rows, unknownNatureCount: rows.filter(row => row.nature === "unknown").length,
    coverage: "daily_reported_wallet_position_not_complete_maturity_schedule" as const,
    portfolioBalanceConfirmed: false as const, bankReceiptConfirmed: false as const,
    availableBalance: null, writesPerformed: false as const,
    limitations: [
      "Posição informada pela Stone para o dia e StoneCode consultados; não comprova carteira integral por vencimento.",
      "Carteiras de garantia, cessão e antecipação permanecem separadas; os valores não são somados como saldo livre.",
      "Ausência ou seção vazia não comprova saldo zero. Categoria e valores são preservados como informados pelo provedor.",
      "As seções Expected representam itens previstos e não pagos; não são uma agenda completa de recebimentos futuros.",
      "Esta fonte não comprova saldo bancário, crédito em extrato ou disponibilidade para movimentação.",
    ],
  };
}
