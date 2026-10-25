import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

// Espelho, nas Functions, do contrato de src/features/dp/absences/operational/occupancy-guard.server.ts.
// Os dois lados precisam calcular o mesmo id de relógio e aceitar o mesmo recibo de prontidão.
export const ABSENCE_OPERATIONAL_COVERAGE_HASH = "absence-occupancy-writers-v1";
const MAX_DAYS_PER_TRANSACTION = 150;
const MAX_WRITES_PER_TRANSACTION = 450;

export type OccupancyMode =
  | { kind: "legacy" }
  | { kind: "pending" }
  | { kind: "guarded"; epoch: string };

/** Escrita que remove ocupação de uma pessoa nos dias indicados; aplicada em lote (legado) ou transação (guard). */
export type OccupancyRemoval = {
  beneficiaryUid: string;
  days: string[];
  writes: Array<(writer: OccupancyWriter) => void>;
  /** Decremento do contador `shiftCount` da escala, lido e regravado na mesma transação do guard. */
  shiftCountDecrement?: { schedule: DocumentReference; amount: number };
};

export interface OccupancyWriter {
  set(ref: DocumentReference, data: Record<string, unknown>, options?: { merge: boolean }): unknown;
  update(ref: DocumentReference, data: Record<string, unknown>): unknown;
  delete(ref: DocumentReference): unknown;
  create(ref: DocumentReference, data: Record<string, unknown>): unknown;
}

export class OccupancyGuardChanged extends Error {
  constructor() { super("absence_occupancy_guard_changed"); }
}

export function occupancyClockId(workspaceId: string, beneficiaryUid: string, date: string) {
  return createHash("sha256").update(`${workspaceId}:${beneficiaryUid}:${date}`).digest("hex");
}

function readinessValid(raw: FirebaseFirestore.DocumentSnapshot, workspaceId: string) {
  return raw.exists && raw.get("workspaceId") === workspaceId && raw.get("state") === "ready"
    && raw.get("bootstrapComplete") === true && raw.get("coverageHash") === ABSENCE_OPERATIONAL_COVERAGE_HASH
    && raw.get("scopeKind") === "workspace_all"
    && typeof raw.get("scopeHash") === "string" && /^[0-9a-f]{64}$/.test(raw.get("scopeHash"))
    && typeof raw.get("epoch") === "string" && /^[0-9a-f-]{36}$/i.test(raw.get("epoch"));
}

/**
 * Sem recibo: legado (a menos que o guard tenha sido pedido por variável). `bootstrapping` ou recibo
 * inválido: pendente. `ready` válido: as remoções de ocupação passam a atualizar os relógios por pessoa/dia.
 */
export async function occupancyMode(db: Firestore, workspaceId: string,
  guardValue = process.env.DP_ABSENCE_OPERATIONAL_GUARD): Promise<OccupancyMode> {
  const receipt = await db.collection("dp_absenceOperationalReadiness").doc(workspaceId).get();
  if (!receipt.exists) return guardValue && guardValue !== "off" ? { kind: "pending" } : { kind: "legacy" };
  if (readinessValid(receipt, workspaceId)) return { kind: "guarded", epoch: receipt.get("epoch") as string };
  return { kind: "pending" };
}

