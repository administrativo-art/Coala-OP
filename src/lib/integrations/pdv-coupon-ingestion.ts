/**
 * Regras de ingestão compartilhadas pelos relatórios de venda e pelo fechamento
 * de caixa. Este módulo não agrega valores; apenas interpreta o envelope bruto
 * do cupom para que cancelamentos e datas não divirjam entre consumidores.
 */

// O contrato externo do PDV é dinâmico e já é consumido como `any` pela
// sincronização legada. Manter o índice aberto aqui permite compartilhar a
// ingestão sem forçar a camada de vendas a reinterpretar todos os campos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawPdvRecord = Record<string, any>;

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  return ["CANCELADO", "TRUE", "1"].includes(value.trim().toUpperCase());
}

export function pdvCouponItems(coupon: RawPdvRecord): RawPdvRecord[] {
  const raw = Array.isArray(coupon.Itens)
    ? coupon.Itens
    : Array.isArray(coupon.itens)
      ? coupon.itens
      : [];
  return raw.filter((item): item is RawPdvRecord => !!item && typeof item === "object" && !Array.isArray(item));
}

export function isPdvItemCancelled(item: RawPdvRecord) {
  return booleanValue(item.iscancelado ?? item.IsCancelado);
}

export function isPdvCouponMarkedCancelled(coupon: RawPdvRecord) {
  const status = String(coupon.status ?? coupon.Status ?? "").trim().toUpperCase();
  return booleanValue(coupon.iscancelado ?? coupon.IsCancelado) || status === "CANCELADO";
}

export function hasExplicitPdvItemCancellation(coupon: RawPdvRecord) {
  return pdvCouponItems(coupon).some(isPdvItemCancelled);
}

export function isPdvCouponFullyCancelled(coupon: RawPdvRecord) {
  return isPdvCouponMarkedCancelled(coupon) && !hasExplicitPdvItemCancellation(coupon);
}

export function pdvCouponTimestamp(coupon: RawPdvRecord) {
  for (const value of [coupon.dtrecebimento, coupon.dtabertura, coupon.DtRecebimento, coupon.DtAbertura]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const itemTimestamp = pdvCouponItems(coupon)
    .map((item) => item.dtmovimento ?? item.DtMovimento)
    .find((value) => typeof value === "string" && value.trim());
  return typeof itemTimestamp === "string" ? itemTimestamp.trim() : null;
}
