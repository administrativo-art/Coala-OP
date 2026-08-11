/**
 * Normalização centralizada de forma de pagamento do PDV Legal para canal do
 * fechamento de caixa (seção 7 do plano). Nenhuma tela, rota ou job deve
 * comparar `nome === "DINHEIRO"` diretamente — sempre passar por aqui.
 */

export type CashClosureChannel =
  | "cash"
  | "pix"
  | "debit_card"
  | "credit_card"
  | "voucher"
  | "signed_account"
  | "other";

const PDV_AUTO_COUNTED_CHANNELS = new Set<CashClosureChannel>([
  "pix",
  "debit_card",
  "credit_card",
]);

export function isPdvAutoCountedChannel(channel: CashClosureChannel) {
  return PDV_AUTO_COUNTED_CHANNELS.has(channel);
}

export type ChannelNormalizationResult = {
  channel: CashClosureChannel;
  label: string;
  /** TROCO entra com sinal -1 para netar o dinheiro líquido na agregação. */
  sign: 1 | -1;
  isCashChange: boolean;
  rawName: string;
};

type ChannelRule = Omit<ChannelNormalizationResult, "rawName">;

function normalizeKey(rawName: string): string {
  return rawName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

const EXACT_RULES: Record<string, ChannelRule> = {
  DINHEIRO: { channel: "cash", label: "Dinheiro", sign: 1, isCashChange: false },
  TROCO: { channel: "cash", label: "Troco", sign: -1, isCashChange: true },
  PIX: { channel: "pix", label: "Pix", sign: 1, isCashChange: false },
  "CARTAO DEBITO": { channel: "debit_card", label: "Cartão débito", sign: 1, isCashChange: false },
  "CARTAO CREDITO": { channel: "credit_card", label: "Cartão crédito", sign: 1, isCashChange: false },
};

// Prefixos cobrem variações como "PIX STONE", "CARTAO DEBITO STONE VISA" etc.
const PREFIX_RULES: { prefix: string; rule: ChannelRule }[] = [
  { prefix: "PIX", rule: EXACT_RULES.PIX },
  { prefix: "CARTAO DEBITO", rule: EXACT_RULES["CARTAO DEBITO"] },
  { prefix: "CARTAO CREDITO", rule: EXACT_RULES["CARTAO CREDITO"] },
];

export function normalizeChannel(rawName: string): ChannelNormalizationResult {
  const key = normalizeKey(rawName ?? "");

  const exact = EXACT_RULES[key];
  if (exact) return { ...exact, rawName };

  const prefixMatch = PREFIX_RULES.find(({ prefix }) => key.startsWith(prefix));
  if (prefixMatch) return { ...prefixMatch.rule, rawName };

  return { channel: "other", label: rawName || "Desconhecido", sign: 1, isCashChange: false, rawName };
}
