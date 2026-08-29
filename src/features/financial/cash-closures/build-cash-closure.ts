import {
  isPdvAutoCountedChannel,
  type CashClosureChannel,
  normalizeChannel,
} from "./channel-normalization";
import { closureDateFromIso, compareClosureTimestamps } from "./date";
import { sumCents, toCents } from "./money";
import { type ParsedCoupon, parsePdvCoupons } from "./pdv-coupon-parser";
import type {
  BuiltCashClosure,
  BuiltCashClosureLine,
  CashClosureBuildContext,
  CashClosureSource,
} from "./types";

const MAX_INTEGRITY_WARNINGS = 20;

type OperatorChannelAccumulator = {
  operatorId: string;
  operatorName: string;
  channel: CashClosureChannel;
  channelLabel: string;
  expectedAmountCents: number;
  grossCashCents: number;
  changeCents: number;
  supplyCents: number;
  withdrawalCents: number;
  cashMovements: NonNullable<BuiltCashClosureLine["metadata"]["cashMovements"]>;
  paymentRowCount: number;
  rawPaymentNames: Set<string>;
};

type OperatorInterval = {
  firstCouponAt: string;
  lastCouponAt: string;
};

function accumulatorKey(operatorId: string, channel: CashClosureChannel): string {
  return `${operatorId}::${channel}`;
}

function safeClosureDate(coupon: ParsedCoupon, warnings: string[]): string | null {
  try {
    return closureDateFromIso(coupon.timestamp);
  } catch {
    warnings.push(`Cupom ${coupon.couponId}: data "${coupon.timestamp}" inválida, ignorado.`);
    return null;
  }
}

function pushCapped(list: string[], message: string) {
  if (list.length < MAX_INTEGRITY_WARNINGS) {
    list.push(message);
  } else if (list.length === MAX_INTEGRITY_WARNINGS) {
    list.push("… mais divergências de integridade omitidas (limite de exibição atingido).");
  }
}

/**
 * Motor de fechamento (Fase 1): dado o payload bruto de `GET /cupom/get` e o
 * contexto da unidade/dia, produz a estrutura completa de valor esperado por
 * operador × canal, em centavos. Não persiste nada e não decide status de
 * aprovação — isso é das fases seguintes.
 */
