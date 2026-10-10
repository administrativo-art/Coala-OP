import "server-only";

import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  fetchPdvLegalPaymentMethods,
  fetchPdvLegalUsers,
  fetchPdvLegalWithdrawals,
  getAccessToken,
} from "@/lib/integrations/pdv-legal-admin";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit } from "@/lib/unit-access";
import { compareClosureTimestamps, formatClosureTime, todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import { parsePdvCashMovements } from "@/features/financial/cash-closures/pdv-cash-movements";
import { eligibleMovement, withdrawalSourceId } from "@/features/financial/cash-closures/withdrawal-classification";
import { LOCAL_PURCHASE_WITHDRAWAL_LINKS } from "@/features/financial/cash-closures/withdrawal-classification.server";
import { FINANCIAL_COLLECTIONS } from "@/features/financial/lib/constants";
import { localPurchaseWithdrawalDates, type AwaitingLocalPurchase, type OpenLocalPurchaseWithdrawal } from "./local-purchase-withdrawals";

// The app polls this list; the cache keeps the PDV fan-out independent of how many phones are open.
const TODAY_TTL_MS = 60_000;
const PAST_DAY_TTL_MS = 10 * 60_000;
const CATALOG_TTL_MS = 10 * 60_000;
const PDV_CONCURRENCY = 4;

type Cached<T> = { expiresAt: number; value: Promise<T> };
const dayCache = new Map<string, Cached<unknown>>();
let paymentMethodsCache: Cached<unknown> | null = null;
let operatorNamesCache: Cached<Record<string, string>> | null = null;

function cached<T>(current: Cached<T> | null | undefined, ttlMs: number, load: () => Promise<T>, store: (entry: Cached<T> | null) => void) {
  if (current && current.expiresAt > Date.now()) return current.value;
  const entry: Cached<T> = { expiresAt: Date.now() + ttlMs, value: load() };
  // A failed PDV read must not be served again from the cache.
  entry.value.catch(() => store(null));
  store(entry);
  return entry.value;
}

function withdrawalsOfDay(token: string, date: string, today: string) {
  return cached(dayCache.get(date), date === today ? TODAY_TTL_MS : PAST_DAY_TTL_MS,
    () => fetchPdvLegalWithdrawals(token, date),
    (entry) => { if (entry) dayCache.set(date, entry); else dayCache.delete(date); });
}

function paymentMethods(token: string) {
  return cached(paymentMethodsCache, CATALOG_TTL_MS, () => fetchPdvLegalPaymentMethods(token), (entry) => { paymentMethodsCache = entry; });
}

function operatorNames() {
  return cached(operatorNamesCache, CATALOG_TTL_MS,
    async () => Object.fromEntries((await fetchPdvLegalUsers()).map((user) => [user.id, user.name])),
    (entry) => { operatorNamesCache = entry; });
}

function withdrawalCutoff() {
  return process.env.LOCAL_PURCHASE_WITHDRAWAL_CUTOFF_DATE?.trim() || null;
}

type Unit = { id: string; name: string; pdvFilialId: string };
let unitsCache: Cached<Unit[]> | null = null;

/** Units with a PDV filial. Cached because the app polls the list; access is still checked per request. */
function pdvUnits() {
  return cached(unitsCache, CATALOG_TTL_MS,
    async () => (await dbAdmin.collection("kiosks").limit(201).get()).docs.flatMap((document) => unitFromSnapshot(document) ?? []),
    (entry) => { unitsCache = entry; });
}

function unitFromSnapshot(snapshot: FirebaseFirestore.DocumentSnapshot): Unit | null {
  const stored = snapshot.get("pdvFilialId");
  const pdvFilialId = resolvePdvFilialId({ id: snapshot.id, pdvFilialId: typeof stored === "string" ? stored : null });
  if (!pdvFilialId) return null;
  return { id: snapshot.id, name: String(snapshot.get("name") || snapshot.get("displayName") || snapshot.id), pdvFilialId };
}

function unitWithdrawals(input: { workspaceId: string; unit: Unit; date: string; raw: unknown; methods: unknown }) {
  return parsePdvCashMovements({ withdrawals: input.raw, supplies: [], paymentMethods: input.methods, date: input.date, filialId: input.unit.pdvFilialId })
    // Only a PDV-issued identifier is an idempotency key for money; synthetic ones never reach the app.
    .filter((movement) => eligibleMovement(movement) && movement.identitySource === "provider")
    .map((movement) => ({
      movement,
      sourceId: withdrawalSourceId({ workspaceId: input.workspaceId, unitId: input.unit.id, pdvFilialId: input.unit.pdvFilialId }, movement.id),
    }));
}

async function takenSourceIds(sourceIds: string[]) {
  if (!sourceIds.length) return new Set<string>();
  const snapshots = await financialDbAdmin.getAll(
    ...sourceIds.map((id) => financialDbAdmin.collection(FINANCIAL_COLLECTIONS.sourceSettlements).doc(id)),
    ...sourceIds.map((id) => financialDbAdmin.collection(LOCAL_PURCHASE_WITHDRAWAL_LINKS).doc(id)),
  );
  return new Set(snapshots
    .filter((snapshot) => snapshot.exists && (snapshot.ref.parent.id === LOCAL_PURCHASE_WITHDRAWAL_LINKS || snapshot.get("active") === true))
    .map((snapshot) => snapshot.id));
}

const AWAITING_LIMIT = 50;

/** Bounded read on a single-field index; scope and "no sangria yet" are narrowed in memory. */
async function awaitingPurchases(actor: ServerUserContext): Promise<AwaitingLocalPurchase[]> {
  const snapshot = await financialDbAdmin.collection("localPurchases").where("status", "==", "awaiting_cash_withdrawal").limit(AWAITING_LIMIT).get();
  return snapshot.docs
    .filter((document) => document.get("workspaceId") === actor.workspace_id && !document.get("withdrawalPreLink")
      && canAccessUnit(actor.userDoc, String(document.get("unitId")), { isDefaultAdmin: actor.isDefaultAdmin }))
    .map((document) => ({
      id: document.id, unitId: String(document.get("unitId")), supplierName: String(document.get("supplierName") ?? ""),
      purchaseDate: String(document.get("purchaseDate") ?? ""), totalCents: Number(document.get("totalCents") ?? 0),
    }));
}

/** Sangrias do PDV, desde a data de corte, que ainda não têm nota nem classificação. */
export async function listOpenLocalPurchaseWithdrawals(actor: ServerUserContext) {
  const today = todayInClosureTimezone();
  const dates = localPurchaseWithdrawalDates(today, withdrawalCutoff());
  const window = { from: dates.at(-1) ?? today, to: today };
  const units = (await pdvUnits()).filter((unit) => canAccessUnit(actor.userDoc, unit.id, { isDefaultAdmin: actor.isDefaultAdmin }));
  if (!units.length || !dates.length) return { withdrawals: [] as OpenLocalPurchaseWithdrawal[], awaitingPurchases: [] as AwaitingLocalPurchase[], window, partial: false };

  const token = await getAccessToken();
  const [methods, names] = await Promise.all([paymentMethods(token), operatorNames().catch(() => ({} as Record<string, string>))]);
  const days: Array<{ date: string; raw: unknown }> = [];
  let partial = false;
  for (let index = 0; index < dates.length; index += PDV_CONCURRENCY) {
    const batch = dates.slice(index, index + PDV_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((date) => withdrawalsOfDay(token, date, today)));
    results.forEach((result, offset) => {
      if (result.status === "fulfilled") days.push({ date: batch[offset]!, raw: result.value });
      else partial = true;
    });
  }

  const found = days.flatMap(({ date, raw }) => units.flatMap((unit) =>
    unitWithdrawals({ workspaceId: actor.workspace_id, unit, date, raw, methods }).map((row) => ({ ...row, unit, date }))));
  // A movement the PDV does not tie to one filial would show up under every unit: never guess its owner.
  const owners = new Map<string, number>();
  for (const row of found) owners.set(`${row.date}:${row.movement.id}`, (owners.get(`${row.date}:${row.movement.id}`) ?? 0) + 1);
  const unambiguous = found.filter((row) => owners.get(`${row.date}:${row.movement.id}`) === 1);
  const taken = await takenSourceIds(unambiguous.map((row) => row.sourceId));
  const withdrawals = unambiguous
    .filter((row) => !taken.has(row.sourceId))
    .sort((left, right) => compareClosureTimestamps(right.movement.occurredAt, left.movement.occurredAt))
    .map((row): OpenLocalPurchaseWithdrawal => ({
      sourceId: row.sourceId,
      unitId: row.unit.id,
      unitName: row.unit.name,
      date: row.date,
      time: formatClosureTime(row.movement.occurredAt),
      amountCents: row.movement.amountCents,
      operatorName: row.movement.operatorId ? names[row.movement.operatorId] ?? null : null,
    }));
  // Only worth reading when there is a sangria to reconcile them with.
  return { withdrawals, awaitingPurchases: withdrawals.length ? await awaitingPurchases(actor) : [], window, partial };
}

/** Revalida no PDV a sangria escolhida no app; nada do que o aparelho envia sobre ela é confiado. */
export async function resolveLocalPurchaseWithdrawal(input: { workspaceId: string; unitId: string; sourceId: string; date: string }) {
  const failure = (code: string, safeMessage: string): never => {
    throw new AppError({ code: `LOCAL_PURCHASE_${code}`, kind: "CONFLICT", safeMessage });
  };
  const today = todayInClosureTimezone();
  if (!localPurchaseWithdrawalDates(today, withdrawalCutoff()).includes(input.date)) {
    failure("WITHDRAWAL_OUT_OF_WINDOW", "Esta sangria está fora do período aceito pelo aplicativo.");
  }
  const snapshot = await dbAdmin.collection("kiosks").doc(input.unitId).get();
  const unit = snapshot.exists ? unitFromSnapshot(snapshot) : null;
  if (!unit) return failure("WITHDRAWAL_UNIT_INVALID", "A unidade não possui filial do PDV configurada.");
  const token = await getAccessToken();
  const [methods, raw] = await Promise.all([paymentMethods(token), fetchPdvLegalWithdrawals(token, input.date)]);
  const match = unitWithdrawals({ workspaceId: input.workspaceId, unit, date: input.date, raw, methods })
    .find((row) => row.sourceId === input.sourceId);
  if (!match) return failure("WITHDRAWAL_NOT_FOUND", "A sangria escolhida não foi encontrada no PDV. Atualize a lista e tente novamente.");
  return {
    sourceId: match.sourceId,
    movementId: match.movement.id,
    date: input.date,
    occurredAt: match.movement.occurredAt,
    amountCents: match.movement.amountCents,
    operatorId: match.movement.operatorId,
  };
}
