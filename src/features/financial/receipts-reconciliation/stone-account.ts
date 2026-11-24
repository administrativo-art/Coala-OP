import { z } from "zod";
import type { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { stoneAccountKind, stoneBrandName } from "@/lib/integrations/stone/stone-codes";
import type { SalesMatchFact, SuggestedSalesReconciliationCase } from "../sales-reconciliation/types";

/**
 * 1ª parte da conciliação de recebimentos: a venda (Pix ou cartão) foi paga na conta Stone,
 * com a taxa e no prazo esperados? A prova do pagamento é o arquivo diário de conciliação da
 * Stone; não há extrato da conta Stone. A transferência Stone → Inter é a 2ª parte.
 * Montagem pura: o servidor lê as fontes e a interface só apresenta.
 */

export const MAX_RECEIPT_PERIOD_DAYS = 31;
export const MAX_RECEIPT_PARCELS = 6_000;
const PIX_SAME_DAY_TOLERANCE_DAYS = 1;
const TIME_TOLERANCE_MINUTES = 5;

const civilDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const scopeShape = { kioskId: z.string().trim().min(1).max(180), stoneCode: z.string().regex(/^\d{1,20}$/) };

const monthRequestSchema = z.object({
  view: z.literal("month").optional(),
  ...scopeShape,
  from: civilDateSchema,
  through: civilDateSchema,
  paymentCursor:civilDateSchema.optional(),
  paymentAsOf:civilDateSchema.optional(),
  paymentCohort:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  const days = Math.round((Date.parse(`${value.through}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (value.from > value.through) context.addIssue({ code: z.ZodIssueCode.custom, path: ["through"], message: "O fim deve ser posterior ao início." });
  else if (days > MAX_RECEIPT_PERIOD_DAYS) context.addIssue({ code: z.ZodIssueCode.custom, path: ["through"], message: "Consulte no máximo 31 dias por vez." });
});
const saleRequestSchema = z.object({
  view: z.literal("sale"),
  ...scopeShape,
  saleDate: civilDateSchema,
  paymentDateHint:civilDateSchema.optional(),
  paymentConflictHint:z.boolean().optional(),
  paymentEvidenceDateHints:z.array(civilDateSchema).max(13).optional(),
  source: z.enum(["card", "pix"]),
  saleId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
}).strict();

const savedRequestSchema = z.object({
  view: z.literal("saved"),
  ...scopeShape,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  paymentCursor:civilDateSchema.optional(),
  paymentAsOf:civilDateSchema.optional(),
  paymentCohort:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export const stoneAccountRequestSchema = z.union([monthRequestSchema, saleRequestSchema, savedRequestSchema]);
export type StoneAccountSavedRequest = z.infer<typeof savedRequestSchema>;

/** Primeiro e último dia civil do mês "AAAA-MM". */
export function receiptMonthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, through: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * Meses que a rotina diária reconfere: o do último arquivo publicado e, nos 7 primeiros dias
 * do mês, também o anterior (pagamentos, cancelamentos e revisões tardias da Stone).
 */
export function receiptMonthsToRefresh(latestPublished: string) {
  const month = latestPublished.slice(0, 7);
  if (Number(latestPublished.slice(8, 10)) > 7) return [month];
  const [year, value] = month.split("-").map(Number);
  const previous = value === 1 ? `${year - 1}-12` : `${year}-${String(value - 1).padStart(2, "0")}`;
  return [previous, month];
}
export type StoneAccountMonthRequest = z.infer<typeof monthRequestSchema>;
export type StoneAccountSaleRequest = z.infer<typeof saleRequestSchema>;

type StoneFile = ReturnType<typeof parseStoneAgendaXml>;
type StoneTransaction = StoneFile["transactions"][number];
type StoneInstallment = StoneTransaction["installments"][number];

export type ReceiptModality = "pix" | "debit" | "credit" | "installment" | "other";
export type ReceiptParcelStatus =
  | "paid" | "paid_early" | "paid_late" | "unpaid" | "to_receive" | "missing_file" | "chargeback" | "review";

export type ReceiptParcel = {
  id: string;
  saleId: string;
  source: "card" | "pix";
  installment: number;
  installmentCount: number;
  brandCode: string | null;
  brand: string | null;
  modality: ReceiptModality;
  saleDate: string | null;
  saleTime: string | null;
  grossCents: number;
  feeCents: number | null;
  /** Origem da taxa; ver `FeeSource`. */
  feeSource: FeeSource | null;
  /** Taxa sobre o bruto sem arredondar a centavos; ausente em conferências salvas antes de 2026-11-15. */
  feeRate?: number | null;
  anticipationCents: number | null;
  /** Líquido previsto na origem, antes de antecipação. */
  expectedNetCents: number;
  expectedDate: string | null;
  paymentCoveragePending?: boolean;
  paymentConflict?: boolean;
  paymentEvidenceDates?: string[];
  paidDate: string | null;
  paidNetCents: number | null;
  status: ReceiptParcelStatus;
};

export type StonePortfolioParcel = {
  transactionId: string; installment: number; saleDate: string | null; dueDate: string | null;
  gross: string; net: string; status: "open" | "paid" | "review"; paymentDate: string | null;
};

export type PixSettlementEvidence = {
  eventId: string; e2eId: string; soldOn: string; settledOn: string; feeCents: number; grossCents: number; soldAt: string | null;
};

export type ReceiptDay = {
  date: string;
  parcelCount: number;
  expectedCents: number;
  paidCents: number | null;
  differenceCents: number | null;
  missingFile: boolean;
  reasons: Array<{ kind: "early" | "late_in" | "paid_later" | "unpaid" | "chargeback" | "paid_before" | "review" | "adjustment" | "no_expected" | "unexplained"; cents: number; count: number }>;
};

export type ReceiptGroup = {
  key: string;
  parentKey: string | null;
  label: string;
  modality: ReceiptModality;
  brand: string | null;
  installmentCount: number | null;
  saleCount: number;
  grossCents: number;
  feeCents: number;
  rate: number | null;
  rateMin: number | null;
  rateMax: number | null;
  usualRate: number | null;
  paidCents: number;
  toReceiveCents: number;
  onTimeRatio: number | null;
  pendingCount: number;
  /** Parcelas sem MDR no arquivo, com taxa proposta (bruto − líquido) a verificar. */
  feeToVerifyCount: number;
  parcelIds: string[];
};

const scale = BigInt(1_000_000_000_000);
const centScale = BigInt(10_000_000_000);
/** Decimal Stone (até 12 casas) → centavos inteiros, arredondando metade para longe do zero. */
export function stoneDecimalCents(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^-?\d{1,15}(?:\.\d{1,12})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
  const cents = Number((units + centScale / BigInt(2)) / centScale);
  return negative ? -cents : cents;
}

const addDays = (value: string, amount: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
export function receiptPeriodDates(from: string, through: string) {
  const dates: string[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) dates.push(date);
  return dates;
}
const captureDate = (value: string | null) => value && /^\d{8}/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
const captureTime = (value: string | null) => value && /^\d{14}/.test(value) ? `${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}` : null;
export function belemTime(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
const adverse = (transaction: StoneTransaction) => (transaction.events.Chargebacks ?? 0) > 0 || (transaction.events.CancellationCharges ?? 0) > 0;

export function cardModality(transaction: Pick<StoneTransaction, "accountTypeCode" | "installmentCount">): ReceiptModality {
  const kind = stoneAccountKind(transaction.accountTypeCode);
  if (kind === "debit") return "debit";
  if (kind === "credit") return (transaction.installmentCount ?? 1) > 1 ? "installment" : "credit";
  return "other";
}

type CardOrigin = { transaction: StoneTransaction; file: StoneFile };

function cardParcel(origin: Pick<StoneTransaction, "transactionId" | "brandCode" | "accountTypeCode" | "installmentCount" | "captureLocalDateTime"> | null,
  transactionId: string, installment: number, values: Omit<ReceiptParcel, "id" | "saleId" | "source" | "installment" | "installmentCount" | "brandCode" | "brand" | "modality" | "saleDate" | "saleTime">,
  fallbackSaleDate: string | null): ReceiptParcel {
  return {
    id: `${transactionId}:${installment}`,
    saleId: transactionId,
    source: "card",
    installment,
    installmentCount: origin?.installmentCount ?? 1,
    brandCode: origin?.brandCode ?? null,
    brand: origin?.brandCode ? stoneBrandName(origin.brandCode) : null,
    modality: origin ? cardModality(origin) : "other",
    saleDate: captureDate(origin?.captureLocalDateTime ?? null) ?? fallbackSaleDate,
    saleTime: captureTime(origin?.captureLocalDateTime ?? null),
    ...values,
  };
}

/**
 * Origem da taxa da parcela:
 * - "stone": MDR informado pela Stone (MdrAmount);
 * - "exact": sem MdrAmount, mas o líquido veio com mais de 2 casas (o layout 2.2 manda 6), então
 *   bruto − líquido − antecipação é a taxa exata cobrada, sem arredondamento;
 * - "derived": só há valores em centavos; a retenção é uma taxa proposta, a verificar.
 */
export type FeeSource = "stone" | "exact" | "derived";
export type ResolvedFee = { feeCents: number | null; feeSource: FeeSource | null; feeRate: number | null };

function stoneUnits(value: string | null | undefined): bigint | null {
  if (typeof value !== "string" || !/^-?\d{1,15}(?:\.\d{1,12})?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
  return negative ? -units : units;
}
const unitsToCents = (units: bigint) => Number((units + centScale / BigInt(2)) / centScale);
const RATE_PRECISION = BigInt(100_000_000);
const unitsRate = (part: bigint, whole: bigint) => Number((part * RATE_PRECISION) / whole) / 1e8;

const NO_FEE: ResolvedFee = { feeCents: null, feeSource: null, feeRate: null };
/** Taxa da parcela a partir dos decimais do arquivo, sem arredondar antes de calcular a taxa. */
export function resolveCardFee(values: { mdr?: string | null; gross?: string | null; net?: string | null; anticipation?: string | null }): ResolvedFee {
  const gross = stoneUnits(values.gross);
  if (gross === null || gross <= BigInt(0)) return NO_FEE;
  const mdr = stoneUnits(values.mdr);
  if (mdr !== null) return { feeCents: unitsToCents(mdr), feeSource: "stone", feeRate: unitsRate(mdr, gross) };
  const net = stoneUnits(values.net);
  if (net === null) return NO_FEE;
  const anticipation = stoneUnits(values.anticipation);
  const retained = gross - net - (anticipation !== null && anticipation > BigInt(0) ? anticipation : BigInt(0));
  if (retained < BigInt(0)) return NO_FEE;
  const exact = (values.net!.split(".")[1] ?? "").length > 2;
  // Só centavos: a taxa calculada carrega o arredondamento e não serve como taxa exata.
  return exact
    ? { feeCents: unitsToCents(retained), feeSource: "exact", feeRate: unitsRate(retained, gross) }
    : { feeCents: unitsToCents(retained), feeSource: "derived", feeRate: null };
}

/**
 * Pix: o arquivo traz a taxa em centavos inteiros; a Stone aplica a taxa nominal sobre o bruto e corta
 * os centavos para baixo (nov/2026: 583 de 583 vendas a 0,75%). Por isso a taxa efetiva de cada venda
 * varia (R$ 5,00 → R$ 0,03 = 0,60%) sem que a taxa contratada tenha mudado.
 */
export function pixFeeForRate(grossCents: number, rate: number) {
  return Math.floor((grossCents * Math.round(rate * 10_000)) / 10_000);
}
/** Taxa nominal (grade de 0,01%, até 5%) que explica o maior número de vendas pela regra de corte; desempata pela menor. */
export function truncatedNominalRate(rows: Array<{ grossCents: number; feeCents: number | null }>) {
  const valid = rows.filter(row => row.feeCents !== null && row.grossCents > 0);
  let best: number | null = null; let bestCount = 0;
  for (let basisPoints = 0; basisPoints <= 500; basisPoints++) {
    const rate = basisPoints / 10_000;
    const count = valid.filter(row => pixFeeForRate(row.grossCents, rate) === row.feeCents).length;
    if (count > bestCount) { best = rate; bestCount = count; }
  }
  return best;
}

/** Taxa da parcela: a exata (MDR ou líquido com mais de 2 casas) quando houver; senão taxa em centavos ÷ bruto. */
export function parcelFeeRate(parcel: { feeRate?: number | null; feeCents: number | null; grossCents: number | null }) {
  if (typeof parcel.feeRate === "number") return parcel.feeRate;
  return parcel.feeCents !== null && parcel.grossCents ? parcel.feeCents / parcel.grossCents : null;
}

/** Taxa de um conjunto de parcelas (uma venda), ponderada pelo bruto. */
export function weightedFeeRate(parcels: Array<{ feeRate?: number | null; feeCents: number | null; grossCents: number | null }>) {
  let gross = 0; let weighted = 0;
  for (const parcel of parcels) {
    const rate = parcelFeeRate(parcel);
    if (rate === null || !parcel.grossCents) return null;
    gross += parcel.grossCents; weighted += rate * parcel.grossCents;
  }
  return gross > 0 ? weighted / gross : null;
}

function paidStatus(expected: string | null, paid: string, chargeback: boolean): ReceiptParcelStatus {
  if (chargeback) return "chargeback";
  if (!expected) return "review";
  if (paid < expected) return "paid_early";
  if (paid > expected) return "paid_late";
  return "paid";
}

/** Datas de captura que faltam para explicar pagamentos do período (venda capturada antes do primeiro arquivo lido). */
export function missingOriginDates(files: StoneFile[], from: string, maxDays = 400, maxDates = 60) {
  const captured = new Set<string>();
  for (const file of files) for (const transaction of file.transactions) {
    if (transaction.sourceSection === "FinancialTransactions" && transaction.events.Captures > 0) captured.add(transaction.transactionId);
  }
  const floor = addDays(from, -maxDays);
  const dates = new Set<string>();
  for (const file of files) for (const transaction of file.transactions) {
    if (transaction.sourceSection !== "FinancialTransactionsAccounts" || transaction.events.Payments <= 0 || captured.has(transaction.transactionId)) continue;
    const date = captureDate(transaction.captureLocalDateTime);
    if (date && date < from && date >= floor) dates.add(date);
  }
  return [...dates].sort().reverse().slice(0, maxDates);
}

/** Monta as parcelas do período a partir das fontes já lidas e validadas pelo servidor. */
export function buildStoneAccountParcels(input: {
  from: string; through: string; latestPublished: string;
  files: StoneFile[]; missingDates: string[];
  portfolio: StonePortfolioParcel[] | null;
  pix: PixSettlementEvidence[];
  /** Arquivos de dias anteriores ao período, lidos só para achar a captura de vendas pagas no período (bandeira, previsão, MDR). */
  originFiles?: StoneFile[];
}) {
  const parcels = new Map<string, ReceiptParcel>();
  const conflicts = new Set<string>();
  const origins = new Map<string, CardOrigin>();
  const missing = new Set(input.missingDates);
  const put = (parcel: ReceiptParcel) => {
    const previous = parcels.get(parcel.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(parcel)) {
      conflicts.add(parcel.id);
      parcels.set(parcel.id, { ...previous, status: "review", paymentConflict:true });
      return;
    }
    parcels.set(parcel.id, parcel);
  };

  for (const file of input.files) {
    for (const transaction of file.transactions) {
      if (transaction.sourceSection === "FinancialTransactions" && transaction.events.Captures > 0 && transaction.installments.length) {
        origins.set(transaction.transactionId, { transaction, file });
      }
    }
  }
  // Captura de vendas de meses anteriores: só consulta, não gera parcelas pendentes.
  const lookup = new Map(origins);
  for (const file of input.originFiles ?? []) {
    for (const transaction of file.transactions) {
      if (transaction.sourceSection === "FinancialTransactions" && transaction.events.Captures > 0 && transaction.installments.length
        && !lookup.has(transaction.transactionId)) lookup.set(transaction.transactionId, { transaction, file });
    }
  }

  const portfolioById = new Map((input.portfolio ?? []).map(row => [`${row.transactionId}:${row.installment}`, row]));
  // O arquivo do dia do pagamento nem sempre traz a data prevista: buscar na captura ou na carteira.
  const originExpected = (transactionId: string, number: number) =>
    lookup.get(transactionId)?.transaction.installments.find(row => row.number === number)?.expectedPaymentDate
    ?? portfolioById.get(`${transactionId}:${number}`)?.dueDate ?? null;

  // Pagamentos efetivos na conta Stone: evento Payments no dia do arquivo.
  for (const file of input.files) {
    for (const transaction of file.transactions) {
      if (transaction.sourceSection !== "FinancialTransactionsAccounts" || transaction.events.Payments <= 0) continue;
      for (const installment of transaction.installments) {
        if (!installment.paymentDate || installment.paymentDate !== file.referenceDate) continue;
        const gross = stoneDecimalCents(installment.grossAmount);
        const net = stoneDecimalCents(installment.netAmount);
        if (gross === null || net === null || gross <= 0) continue;
        const anticipation = stoneDecimalCents(installment.advanceRateAmount);
        const expected = installment.advancedReceivableOriginalPaymentDate ?? installment.originalPaymentDate ?? installment.expectedPaymentDate
          ?? originExpected(transaction.transactionId, installment.number);
        const origin = lookup.get(transaction.transactionId)?.transaction ?? transaction;
        const originInstallment = lookup.get(transaction.transactionId)?.transaction.installments.find(row => row.number === installment.number);
        put(cardParcel(origin, transaction.transactionId, installment.number, {
          grossCents: gross,
          ...resolveCardFee({ mdr: installment.mdrAmount ?? originInstallment?.mdrAmount, gross: installment.grossAmount, net: installment.netAmount, anticipation: installment.advanceRateAmount }),
          anticipationCents: anticipation,
          expectedNetCents: net + Math.max(0, anticipation ?? 0),
          expectedDate: expected,
          paidDate: installment.paymentDate,
          paidNetCents: net,
          status: paidStatus(expected, installment.paymentDate, installment.suspendedByChargeback || adverse(transaction)),
        }, captureDate(transaction.captureLocalDateTime)));
      }
    }
  }

  // Parcelas das vendas capturadas no período ainda sem pagamento no recorte.
  for (const { transaction } of origins.values()) {
    for (const installment of transaction.installments) {
      const id = `${transaction.transactionId}:${installment.number}`;
      if (parcels.has(id)) continue;
      const gross = stoneDecimalCents(installment.grossAmount);
      const net = stoneDecimalCents(installment.netAmount);
      if (gross === null || net === null) continue;
      put(cardParcel(transaction, transaction.transactionId, installment.number, {
        grossCents: gross, ...resolveCardFee({ mdr: installment.mdrAmount, gross: installment.grossAmount, net: installment.netAmount }), anticipationCents: null,
        expectedNetCents: net, expectedDate: installment.expectedPaymentDate, paidDate: null, paidNetCents: null,
        status: pendingStatus(installment.expectedPaymentDate, input, missing, adverse(transaction) || installment.suspendedByChargeback),
      }, null));
    }
  }

  // Previsão de vendas anteriores ao período: carteira sincronizada.
  for (const row of input.portfolio ?? []) {
    if (!row.dueDate || row.dueDate < input.from || row.dueDate > input.through) continue;
    const id = `${row.transactionId}:${row.installment}`;
    if (parcels.has(id)) continue;
    const gross = stoneDecimalCents(row.gross);
    const net = stoneDecimalCents(row.net);
    if (gross === null || net === null) continue;
    const origin = origins.get(row.transactionId)?.transaction ?? null;
    const paidBefore = row.status === "paid" && row.paymentDate !== null && row.paymentDate < input.from;
    put(cardParcel(origin, row.transactionId, row.installment, {
      grossCents: gross, ...resolveCardFee({ gross: row.gross, net: row.net }), anticipationCents: null, expectedNetCents: net,
      expectedDate: row.dueDate,
      paidDate: paidBefore ? row.paymentDate : null,
      paidNetCents: null,
      status: paidBefore ? "paid_early" : row.status === "review" ? "review" : pendingStatus(row.dueDate, input, missing, false),
    }, row.saleDate));
  }

  for (const pix of input.pix) {
    if (pix.soldOn < input.from || pix.soldOn > input.through) continue;
    const settled = pix.settledOn <= input.latestPublished ? pix.settledOn : null;
    const late = settled !== null && settled > addDays(pix.soldOn, PIX_SAME_DAY_TOLERANCE_DAYS);
    put({
      id: `pix:${pix.eventId}`, saleId: pix.eventId, source: "pix", installment: 1, installmentCount: 1,
      brandCode: null, brand: null, modality: "pix", saleDate: pix.soldOn, saleTime: belemTime(pix.soldAt),
      grossCents: pix.grossCents, feeCents: pix.feeCents, // Pix: a Stone informa a taxa já em centavos; a conferência tolera esse arredondamento.
      feeSource: "stone", feeRate: null, anticipationCents: null,
      expectedNetCents: pix.grossCents - pix.feeCents, expectedDate: pix.soldOn,
      paidDate: settled, paidNetCents: settled ? pix.grossCents - pix.feeCents : null,
      status: settled ? late ? "paid_late" : "paid" : pendingStatus(pix.soldOn, input, missing, false),
    });
  }

  const list = [...parcels.values()].sort((a, b) =>
    (a.expectedDate ?? "9999").localeCompare(b.expectedDate ?? "9999") || a.id.localeCompare(b.id));
  return { parcels: list, conflictCount: conflicts.size };
}

/** Overlay only exact captured identities; later files never introduce another month's sales. No writes or inferred payments. */
export function applyReceiptPaymentFiles(base:ReceiptParcel[],files:StoneFile[],from:string,through:string,asOf:string){
 const result=new Map(base.map(p=>[p.id,p]));let conflicts=0;
 for(const file of files)for(const tx of file.transactions){
  for(const installment of tx.installments){
   const id=`${tx.transactionId}:${installment.number}`;let original=result.get(id);
   if(!original||original.source!=="card"||!original.saleDate||original.saleDate>through)continue;
   if(file.referenceDate&&file.referenceDate<=asOf&&(adverse(tx)||(tx.events.Cancellations??0)>0||tx.events.Payments>0)){original={...original,paymentEvidenceDates:[...new Set([...(original.paymentEvidenceDates??[]),file.referenceDate])].slice(0,13)};result.set(id,original);}
   if(adverse(tx)||(tx.events.Cancellations??0)>0){result.set(id,{...original,status:"review",paymentCoveragePending:false,paymentConflict:true});conflicts++;continue;}
   if(tx.sourceSection!=="FinancialTransactionsAccounts"||tx.events.Payments<=0||installment.paymentDate!==file.referenceDate||!installment.paymentDate||installment.paymentDate>asOf)continue;
   const gross=stoneDecimalCents(installment.grossAmount),net=stoneDecimalCents(installment.netAmount),advance=stoneDecimalCents(installment.advanceRateAmount);
   if(gross!==original.grossCents||net===null||net<0){result.set(id,{...original,status:"review",paymentCoveragePending:false,paymentConflict:true});conflicts++;continue;}
   if(original.paidDate&&(original.paidDate!==installment.paymentDate||original.paidNetCents!==net)){result.set(id,{...original,status:"review",paymentCoveragePending:false,paymentConflict:true});conflicts++;continue;}
   const expected=installment.advancedReceivableOriginalPaymentDate??installment.originalPaymentDate??installment.expectedPaymentDate??original.expectedDate;
   const fee=resolveCardFee({mdr:installment.mdrAmount??(original.feeCents===null?null:(original.feeCents/100).toFixed(2)),gross:installment.grossAmount,net:installment.netAmount,anticipation:installment.advanceRateAmount});
   result.set(id,{...original,...fee,expectedDate:expected,expectedNetCents:net+Math.max(0,advance??0),anticipationCents:advance,paidDate:installment.paymentDate,paidNetCents:net,status:original.paymentConflict?"review":paidStatus(expected,installment.paymentDate,installment.suspendedByChargeback),paymentCoveragePending:false});
  }
 }
 return{parcels:[...result.values()],conflicts};
}

function pendingStatus(expected: string | null, input: { latestPublished: string }, missing: Set<string>, chargeback: boolean): ReceiptParcelStatus {
  if (chargeback) return "chargeback";
  if (!expected) return "review";
  if (expected > input.latestPublished) return "to_receive";
  if (missing.has(expected)) return "missing_file";
  return "unpaid";
}

/** Previsto × pago na conta Stone por dia de pagamento, com a diferença explicada. */
export function summarizeReceiptDays(parcels: ReceiptParcel[], dates: string[], missingDates: string[]): ReceiptDay[] {
  const missing = new Set(missingDates);
  return dates.map(date => {
    const due = parcels.filter(parcel => parcel.expectedDate === date);
    const paid = parcels.filter(parcel => parcel.paidDate === date && parcel.paidNetCents !== null);
    const expectedCents = due.reduce((sum, parcel) => sum + parcel.expectedNetCents, 0);
    const paidCents = paid.reduce((sum, parcel) => sum + (parcel.paidNetCents ?? 0), 0);
    const reasons: ReceiptDay["reasons"] = [];
    const add = (kind: ReceiptDay["reasons"][number]["kind"], rows: ReceiptParcel[], value: (row: ReceiptParcel) => number) => {
      if (!rows.length) return;
      reasons.push({ kind, count: rows.length, cents: rows.reduce((sum, row) => sum + value(row), 0) });
    };
    add("early", paid.filter(row => row.expectedDate !== null && row.expectedDate > date), row => row.paidNetCents ?? 0);
    add("late_in", paid.filter(row => row.expectedDate !== null && row.expectedDate < date), row => row.paidNetCents ?? 0);
    const dueNotToday = due.filter(row => row.paidDate !== date);
    add("paid_before", dueNotToday.filter(row => row.paidDate !== null && row.paidDate < date), row => -row.expectedNetCents);
    add("paid_later", dueNotToday.filter(row => row.paidDate !== null && row.paidDate > date), row => -row.expectedNetCents);
    add("chargeback", dueNotToday.filter(row => row.paidDate === null && row.status === "chargeback"), row => -row.expectedNetCents);
    add("unpaid", dueNotToday.filter(row => row.paidDate === null && row.status === "unpaid"), row => -row.expectedNetCents);
    add("review", dueNotToday.filter(row => row.paidDate === null && row.status === "review"), row => -row.expectedNetCents);
    add("no_expected", paid.filter(row => row.expectedDate === null), row => row.paidNetCents ?? 0);
    const sameDay = paid.filter(row => row.expectedDate === date);
    const adjustment = sameDay.reduce((sum, row) => sum + (row.paidNetCents ?? 0) - row.expectedNetCents, 0);
    if (adjustment !== 0) reasons.push({ kind: "adjustment", count: sameDay.filter(row => row.paidNetCents !== row.expectedNetCents).length, cents: adjustment });
    const missingFile = missing.has(date);
    // A explicação precisa fechar com a diferença; o que sobrar aparece como "sem explicação", nunca como "bateu".
    const explained = reasons.reduce((sum, reason) => sum + reason.cents, 0);
    const remainder = paidCents - expectedCents - explained;
    if (!missingFile && remainder !== 0) reasons.push({ kind: "unexplained", count: 0, cents: remainder });
    return {
      date, parcelCount: new Set([...due, ...paid].map(row => row.id)).size,
      expectedCents, paidCents: missingFile ? null : paidCents,
      differenceCents: missingFile ? null : paidCents - expectedCents,
      missingFile, reasons,
    };
  });
}

export type ReceiptWeek = {
  index: number;
  from: string;
  through: string;
  days: ReceiptDay[];
  parcelCount: number;
  expectedCents: number;
  paidCents: number;
  /** Diferença só dos dias com arquivo; dia sem arquivo não vira zero. */
  differenceCents: number;
  daysWithDifference: number;
  daysMissingFile: number;
};

/** Agrupa os dias em semanas de segunda a domingo, dentro do período (a primeira e a última podem ser parciais). */
export function groupReceiptWeeks(days: ReceiptDay[]): ReceiptWeek[] {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const buckets: ReceiptDay[][] = [];
  for (const day of ordered) {
    const monday = new Date(`${day.date}T12:00:00Z`).getUTCDay() === 1;
    if (!buckets.length || monday) buckets.push([]);
    buckets[buckets.length - 1].push(day);
  }
  return buckets.map((items, position) => {
    const withFile = items.filter(day => !day.missingFile);
    return {
      index: position + 1,
      from: items[0].date,
      through: items[items.length - 1].date,
      days: items,
      parcelCount: items.reduce((sum, day) => sum + day.parcelCount, 0),
      expectedCents: items.reduce((sum, day) => sum + day.expectedCents, 0),
      paidCents: withFile.reduce((sum, day) => sum + (day.paidCents ?? 0), 0),
      differenceCents: withFile.reduce((sum, day) => sum + (day.differenceCents ?? 0), 0),
      daysWithDifference: withFile.filter(day => (day.differenceCents ?? 0) !== 0).length,
      daysMissingFile: items.length - withFile.length,
    };
  });
}

const MODALITY_LABEL: Record<ReceiptModality, string> = {
  pix: "Pix", debit: "Débito", credit: "Crédito à vista", installment: "Crédito parcelado", other: "Tipo não informado",
};
export const receiptModalityLabel = (modality: ReceiptModality) => MODALITY_LABEL[modality];
const MODALITY_ORDER: ReceiptModality[] = ["pix", "debit", "credit", "installment", "other"];

const roundedRate = (value: number) => Math.round(value * 10_000) / 10_000;
/** Taxa mais frequente (arredondada a 0,01%) entre as vendas; desempata pela menor. */
export function usualRate(rates: number[]) {
  if (!rates.length) return null;
  const counts = new Map<number, number>();
  for (const rate of rates.map(roundedRate)) counts.set(rate, (counts.get(rate) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export const PENDING_RECEIPT_STATUSES: ReceiptParcelStatus[] = ["unpaid", "paid_late", "chargeback", "review", "missing_file"];

/** Vendas feitas no período por bandeira e modalidade; o parcelado também por número de parcelas. */
export function summarizeReceiptGroups(parcels: ReceiptParcel[], from: string, through: string, latestPublished: string): ReceiptGroup[] {
  const cohort = parcels.filter(parcel => parcel.saleDate !== null && parcel.saleDate >= from && parcel.saleDate <= through);
  const build = (key: string, parentKey: string | null, label: string, modality: ReceiptModality, brand: string | null, installmentCount: number | null, rows: ReceiptParcel[]): ReceiptGroup => {
    const sales = new Map<string, ReceiptParcel[]>();
    for (const row of rows) sales.set(row.saleId, [...(sales.get(row.saleId) ?? []), row]);
    const saleRates = [...sales.values()].flatMap(items => {
      const rate = weightedFeeRate(items);
      return rate === null ? [] : [rate];
    });
    const grossCents = rows.reduce((sum, row) => sum + row.grossCents, 0);
    const feeCents = rows.reduce((sum, row) => sum + (row.feeCents ?? 0), 0);
    const due = rows.filter(row => row.expectedDate !== null && row.expectedDate <= latestPublished && row.status !== "missing_file");
    const onTime = due.filter(row => row.status === "paid" || row.status === "paid_early").length;
    return {
      key, parentKey, label, modality, brand, installmentCount,
      saleCount: sales.size, grossCents, feeCents,
      rate: weightedFeeRate(rows) ?? (grossCents > 0 ? feeCents / grossCents : null),
      rateMin: saleRates.length ? Math.min(...saleRates) : null,
      rateMax: saleRates.length ? Math.max(...saleRates) : null,
      usualRate: usualRate(saleRates),
      paidCents: rows.reduce((sum, row) => sum + (row.paidDate !== null && row.paidDate <= latestPublished ? row.paidNetCents ?? 0 : 0), 0),
      toReceiveCents: rows.filter(row => row.status === "to_receive").reduce((sum, row) => sum + row.expectedNetCents, 0),
      onTimeRatio: due.length ? onTime / due.length : null,
      pendingCount: rows.filter(row => PENDING_RECEIPT_STATUSES.includes(row.status)).length,
      feeToVerifyCount: rows.filter(row => row.feeSource === "derived").length,
      parcelIds: rows.map(row => row.id),
    };
  };
  const groups: ReceiptGroup[] = [];
  const pix = cohort.filter(row => row.modality === "pix");
  if (pix.length) {
    const group = build("pix", null, "Pix", "pix", null, null, pix);
    groups.push({ ...group, usualRate: truncatedNominalRate(pix) ?? group.usualRate });
  }
  const brands = [...new Set(cohort.filter(row => row.source === "card").map(row => row.brand ?? "Sem bandeira no arquivo"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const brand of brands) {
    for (const modality of MODALITY_ORDER.slice(1)) {
      const rows = cohort.filter(row => row.source === "card" && (row.brand ?? "Sem bandeira no arquivo") === brand && row.modality === modality);
      if (!rows.length) continue;
      const key = `${brand}|${modality}`;
      groups.push(build(key, null, `${brand} · ${MODALITY_LABEL[modality]}`, modality, brand, null, rows));
      if (modality !== "installment") continue;
      for (const count of [...new Set(rows.map(row => row.installmentCount))].sort((a, b) => a - b)) {
        groups.push(build(`${key}|${count}`, key, `${count}x`, modality, brand, count, rows.filter(row => row.installmentCount === count)));
      }
    }
  }
  return groups;
}

/** Grupo usado para comparar a taxa de uma venda: bandeira, modalidade e, no parcelado, nº de parcelas. */
export function receiptGroupKey(parcel: Pick<ReceiptParcel, "modality" | "brand" | "installmentCount" | "source">) {
  if (parcel.modality === "pix") return "pix";
  const base = `${parcel.brand ?? "Sem bandeira no arquivo"}|${parcel.modality}`;
  return parcel.modality === "installment" ? `${base}|${parcel.installmentCount}` : base;
}

// ---------- auditoria da venda ----------

export type SaleAuditInstallment = {
  number: number;
  grossCents: number | null;
  feeCents: number | null;
  feeSource: FeeSource | null;
  feeRate?: number | null;
  anticipationCents: number | null;
  netCents: number | null;
  expectedDate: string | null;
  originalDate: string | null;
  paidDate: string | null;
  paymentId: string | null;
  paymentEventCount: number;
  suspendedByChargeback: boolean;
  file: { id: string; referenceDate: string | null; generatedAt: string } | null;
  status: ReceiptParcelStatus;
};

export type SaleAudit = {
  source: "card" | "pix";
  saleId: string;
  saleDate: string;
  kioskId: string;
  stoneCode: string;
  stone: {
    transactionId: string | null;
    e2eId: string | null;
    eventId: string | null;
    captureLocalDateTime: string | null;
    saleTime: string | null;
    authorizationDateTimeUtc: string | null;
    brandCode: string | null;
    brand: string | null;
    accountTypeCode: string | null;
    feeTypeCode: string | null;
    modality: ReceiptModality;
    installmentCount: number;
    capturedCents: number | null;
    canceledCents: number | null;
    events: Record<string, number>;
    originFile: { id: string; referenceDate: string | null; generatedAt: string } | null;
  };
  installments: SaleAuditInstallment[];
  pdv: {
    review: "not_recorded" | "recorded";
    reviewStatus: "closed" | "attention_required" | "awaiting_source" | null;
    caseKind: SuggestedSalesReconciliationCase["kind"] | null;
    matchBasis: SuggestedSalesReconciliationCase["matchBasis"] | null;
    confidence: SuggestedSalesReconciliationCase["confidence"] | null;
    coupons: Array<{
      couponId: string | null; soldAt: string; channel: SalesMatchFact["channel"]; grossCents: number;
      status: SalesMatchFact["status"]; nsu: string | null; authorizationCode: string | null;
      terminalId: string | null; merchantOrderId: string | null;
    }>;
  };
};

export type AuditCheckResult = "ok" | "bad" | "warn" | "wait";
export type AuditCheck = { id: number; title: string; compared: string; pdv: string; stone: string; result: AuditCheckResult; note: string | null };

const money = (cents: number | null) => cents === null ? "—"
  : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(2).replace(".", ",")}%`;
const shortDate = (value: string | null) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "—";
const BASIS: Record<SuggestedSalesReconciliationCase["matchBasis"], string> = {
  provider_transaction_id: "ID da transação na Stone",
  provider_event_id: "ID do evento Pix",
  nsu_authorization_terminal: "NSU + autorização + terminal",
  merchant_order: "número do pedido",
  unique_amount_time: "valor e horário únicos no dia",
  daily_amount_multiset: "valores do dia",
  candidate_group: "grupo de candidatos",
  unmatched: "sem par",
};
const CONFIDENCE = { high: "alta", medium: "média", none: "nenhuma" } as const;
const CHANNEL: Record<SalesMatchFact["channel"], string> = { pix: "Pix", debit_card: "Débito", credit_card: "Crédito", voucher: "Voucher" };
const PDV_STATUS: Record<SalesMatchFact["status"], string> = {
  approved: "Aprovada", pending: "Finalizada", partial_cancellation: "Cancelamento parcial", cancelled: "Cancelada", refunded: "Estornada", chargeback: "Chargeback",
};
export const pdvStatusLabel = (status: SalesMatchFact["status"]) => PDV_STATUS[status];
export const pdvChannelLabel = (channel: SalesMatchFact["channel"]) => CHANNEL[channel];
export const matchBasisLabel = (basis: SuggestedSalesReconciliationCase["matchBasis"]) => BASIS[basis];

function minutesBetween(pdvIso: string, stoneLocal: string | null) {
  if (!stoneLocal || !/^\d{14}/.test(stoneLocal)) return null;
  const stone = Date.parse(`${stoneLocal.slice(0, 4)}-${stoneLocal.slice(4, 6)}-${stoneLocal.slice(6, 8)}T${stoneLocal.slice(8, 10)}:${stoneLocal.slice(10, 12)}:${stoneLocal.slice(12, 14)}-03:00`);
  const pdvValue = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(pdvIso) ? pdvIso.replace(" ", "T") : `${pdvIso.replace(" ", "T")}-03:00`;
  const pdv = Date.parse(pdvValue);
  return Number.isFinite(stone) && Number.isFinite(pdv) ? Math.abs(stone - pdv) / 60_000 : null;
}

/**
 * Os 12 cruzamentos da venda. `groupUsualRate` vem do resumo do período (mesmo cartão e parcelas);
 * sem tabela contratada, diferença de taxa é "conferir", nunca cobrança a maior.
 */
export function saleAuditChecks(audit: SaleAudit, groupUsualRate: number | null): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const add = (title: string, compared: string, pdv: string, stone: string, result: AuditCheckResult, note: string | null = null) =>
    checks.push({ id: checks.length + 1, title, compared, pdv, stone, result, note });
  const coupon = audit.pdv.coupons[0] ?? null;
  const card = audit.source === "card";
  const recorded = audit.pdv.review === "recorded";
  const kind = audit.pdv.caseKind;
  const stoneKey = card ? `transação ${audit.stone.transactionId}` : `e2eId ${audit.stone.e2eId ?? "—"}`;

  if (!recorded) add("A venda existe no PDV e na Stone", "Cruzamento salvo pela Conciliação de vendas", "conferência do dia não registrada", stoneKey, "wait",
    "Feche o dia na Conciliação de vendas para comparar com o cupom do PDV.");
  else if (!coupon || kind === "stone_only") add("A venda existe no PDV e na Stone", "Nenhuma chave encontrou cupom no PDV", "sem cupom", stoneKey, "bad",
    "Venda na maquininha sem registro no PDV deste dia (ou registrada em outra unidade).");
  else add("A venda existe no PDV e na Stone",
    `Chave usada: ${BASIS[audit.pdv.matchBasis ?? "unmatched"]} (confiança ${CONFIDENCE[audit.pdv.confidence ?? "none"]})`,
    `cupom ${coupon.couponId ?? "—"}${coupon.nsu ? ` · NSU ${coupon.nsu}` : ""}`, stoneKey,
    kind === "ambiguous" || audit.pdv.confidence === "none" ? "warn" : "ok",
    kind === "ambiguous" ? "Mais de um cupom possível; a Conciliação de vendas pede revisão." : null);

  const unitBad = kind === "unit_mismatch" || kind === "unit_unmapped";
  add("Mesma unidade", "StoneCode → unidade pelo vínculo oficial", coupon ? "unidade do PDV consultado" : "—",
    `StoneCode ${audit.stoneCode}`, !recorded ? "wait" : unitBad ? "bad" : "ok", unitBad ? "A venda aparece em unidade diferente do vínculo." : null);

  const captured = audit.stone.capturedCents;
  const couponGross = coupon ? audit.pdv.coupons.reduce((sum, row) => sum + row.grossCents, 0) : null;
  add("Mesmo valor bruto", "Valor do cupom × valor capturado na Stone", money(couponGross), money(captured),
    couponGross === null || captured === null ? recorded ? "bad" : "wait" : couponGross === captured ? "ok" : "bad",
    couponGross !== null && captured !== null && couponGross !== captured ? `Diferença de ${money(captured - couponGross)}.` : null);

  const stoneChannel = audit.source === "pix" ? "pix" : audit.stone.accountTypeCode === "5" ? "voucher"
    : stoneAccountKind(audit.stone.accountTypeCode) === "debit" ? "debit_card" : "credit_card";
  add("Mesmo meio de pagamento", "Meio do PDV × tipo de conta na Stone", coupon ? CHANNEL[coupon.channel] : "—",
    stoneChannel === "pix" || stoneChannel === "voucher" ? CHANNEL[stoneChannel] : MODALITY_LABEL[audit.stone.modality],
    !coupon ? recorded ? "bad" : "wait" : coupon.channel === stoneChannel ? "ok" : "bad");

  const minutes = coupon ? minutesBetween(coupon.soldAt, audit.stone.captureLocalDateTime) : null;
  add("Horário compatível", "Hora do cupom × captura na Stone", coupon ? belemTime(coupon.soldAt) ?? "—" : "—", audit.stone.saleTime ?? "—",
    !coupon ? recorded ? "bad" : "wait" : minutes === null ? (audit.source === "pix" ? "ok" : "warn") : minutes <= TIME_TOLERANCE_MINUTES ? "ok" : "warn",
    minutes !== null && minutes > TIME_TOLERANCE_MINUTES ? `Diferença de ${Math.round(minutes)} min.` : null);

  const events = audit.stone.events;
  const adverseEvents = (events.Cancellations ?? 0) + (events.CancellationCharges ?? 0) + (events.Chargebacks ?? 0) > 0
    || audit.installments.some(row => row.suspendedByChargeback);
  const eventText = Object.entries(events).filter(([, value]) => value > 0).map(([key, value]) => `${key} ${value}`).join(" · ") || "sem eventos";
  add("Situação compatível", "Status do cupom × eventos Stone (cancelamento, chargeback)", coupon ? PDV_STATUS[coupon.status] : "—", eventText,
    adverseEvents || kind === "status_mismatch" ? "bad" : "ok",
    adverseEvents ? "Cancelamento ou chargeback na Stone: o valor pode ser descontado do pagamento." : kind === "status_mismatch" ? "Status do cupom diverge da Stone." : null);

  const expectedCount = audit.stone.installmentCount;
  add("Parcelas completas", "Nº de parcelas da venda × parcelas no arquivo", `${expectedCount}x`, `${audit.installments.length} parcela(s)`,
    audit.installments.length === expectedCount ? "ok" : "bad");

  const installmentGross = audit.installments.every(row => row.grossCents !== null)
    ? audit.installments.reduce((sum, row) => sum + (row.grossCents ?? 0), 0) : null;
  const netCaptured = captured === null ? null : captured - (audit.stone.canceledCents ?? 0);
  add("Soma das parcelas", "Σ bruto das parcelas × capturado − cancelado", money(installmentGross), money(netCaptured),
    installmentGross === null || netCaptured === null ? "warn" : Math.abs(installmentGross - netCaptured) <= audit.installments.length ? "ok" : "bad");

  const gross = installmentGross ?? captured;
  const fee = audit.installments.every(row => row.feeCents !== null) ? audit.installments.reduce((sum, row) => sum + (row.feeCents ?? 0), 0) : null;
  const rate = audit.installments.length && audit.installments.every(row => row.grossCents) ? weightedFeeRate(audit.installments) : gross && fee !== null ? fee / gross : null;
  const rateDiffers = audit.source === "pix"
    ? groupUsualRate !== null && gross !== null && fee !== null && fee !== pixFeeForRate(gross, groupUsualRate)
    : rate !== null && groupUsualRate !== null && Math.abs(roundedRate(rate) - groupUsualRate) > 0.00005;
  const derivedFee = audit.installments.some(row => row.feeSource === "derived");
  add("Taxa conforme o grupo", "Taxa praticada × taxa mais comum no mesmo cartão e parcelas", `${percent(rate)}${derivedFee ? " (proposta)" : ""}`, groupUsualRate === null ? "sem referência" : `habitual ${percent(groupUsualRate)}`,
    rate === null || derivedFee ? "warn" : groupUsualRate === null ? "wait" : rateDiffers ? "warn" : "ok",
    derivedFee ? `Verificar taxa: a Stone não mandou o MDR (MdrAmount) desta venda. Taxa proposta = bruto − líquido${rateDiffers ? `, diferente da habitual do grupo (${percent(groupUsualRate)})` : ""}.`
      : rateDiffers ? "Taxa diferente das outras vendas do mesmo grupo. Sem tabela contratada no sistema, não dá para afirmar cobrança a maior." : null);

  const netMismatch = audit.installments.filter(row => row.grossCents !== null && row.netCents !== null && row.feeCents !== null
    && Math.abs(row.grossCents - (row.feeCents ?? 0) - (row.anticipationCents ?? 0) - row.netCents) > 1);
  const totalNet = audit.installments.every(row => row.netCents !== null) ? audit.installments.reduce((sum, row) => sum + (row.netCents ?? 0), 0) : null;
  const totalAdvance = audit.installments.reduce((sum, row) => sum + (row.anticipationCents ?? 0), 0);
  add("Líquido = bruto − taxas", derivedFee ? "Sem MDR no arquivo: o líquido não pode ser conferido de forma independente" : "Por parcela: bruto − MDR − antecipação = líquido",
    `${money(gross)} − ${money(fee)}${totalAdvance ? ` − ${money(totalAdvance)}` : ""}`, money(totalNet),
    fee === null || totalNet === null ? "warn" : netMismatch.length ? "bad" : "ok",
    netMismatch.length ? `${netMismatch.length} parcela(s) com líquido diferente do cálculo.` : null);

  const late = audit.installments.filter(row => row.status === "paid_late" || row.status === "unpaid");
  const missingFile = audit.installments.some(row => row.status === "missing_file");
  const waiting = audit.installments.some(row => row.status === "to_receive");
  add("Pago na data prevista", "PrevisionPaymentDate × PaymentDate de cada parcela",
    audit.installments.map(row => shortDate(row.originalDate ?? row.expectedDate)).join(", "),
    audit.installments.map(row => shortDate(row.paidDate)).join(", "),
    late.length ? "bad" : missingFile ? "warn" : waiting ? "wait" : "ok",
    late.length ? `${late.length} parcela(s) paga(s) com atraso ou não paga(s).` : missingFile ? "Arquivo Stone do dia previsto não recebido." : null);

  const paidRows = audit.installments.filter(row => row.paidDate !== null);
  const duplicated = paidRows.filter(row => row.paymentEventCount > 1);
  add("Um pagamento por parcela", "Eventos Payments × parcelas pagas", `${paidRows.length} parcela(s) paga(s)`,
    `${paidRows.reduce((sum, row) => sum + Math.max(1, row.paymentEventCount), 0)} evento(s)`,
    duplicated.length ? "bad" : "ok", duplicated.length ? "Há parcela com mais de um evento de pagamento." : null);
  return checks;
}

export function saleAuditVerdict(checks: AuditCheck[]): { label: string; tone: "ok" | "danger" | "warn" | "info" } {
  if (checks.some(check => check.result === "bad")) return { label: "Com divergência", tone: "danger" };
  if (checks.some(check => check.result === "warn")) return { label: "Conferir", tone: "warn" };
  if (checks.some(check => check.result === "wait")) return { label: "Em andamento", tone: "info" };
  return { label: "Conferida", tone: "ok" };
}

/** Parcelas de uma venda de cartão a partir do arquivo de origem e dos arquivos de pagamento. */
export function cardSaleInstallments(input: {
  origin: StoneTransaction | null; payments: Array<{ file: StoneFile; transaction: StoneTransaction; installment: StoneInstallment }>;
  portfolio: StonePortfolioParcel[]; latestPublished: string; missingDates: string[];
  adverseTransactions?: StoneTransaction[];
}): SaleAuditInstallment[] {
  const missing = new Set(input.missingDates);
  const numbers = new Set<number>([
    ...(input.origin?.installments.map(row => row.number) ?? []),
    ...input.portfolio.map(row => row.installment),
    ...input.payments.map(row => row.installment.number),
  ]);
  return [...numbers].sort((a, b) => a - b).map(number => {
    const origin = input.origin?.installments.find(row => row.number === number) ?? null;
    const paid = input.payments.filter(row => row.installment.number === number);
    const conflicting = paid.some(row=>adverse(row.transaction)||(row.transaction.events.Cancellations??0)>0||(origin&&stoneDecimalCents(row.installment.grossAmount)!==stoneDecimalCents(origin.grossAmount)))
      || [input.origin,...(input.adverseTransactions??[])].some(tx=>tx&&tx.installments.some(i=>i.number===number)&&(adverse(tx)||(tx.events.Cancellations??0)>0));
    const payment = paid[0] ?? null;
    const portfolio = input.portfolio.find(row => row.installment === number) ?? null;
    const expected = origin?.expectedPaymentDate ?? portfolio?.dueDate ?? null;
    const original = payment?.installment.advancedReceivableOriginalPaymentDate ?? payment?.installment.originalPaymentDate ?? null;
    const paidDate = payment?.installment.paymentDate ?? (portfolio?.status === "paid" ? portfolio.paymentDate : null);
    const chargeback = (origin?.suspendedByChargeback ?? false) || (payment?.installment.suspendedByChargeback ?? false);
    const anticipation = stoneDecimalCents(payment?.installment.advanceRateAmount);
    const grossCents = stoneDecimalCents(payment?.installment.grossAmount ?? origin?.grossAmount ?? portfolio?.gross);
    const netCents = stoneDecimalCents(payment?.installment.netAmount ?? origin?.netAmount ?? portfolio?.net);
    return {
      number,
      grossCents,
      ...resolveCardFee({
        mdr: payment?.installment.mdrAmount ?? origin?.mdrAmount,
        gross: payment?.installment.grossAmount ?? origin?.grossAmount ?? portfolio?.gross,
        net: payment?.installment.netAmount ?? origin?.netAmount ?? portfolio?.net,
        anticipation: payment?.installment.advanceRateAmount,
      }),
      anticipationCents: anticipation,
      netCents,
      expectedDate: expected,
      originalDate: original,
      paidDate,
      paymentId: payment?.installment.paymentId ?? null,
      paymentEventCount: paid.length,
      suspendedByChargeback: chargeback,
      file: payment ? { id: payment.file.fileId, referenceDate: payment.file.referenceDate, generatedAt: payment.file.generatedAtProvider } : null,
      status: conflicting||paid.length>1 ? "review" : paidDate ? paidStatus(original ?? expected, paidDate, chargeback)
        : portfolio?.status === "review" ? "review" : pendingStatus(expected, input, missing, chargeback),
    };
  });
}

// ---------- antecipações (aba Antecipações, alternativa C10) ----------

export type AnticipationItem = {
  id: string; saleId: string; brand: string | null; modality: ReceiptModality;
  installment: number; installmentCount: number;
  paidDate: string; originalDate: string; days: number;
  /** Líquido que a Stone pagaria no vencimento original (antes da antecipação). */
  baseCents: number; costCents: number; paidCents: number;
  /** Custo ÷ (base × dias ÷ 30): taxa efetiva ao mês. */
  monthlyRate: number | null;
};

const civilDays = (from: string, through: string) =>
  Math.round((Date.parse(`${through}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Parcelas pagas antes do vencimento original com custo de antecipação, a partir das parcelas do mês. */
export function anticipationItems(parcels: ReceiptParcel[]): AnticipationItem[] {
  return parcels.flatMap(parcel => {
    if (parcel.source !== "card" || !parcel.paidDate || !parcel.expectedDate || parcel.paidDate >= parcel.expectedDate) return [];
    const cost = Math.max(0, parcel.anticipationCents ?? 0);
    const days = civilDays(parcel.paidDate, parcel.expectedDate);
    return [{
      id: parcel.id, saleId: parcel.saleId, brand: parcel.brand, modality: parcel.modality,
      installment: parcel.installment, installmentCount: parcel.installmentCount,
      paidDate: parcel.paidDate, originalDate: parcel.expectedDate, days,
      baseCents: parcel.expectedNetCents, costCents: cost, paidCents: parcel.paidNetCents ?? parcel.expectedNetCents - cost,
      monthlyRate: parcel.expectedNetCents > 0 && days > 0 ? cost / (parcel.expectedNetCents * days / 30) : null,
    }];
  }).sort((a, b) => b.paidDate.localeCompare(a.paidDate) || a.id.localeCompare(b.id));
}

/** Taxa efetiva a.m. ponderada por valor × dias. */
export function weightedMonthlyRate(items: AnticipationItem[]) {
  const weight = items.reduce((sum, item) => sum + item.baseCents * item.days, 0);
  return weight > 0 ? items.reduce((sum, item) => sum + item.costCents, 0) / weight * 30 : null;
}

const mondayOfDate = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
};
export function anticipationWeeks(items: AnticipationItem[]) {
  const groups = new Map<string, AnticipationItem[]>();
  for (const item of items) groups.set(mondayOfDate(item.paidDate), [...(groups.get(mondayOfDate(item.paidDate)) ?? []), item]);
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([from, list]) => ({
    from, items: list,
    baseCents: list.reduce((sum, item) => sum + item.baseCents, 0),
    costCents: list.reduce((sum, item) => sum + item.costCents, 0),
    monthlyRate: weightedMonthlyRate(list),
  }));
}
