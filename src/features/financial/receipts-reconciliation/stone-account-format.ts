import type { StatusPillVariant } from "@/components/ui/status-pill";
import { parcelFeeRate, pixFeeForRate, type AuditCheckResult, type ReceiptDay, type ReceiptParcel, type ReceiptParcelStatus } from "./stone-account";

export const centsLabel = (cents: number | null | undefined) => cents === null || cents === undefined ? "—"
  : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const rateLabel = (value: number | null | undefined) => value === null || value === undefined ? "—"
  : `${(value * 100).toFixed(2).replace(".", ",")}%`;
export const dayLabel = (value: string | null | undefined) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "—";
export const fullDateLabel = (value: string | null | undefined) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "—";
export function weekdayLabel(value: string) {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${value}T12:00:00Z`).getUTCDay()];
}
/** Data e hora local do arquivo Stone (AAAAMMDDhhmmss). */
export function stoneLocalDateTimeLabel(value: string | null | undefined) {
  if (!value || !/^\d{14}/.test(value)) return value ?? "—";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
}

export const parcelStatusView: Record<ReceiptParcelStatus, { label: string; variant: StatusPillVariant }> = {
  paid: { label: "Pago no dia", variant: "ok" },
  paid_early: { label: "Antecipado", variant: "info" },
  paid_late: { label: "Pago com atraso", variant: "warn" },
  unpaid: { label: "Não pago", variant: "danger" },
  to_receive: { label: "A receber", variant: "neutral" },
  missing_file: { label: "Sem arquivo Stone", variant: "warn" },
  chargeback: { label: "Chargeback", variant: "danger" },
  review: { label: "Conferir", variant: "warn" },
};

export const dayReasonLabel: Record<ReceiptDay["reasons"][number]["kind"], string> = {
  early: "antecipação",
  late_in: "atrasados de outros dias",
  paid_later: "pagos depois",
  paid_before: "antecipados antes",
  unpaid: "não pagos",
  chargeback: "chargeback",
  review: "a conferir",
  adjustment: "ajuste no valor pago",
  no_expected: "pagos sem previsão identificada",
  unexplained: "sem explicação",
};

export const checkView: Record<AuditCheckResult, { symbol: string; className: string; label: string }> = {
  ok: { symbol: "✓", className: "bg-ds-ok-bg text-ds-ok", label: "confere" },
  bad: { symbol: "✕", className: "bg-ds-danger-bg text-ds-danger", label: "divergente" },
  warn: { symbol: "!", className: "bg-ds-warn-bg text-ds-warn", label: "conferir" },
  wait: { symbol: "◷", className: "bg-ds-info-bg text-ds-info", label: "em andamento" },
};

/** Bandeira e modalidade, sem o número da parcela (a parcela tem coluna própria). */
export function parcelKind(parcel: ReceiptParcel) {
  if (parcel.source === "pix") return "Pix";
  const modality = parcel.modality === "debit" ? "débito" : parcel.modality === "credit" ? "crédito à vista"
    : parcel.modality === "installment" ? "crédito parcelado" : "tipo não informado";
  return `${parcel.brand ?? "Cartão sem bandeira"} ${modality}`;
}
/** Parcela no formato número/total: Pix e à vista = 1/1; crédito em 3x = 1/3, 2/3, 3/3. */
export const parcelNumber = (parcel: Pick<ReceiptParcel, "installment" | "installmentCount">) => `${parcel.installment}/${Math.max(parcel.installmentCount, parcel.installment)}`;

export function parcelTitle(parcel: ReceiptParcel) {
  if (parcel.source === "pix") return "Pix";
  const modality = parcel.modality === "debit" ? "débito" : parcel.modality === "credit" ? "crédito à vista"
    : parcel.modality === "installment" ? "crédito parcelado" : "tipo não informado";
  return `${parcel.brand ?? "Cartão"} ${modality}${parcel.installmentCount > 1 ? ` ${parcel.installment}/${parcel.installmentCount}` : ""}`;
}

export type ParcelProblem = { label: string; hint: string; variant: StatusPillVariant };

/**
 * O que precisa ser conferido numa parcela, com nome curto para a tabela e explicação para o cursor.
 * Substitui o genérico "Conferir": cada pendência diz qual é o problema.
 */
export function parcelProblems(parcel: ReceiptParcel, usualRate: number | null): ParcelProblem[] {
  const list: ParcelProblem[] = [];
  if (parcel.status === "review") {
    if (!parcel.expectedDate && parcel.paidDate) list.push({ label: "Venda não localizada", variant: "warn",
      hint: "A Stone pagou, mas a venda de origem não está nos arquivos lidos; sem ela não há data prevista nem bandeira." });
    else if (!parcel.expectedDate) list.push({ label: "Sem data prevista", variant: "warn",
      hint: "A Stone não informou quando esta parcela será paga." });
    else list.push({ label: "Dados divergentes", variant: "warn",
      hint: "Dois arquivos da Stone trazem valores diferentes para a mesma parcela, ou a carteira a marcou para revisão." });
  }
  if (parcel.feeSource === "derived") list.push({ label: "Taxa sem MDR", variant: "warn",
    hint: "A Stone não mandou o MDR e o líquido veio só em centavos; a taxa foi calculada como bruto − líquido − antecipação." });
  else if (rateDiffersFromUsual(parcel, usualRate)) list.push({ label: "Taxa fora da atual", variant: "warn",
    hint: `Cobrado ${rateLabel(parcelFeeRate(parcel))}; a taxa atual do grupo é ${rateLabel(usualRate)}. Decida na aba Taxas.` });
  return list;
}

/**
 * Taxa exata (líquido com 6 casas): difere quando não arredonda à mesma taxa de 0,01% do grupo.
 * Sem a taxa exata (conferência antiga ou só centavos): tolera 1 centavo de arredondamento.
 */
export function rateDiffersFromUsual(parcel: Pick<ReceiptParcel, "source" | "feeRate" | "feeCents" | "grossCents">, usualRate: number | null) {
  if (usualRate === null || parcel.feeCents === null || parcel.grossCents <= 0) return false;
  // Pix: taxa nominal com centavos cortados para baixo; confere o valor cobrado exato.
  if (parcel.source === "pix") return parcel.feeCents !== pixFeeForRate(parcel.grossCents, usualRate);
  if (typeof parcel.feeRate === "number") return Math.abs(Math.round(parcel.feeRate * 10_000) / 10_000 - usualRate) > 0.00005;
  return Math.abs(parcel.feeCents - Math.round(parcel.grossCents * usualRate)) > 1;
}

/**
 * Texto da coluna Taxa. Pix dentro da regra de corte: a taxa atual do grupo e o valor cobrado
 * ("0,75% · R$ 0,01"), porque a taxa efetiva de venda pequena (0,50%) parece divergência sem ser.
 * Demais casos e Pix fora da regra: a taxa efetiva da venda.
 */
export function parcelRateText(parcel: ReceiptParcel, usualRate: number | null) {
  if (parcel.source === "pix" && usualRate !== null && parcel.feeCents !== null && !rateDiffersFromUsual(parcel, usualRate)) {
    return { text: `${rateLabel(usualRate)} · ${centsLabel(parcel.feeCents)}`,
      title: `Taxa ${rateLabel(usualRate)}; a Stone cobrou ${centsLabel(parcel.feeCents)} porque corta os centavos para baixo (efetiva ${rateLabel(parcelFeeRate(parcel))}).` };
  }
  return { text: rateLabel(parcelFeeRate(parcel)), title: undefined };
}
