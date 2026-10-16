import type {
  CashClosureCashMovement,
  CashClosureLine,
  CashClosureOperatorStatus,
  CashSupplyClassification,
} from "./types";

type CashSupplyLine = Pick<CashClosureLine, "date" | "metadata">;
type CashFinanceLine = CashSupplyLine & Pick<CashClosureLine, "expectedCents" | "reportedCents">;

export const CASH_SUPPLY_CLASSIFICATION_EFFECTIVE_DATE = "2026-08-01";

export function requiresCashSupplyClassification(date: string) {
  return date >= CASH_SUPPLY_CLASSIFICATION_EFFECTIVE_DATE;
}

export function cashSupplyMovementFingerprint(movement: CashClosureCashMovement) {
  return JSON.stringify([
    movement.id,
    movement.kind,
    movement.amountCents,
    movement.occurredAt,
    movement.date,
    movement.operatorId,
    movement.terminalId,
  ]);
}

export function cashSupplyMovements(line: CashSupplyLine) {
  return (line.metadata.cashMovements ?? []).filter((movement) =>
    movement.kind === "supply" && !movement.cancelled,
  );
}

export function cashSupplyClassificationForMovement(
  line: CashSupplyLine,
  movement: CashClosureCashMovement,
) {
  const fingerprint = cashSupplyMovementFingerprint(movement);
  return (line.metadata.supplyClassifications ?? []).find((classification) =>
    classification.movementId === movement.id
      && classification.movementFingerprint === fingerprint,
  ) ?? null;
}

export function validCashSupplyClassifications(line: CashSupplyLine) {
  const byId = new Map(cashSupplyMovements(line).map((movement) => [movement.id, movement]));
  return (line.metadata.supplyClassifications ?? []).filter((classification) => {
    const movement = byId.get(classification.movementId);
    return movement
      ? classification.movementFingerprint === cashSupplyMovementFingerprint(movement)
      : false;
  });
}

export function cashFundCentsForLine(line: CashSupplyLine) {
  if (!requiresCashSupplyClassification(line.date)) return 0;
  const classifications = new Map(
    validCashSupplyClassifications(line).map((classification) => [classification.movementId, classification]),
  );
  return cashSupplyMovements(line).reduce((total, movement) =>
    total + (classifications.get(movement.id)?.kind === "cash_fund" ? movement.amountCents : 0), 0);
}

export function financeExpectedCentsForLine(line: CashFinanceLine) {
  return Math.max(0, line.expectedCents - cashFundCentsForLine(line));
}

export function financeReportedCentsForLine(line: CashFinanceLine) {
  if (line.reportedCents === null) return null;
  return Math.max(0, line.reportedCents - cashFundCentsForLine(line));
}

export function cashSupplyClassificationSummary(
  lines: CashClosureLine[],
  options: { operatorStatus?: CashClosureOperatorStatus } = {},
) {
  const supplies = lines.flatMap((line) => cashSupplyMovements(line).map((movement) => ({ line, movement })));
  const effective = lines.some((line) => requiresCashSupplyClassification(line.date));
  const required = effective && options.operatorStatus !== "approved";
  if (!effective) {
    return { required: false, total: supplies.length, pending: 0, cashFundCents: 0, supplyCents: 0 };
  }
  let pending = 0;
  let cashFundCents = 0;
  let supplyCents = 0;
  for (const { line, movement } of supplies) {
    const classification = cashSupplyClassificationForMovement(line, movement);
    if (!classification) {
      if (required) pending++;
    }
    else if (classification.kind === "cash_fund") cashFundCents += movement.amountCents;
    else supplyCents += movement.amountCents;
  }
  return { required, total: supplies.length, pending, cashFundCents, supplyCents };
}

export function preserveCashSupplyClassifications(
  existing: CashSupplyClassification[] | undefined,
  movements: CashClosureCashMovement[] | undefined,
) {
  if (!existing?.length || !movements?.length) return [];
  const fingerprints = new Map(
    movements
      .filter((movement) => movement.kind === "supply" && !movement.cancelled)
      .map((movement) => [movement.id, cashSupplyMovementFingerprint(movement)]),
  );
  return existing.filter((classification) =>
    fingerprints.get(classification.movementId) === classification.movementFingerprint,
  );
}
