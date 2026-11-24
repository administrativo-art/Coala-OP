import { z } from "zod";
import { receiptMonthRange, type ReceiptParcel } from "./stone-account";

/**
 * Despesa do mês com as taxas da Stone (passo 6 da conciliação). Uma despesa por tipo — Pix, débito
 * e crédito — na conta "Taxas de cartão", já paga na origem (a Stone descontou do repasse).
 * Competência = mês da venda. Só pode ser lançada com o mês fechado e sem pendências.
 */
export type FeeExpenseKind = "pix" | "debit" | "credit";
export const FEE_EXPENSE_LABEL: Record<FeeExpenseKind, string> = { pix: "Taxa Pix", debit: "Taxa de débito", credit: "Taxa de crédito" };
const ORDER: FeeExpenseKind[] = ["pix", "debit", "credit"];

export type FeeExpenseItem = { kind: FeeExpenseKind; label: string; amountCents: number; saleCount: number };
export type FeeExpensePlan = {
  month: string;
  items: FeeExpenseItem[];
  totalCents: number;
  /** Motivos que impedem o lançamento, em linguagem do operador. Vazio = pode lançar. */
  blockers: string[];
  fingerprint: string;
};

export type FeeExpensePlanInput = {
  month: string;
  /** Conferência salva do mês; null = ainda não conferido. */
  result: { latestPublished: string; parcels: ReceiptParcel[] } | null;
  /** Pendências abertas na aba Taxas (exceções, mudanças de taxa, cobranças). */
  pendingCount: number;
  /** Grupos do mês ainda sem taxa atual confirmada pelo operador. */
  unconfirmedGroups: string[];
};

const kindOf = (parcel: ReceiptParcel): FeeExpenseKind | null => parcel.source === "pix" ? "pix"
  : parcel.modality === "debit" ? "debit" : parcel.modality === "credit" || parcel.modality === "installment" ? "credit" : null;

const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export function planFeeMonthExpense(input: FeeExpensePlanInput): FeeExpensePlan {
  const blockers: string[] = [];
  const range = receiptMonthRange(input.month);
  const sales = (input.result?.parcels ?? []).filter(parcel => parcel.saleDate?.startsWith(input.month));
  if (!input.result) blockers.push("O mês ainda não foi conferido.");
  else if (input.result.latestPublished < range.through) blockers.push(`O mês ainda não fechou: falta o arquivo da Stone até ${dayLabel(range.through)}.`);
  if (input.pendingCount > 0) blockers.push(`Há ${input.pendingCount} pendência(s) na aba Taxas.`);
  if (input.unconfirmedGroups.length) blockers.push(`Confirme a taxa atual de: ${input.unconfirmedGroups.join(", ")}.`);
  const review = sales.filter(parcel => parcel.status === "review").length;
  if (review) blockers.push(`${review} parcela(s) em "Conferir" no Recebido.`);
  const noFee = sales.filter(parcel => parcel.feeCents === null || parcel.feeSource === "derived").length;
  if (noFee) blockers.push(`${noFee} venda(s) sem taxa exata da Stone.`);
  const unknown = sales.filter(parcel => kindOf(parcel) === null).length;
  if (unknown) blockers.push(`${unknown} venda(s) com tipo de cartão não informado.`);

  const items = ORDER.map(kind => {
    const rows = sales.filter(parcel => kindOf(parcel) === kind);
    return { kind, label: FEE_EXPENSE_LABEL[kind], amountCents: rows.reduce((sum, row) => sum + (row.feeCents ?? 0), 0), saleCount: new Set(rows.map(row => row.saleId)).size };
  }).filter(item => item.amountCents > 0);
  if (input.result && !blockers.length && !items.length) blockers.push("Não há taxa a lançar neste mês.");
  // Identifica os valores conferidos; o servidor recalcula e recusa se mudaram desde a tela.
  const fingerprint = [input.month, ...items.map(item => `${item.kind}:${item.amountCents}`)].join("|");
  return { month: input.month, items, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0), blockers, fingerprint };
}

export const feeExpenseActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("launch"), kioskId: z.string().trim().min(1).max(180), stoneCode: z.string().regex(/^\d{1,20}$/),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), fingerprint: z.string().regex(/^\d{4}-\d{2}(\|(pix|debit|credit):\d{1,12}){0,3}$/),
    resultCenterId: z.string().regex(/^[^/]{1,180}$/) }).strict(),
  z.object({ action: z.literal("cancel"), kioskId: z.string().trim().min(1).max(180), stoneCode: z.string().regex(/^\d{1,20}$/),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), reason: z.string().trim().min(3).max(500) }).strict(),
]);
export type FeeExpenseAction = z.infer<typeof feeExpenseActionSchema>;

export type FeeExpenseRecordView = {
  active: boolean; revision: number; launchedAt: string; resultCenterName: string;
  items: Array<{ kind: FeeExpenseKind; amountCents: number; expenseId: string }>;
  cancelledAt: string | null; cancelReason: string | null;
};
export type FeeExpenseStatus = {
  plan: FeeExpensePlan;
  record: FeeExpenseRecordView | null;
  centers: Array<{ id: string; name: string }>;
  accountName: string;
};
