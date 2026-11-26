/**
 * Códigos do arquivo de conciliação Stone (layout 2.2), conferidos em 2026-11-14 em
 * https://conciliacao.stone.com.br/reference/brandid.md, accounttype.md e feetype.md.
 * Código desconhecido não é inferido: aparece como "código N".
 */
const BRANDS: Record<string, string> = {
  "1": "Visa",
  "2": "Mastercard",
  "3": "Amex",
  "4": "Cabal",
  "5": "UnionPay",
  "9": "Hipercard",
  "171": "Elo",
};

const ACCOUNT_TYPES: Record<string, string> = {
  "1": "Débito",
  "2": "Crédito",
  "3": "Pré-pago débito",
  "4": "Pré-pago crédito",
  "5": "Voucher",
  "10": "Boleto",
};

const FEE_TYPES: Record<string, string> = {
  "1": "MDR e antecipação separados",
  "2": "Taxa única de venda",
  "255": "Padrão",
};

const normalized = (code: string | null | undefined) => code?.trim().replace(/^0+(?=\d)/, "") ?? "";

export function stoneBrandName(code: string | null | undefined) {
  const value = normalized(code);
  if (!value) return "Bandeira não informada";
  return BRANDS[value] ?? `Bandeira código ${value}`;
}

export function stoneAccountTypeName(code: string | null | undefined) {
  const value = normalized(code);
  if (!value) return "Tipo não informado";
  return ACCOUNT_TYPES[value] ?? `Tipo código ${value}`;
}

export function stoneFeeTypeName(code: string | null | undefined) {
  const value = normalized(code);
  if (!value) return null;
  return FEE_TYPES[value] ?? `Tipo de taxa código ${value}`;
}

/** Débito e pré-pago débito liquidam como débito; crédito e pré-pago crédito como crédito. */
export function stoneAccountKind(code: string | null | undefined): "debit" | "credit" | "other" {
  const value = normalized(code);
  if (value === "1" || value === "3") return "debit";
  if (value === "2" || value === "4") return "credit";
  return "other";
}