function chunk(removals: OccupancyRemoval[]) {
  const groups: OccupancyRemoval[][] = [];
  let current: OccupancyRemoval[] = [];
  let days = new Set<string>();
  let writes = 0;
  for (const removal of removals) {
    const removalDays = removal.days.map((day) => `${removal.beneficiaryUid}:${day}`);
    if (removalDays.length > MAX_DAYS_PER_TRANSACTION
      || removalDays.length + removal.writes.length > MAX_WRITES_PER_TRANSACTION) {
      throw new Error("Remoção de ocupação grande demais para uma transação.");
    }
    const nextDays = new Set([...days, ...removalDays]);
    if (current.length && (nextDays.size > MAX_DAYS_PER_TRANSACTION
      || nextDays.size + writes + removal.writes.length > MAX_WRITES_PER_TRANSACTION)) {
      groups.push(current);
      current = [];
      days = new Set(removalDays);
      writes = removal.writes.length;
    } else {
      days = nextDays;
      writes += removal.writes.length;
    }
    current.push(removal);
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Cada transação revalida o recibo/época e incrementa o relógio de cada pessoa/dia tocada junto das remoções. */
export async function applyGuardedOccupancyRemovals(db: Firestore, workspaceId: string, epoch: string,
  removals: OccupancyRemoval[]) {
  const readinessRef = db.collection("dp_absenceOperationalReadiness").doc(workspaceId);
  for (const group of chunk(removals)) {
    await db.runTransaction(async (transaction: Transaction) => {
      const readiness = await transaction.get(readinessRef);
      if (!readinessValid(readiness, workspaceId) || readiness.get("epoch") !== epoch) throw new OccupancyGuardChanged();
      const keys = new Map<string, { beneficiaryUid: string; date: string }>();
      group.forEach((removal) => removal.days.forEach((date) => keys.set(occupancyClockId(workspaceId,
        removal.beneficiaryUid, date), { beneficiaryUid: removal.beneficiaryUid, date })));
      const clocks = await Promise.all([...keys].map(async ([id, day]) => ({ id, day,
        snapshot: await transaction.get(db.collection("dp_absenceOccupancyClocks").doc(id)) })));
      const decrements = new Map<string, { schedule: DocumentReference; amount: number }>();
      group.forEach(({ shiftCountDecrement: item }) => {
        if (!item) return;
        const current = decrements.get(item.schedule.path);
        decrements.set(item.schedule.path, { schedule: item.schedule, amount: (current?.amount ?? 0) + item.amount });
      });
      const schedules = await Promise.all([...decrements.values()].map(async (item) => ({ ...item,
        snapshot: await transaction.get(item.schedule) })));
      for (const { snapshot } of clocks) {
        if (snapshot.exists && snapshot.get("epoch") !== epoch) throw new OccupancyGuardChanged();
        const version = snapshot.exists ? snapshot.get("version") : 0;
        if (!Number.isSafeInteger(version) || version < 0) throw new OccupancyGuardChanged();
      }
      group.forEach((removal) => removal.writes.forEach((write) => write(transaction as unknown as OccupancyWriter)));
      schedules.forEach(({ schedule, amount, snapshot }) => {
        if (!snapshot.exists) return;
        const current = Number(snapshot.get("shiftCount") ?? 0);
        transaction.update(schedule, { shiftCount: Math.max(0, (Number.isFinite(current) ? current : 0) - amount) });
      });
      const updatedAt = new Date().toISOString();
      clocks.forEach(({ id, day, snapshot }) => transaction.set(db.collection("dp_absenceOccupancyClocks").doc(id), {
        workspaceId, beneficiaryUid: day.beneficiaryUid, date: day.date, epoch,
        version: (snapshot.exists ? snapshot.get("version") as number : 0) + 1, updatedAt,
      }));
    });
  }
}

export function addDays(date: string, amount: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

/** Dias ocupados por um turno: o dia do turno e, se atravessa a meia-noite, o seguinte. */
export function shiftDays(date: string, startTime: unknown, endTime: unknown) {
  const minute = (value: unknown) => typeof value === "string" && /^\d{2}:\d{2}$/.test(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  const start = minute(startTime);
  const end = minute(endTime);
  return start !== null && end !== null && end < start && end > 0 ? [date, addDays(date, 1)] : [date];
}

export function periodDays(startDate: string, endDate: string) {
  const days: string[] = [];
  for (let day = startDate; day <= endDate && days.length <= MAX_DAYS_PER_TRANSACTION; day = addDays(day, 1)) days.push(day);
  return days;
}