export function buildCashClosureFromPdv(rawCoupons: unknown, ctx: CashClosureBuildContext): BuiltCashClosure {
  const { coupons, parseWarnings } = parsePdvCoupons(rawCoupons);

  const integrityWarnings = [...parseWarnings];
  const rawPaymentNames = new Set<string>();
  const unknownPaymentNames = new Set<string>();
  const accumulators = new Map<string, OperatorChannelAccumulator>();
  const operatorIntervals = new Map<string, OperatorInterval>();
  const expectedByChannelCents: Partial<Record<CashClosureChannel, number>> = {};

  const source: CashClosureSource = {
    provider: "pdvlegal",
    endpoint: "cupom/get",
    couponCount: 0,
    validCouponCount: 0,
    ignoredCancelledCouponCount: 0,
    estornadoCouponCount: 0,
    itemCount: 0,
    paymentRowCount: 0,
    rawPaymentNames: [],
    unknownPaymentNames: [],
    integrityWarnings,
    movementEndpoints: ["sangriasuprimento/getSangria", "sangriasuprimento/getSuprimento"],
    movementCount: 0,
    ignoredCancelledMovementCount: 0,
    ignoredNonCashMovementCount: 0,
    unassignedMovementCount: 0,
  };

  let expectedTotalCents = 0;

  for (const coupon of coupons) {
    const couponDate = safeClosureDate(coupon, integrityWarnings);
    // Cupons fora do dia-alvo só existem porque a janela de busca pode ser
    // mais larga que um dia (para cobrir fronteira de fuso); descartados aqui.
    if (couponDate === null || couponDate !== ctx.date) continue;

    source.couponCount++;
    source.itemCount += coupon.itemCount;
    if (coupon.isStorned) source.estornadoCouponCount++;

    const isFullyCancelled = coupon.isCancelled && !coupon.hasExplicitItemCancellation;
    if (isFullyCancelled) {
      source.ignoredCancelledCouponCount++;
      continue;
    }

    source.validCouponCount++;

    const operatorId = coupon.operatorId ?? "unknown";
    const operatorName = ctx.operatorNameById?.[operatorId] ?? (coupon.operatorId ? operatorId : "Operador não identificado");
    if (!coupon.operatorId) {
      pushCapped(integrityWarnings, `Cupom ${coupon.couponId}: sem usuariorecebimento_id, agrupado em "unknown".`);
    }

    if (coupon.paymentRows.length > 0) {
      const currentInterval = operatorIntervals.get(operatorId);
      operatorIntervals.set(operatorId, {
        firstCouponAt:
          !currentInterval || compareClosureTimestamps(coupon.timestamp, currentInterval.firstCouponAt) < 0
            ? coupon.timestamp
            : currentInterval.firstCouponAt,
        lastCouponAt:
          !currentInterval || compareClosureTimestamps(coupon.timestamp, currentInterval.lastCouponAt) > 0
            ? coupon.timestamp
            : currentInterval.lastCouponAt,
      });
    }

    let couponNetCents = 0;

    for (const row of coupon.paymentRows) {
      source.paymentRowCount++;
      rawPaymentNames.add(row.rawName);

      const normalized = normalizeChannel(row.rawName);
      if (normalized.channel === "other") unknownPaymentNames.add(row.rawName);

      const signedCents = toCents(row.amount) * normalized.sign;
      couponNetCents += signedCents;

      const key = accumulatorKey(operatorId, normalized.channel);
      let acc = accumulators.get(key);
      if (!acc) {
        acc = {
          operatorId,
          operatorName,
          channel: normalized.channel,
          channelLabel: normalized.label,
          expectedAmountCents: 0,
          grossCashCents: 0,
          changeCents: 0,
          supplyCents: 0,
          withdrawalCents: 0,
          cashMovements: [],
          paymentRowCount: 0,
          rawPaymentNames: new Set(),
        };
        accumulators.set(key, acc);
      }
      acc.expectedAmountCents += signedCents;
      acc.paymentRowCount++;
      acc.rawPaymentNames.add(row.rawName);
      if (normalized.channel === "cash") {
        if (normalized.isCashChange) acc.changeCents += toCents(row.amount);
        else acc.grossCashCents += toCents(row.amount);
      }

      expectedByChannelCents[normalized.channel] = sumCents(
        expectedByChannelCents[normalized.channel] ?? 0,
        signedCents,
      );
      expectedTotalCents = sumCents(expectedTotalCents, signedCents);
    }

    const reportedCents = toCents(coupon.totalAmount);
    if (reportedCents !== couponNetCents) {
      pushCapped(
        integrityWarnings,
        `Cupom ${coupon.couponId}: total líquido das formas de pagamento (${couponNetCents}) ` +
          `difere do valortotal do PDV (${reportedCents}).`,
      );
    }
  }

  const knownOperatorIds = new Set([
    ...Object.keys(ctx.operatorNameById ?? {}),
    ...Array.from(accumulators.values(), (accumulator) => accumulator.operatorId),
  ]);
  for (const movement of ctx.cashMovements ?? []) {
    if (movement.date !== ctx.date) continue;
    if (movement.cancelled) {
      source.ignoredCancelledMovementCount = (source.ignoredCancelledMovementCount ?? 0) + 1;
      continue;
    }
    // O PDV usa codformapgto=0 em suprimentos físicos; por contrato, todo
    // suprimento ativo entra no caixa. Somente sangrias precisam estar
    // classificadas como dinheiro no catálogo.
    if (movement.kind === "withdrawal" && !movement.isCash) {
      source.ignoredNonCashMovementCount = (source.ignoredNonCashMovementCount ?? 0) + 1;
      continue;
    }
    if (!movement.operatorId || !knownOperatorIds.has(movement.operatorId)) {
      source.unassignedMovementCount = (source.unassignedMovementCount ?? 0) + 1;
      pushCapped(
        integrityWarnings,
        `${movement.kind === "supply" ? "Suprimento" : "Sangria"} ${movement.id}: operador não reconhecido; movimento não atribuído.`,
      );
      continue;
    }

    const key = accumulatorKey(movement.operatorId, "cash");
    let acc = accumulators.get(key);
    if (!acc) {
      acc = {
        operatorId: movement.operatorId,
        operatorName: ctx.operatorNameById?.[movement.operatorId] ?? movement.operatorId,
        channel: "cash",
        channelLabel: "Dinheiro",
        expectedAmountCents: 0,
        grossCashCents: 0,
        changeCents: 0,
        supplyCents: 0,
        withdrawalCents: 0,
        cashMovements: [],
        paymentRowCount: 0,
        rawPaymentNames: new Set(),
      };
      accumulators.set(key, acc);
    }
    source.movementCount = (source.movementCount ?? 0) + 1;
    acc.cashMovements.push(movement);
    if (movement.kind === "supply") {
      acc.supplyCents += movement.amountCents;
      acc.expectedAmountCents += movement.amountCents;
    } else {
      acc.withdrawalCents += movement.amountCents;
      acc.expectedAmountCents -= movement.amountCents;
    }
    expectedByChannelCents.cash = sumCents(
      expectedByChannelCents.cash ?? 0,
      movement.kind === "supply" ? movement.amountCents : -movement.amountCents,
    );
    expectedTotalCents = sumCents(
      expectedTotalCents,
      movement.kind === "supply" ? movement.amountCents : -movement.amountCents,
    );
  }

  source.rawPaymentNames = Array.from(rawPaymentNames);
  source.unknownPaymentNames = Array.from(unknownPaymentNames);

  const lines: BuiltCashClosureLine[] = Array.from(accumulators.values())
    .sort(
      (a, b) =>
        a.operatorName.localeCompare(b.operatorName, "pt-BR") || a.channel.localeCompare(b.channel),
    )
    .map((acc) => {
      const automaticallyCounted = isPdvAutoCountedChannel(acc.channel);
      const interval = operatorIntervals.get(acc.operatorId);
      return {
        operatorId: acc.operatorId,
        operatorName: acc.operatorName,
        channel: acc.channel,
        channelLabel: acc.channelLabel,
        expectedAmountCents: acc.expectedAmountCents,
        calculatedExpectedAmountCents: acc.expectedAmountCents,
        reportedAmountCents: automaticallyCounted ? acc.expectedAmountCents : null,
        reportedDifferenceAmountCents: automaticallyCounted ? 0 : null,
        countedAmountCents: automaticallyCounted ? acc.expectedAmountCents : null,
        differenceAmountCents: automaticallyCounted ? 0 : null,
        status: automaticallyCounted ? "matched" as const : "pending" as const,
        rawPaymentNames: Array.from(acc.rawPaymentNames),
        metadata: {
          ...(acc.channel === "cash"
            ? {
                grossCashCents: acc.grossCashCents,
                changeCents: acc.changeCents,
                supplyCents: acc.supplyCents,
                withdrawalCents: acc.withdrawalCents,
                cashMovements: acc.cashMovements,
              }
            : {}),
          paymentRowCount: acc.paymentRowCount,
          ...(interval ?? {}),
        },
        note: null,
      };
    });

  const [year, month, day] = ctx.date.split("-").map(Number);
  const operatorCount = new Set(lines.map((line) => line.operatorId)).size;

  return {
    workspaceId: ctx.workspaceId,
    kioskId: ctx.kioskId,
    kioskName: ctx.kioskName,
    pdvFilialId: ctx.pdvFilialId,
    date: ctx.date,
    year,
    month,
    day,
    status: "draft",
    expectedTotalCents,
    expectedByChannelCents,
    operatorCount,
    lines,
    source,
  };
}
