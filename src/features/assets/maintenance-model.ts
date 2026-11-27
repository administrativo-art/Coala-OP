import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().trim().min(1).max(160);
export const maintenanceAssigneeSchema = z.object({ type: z.enum(["user", "unit", "third_party"]), id: id.optional(), nameSnapshot: z.string().trim().min(1).max(200) }).strict();
export const maintenancePlanInputSchema = z.object({
  idempotencyKey: id, name: z.string().trim().min(1).max(200), active: z.boolean().default(true),
  cadence: z.object({ unit: z.enum(["days", "months", "calendar"]), interval: z.number().int().min(1).max(120), month: z.number().int().min(1).max(12).optional(), day: z.number().int().min(1).max(31).optional() }).strict(),
  nextDueDate: z.string().date(), leadDays: z.number().int().min(0).max(365).default(7), assignee: maintenanceAssigneeSchema,
  checklistSnapshot: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  supplierSnapshot: z.object({ id: id.optional(), name: z.string().trim().min(1).max(240), contact: z.string().trim().max(240).optional() }).strict().optional(),
}).strict().superRefine((value, ctx) => { if (value.cadence.unit === "calendar" && (!value.cadence.month || !value.cadence.day)) ctx.addIssue({ code: "custom", path: ["cadence"], message: "Mês e dia são obrigatórios para calendário." }); });
export const assetAuditInputSchema = z.object({
  idempotencyKey: id,
  auditedAt: z.string().datetime({ offset: true }), condition: z.enum(["new", "good", "regular", "poor", "critical"]),
  operationalStatus: z.enum(["operational", "restricted", "stopped"]), description: z.string().trim().min(1).max(4000),
  photos: z.array(z.object({ storagePath: z.string().trim().min(1).max(500), contentHash: z.string().regex(/^[a-f0-9]{64}$/i), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().positive().max(15 * 1024 * 1024) }).strict()).min(1).max(10),
  correctiveMaintenance: z.object({ required: z.boolean(), priority: z.enum(["low", "normal", "high", "urgent"]).default("high"), assignee: maintenanceAssigneeSchema.optional(), description: z.string().trim().max(3000).optional(), components: z.array(z.string().trim().min(1).max(200)).max(30).default([]) }).strict().optional(),
}).strict();
const maintenanceComponentsSchema = z.array(z.string().trim().min(1).max(200)).max(30).default([]);
const belemDateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Belem" });
export const maintenanceCivilDate = (now = new Date()) => belemDateFormat.format(now);
const performedOnSchema = z.string().date().refine(
  (date) => date <= maintenanceCivilDate(),
  "A data da realização não pode estar no futuro.",
);

const manualMaintenanceFields = z.object({
  idempotencyKey: id,
  assignee: maintenanceAssigneeSchema,
  description: z.string().trim().min(1).max(3000),
  components: maintenanceComponentsSchema,
});
const scheduledMaintenanceInputSchema = manualMaintenanceFields.extend({
  mode: z.literal("scheduled").default("scheduled"),
  dueDate: z.string().date(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  checklistSnapshot: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  supplierSnapshot: z.object({ id: id.optional(), name: z.string().trim().min(1).max(240) }).strict().optional(),
}).strict();
const completedMaintenanceInputSchema = manualMaintenanceFields.extend({
  mode: z.literal("completed"),
  performedOn: performedOnSchema,
}).strict();

export const manualMaintenanceInputSchema = z.union([
  completedMaintenanceInputSchema,
  scheduledMaintenanceInputSchema,
]);

const completionFields = z.object({
  expectedVersion: z.number().int().positive(),
  result: z.string().trim().min(1).max(4000),
  components: maintenanceComponentsSchema,
});
export const completeOccurrenceInputSchema = z.union([
  completionFields.extend({ performedOn: performedOnSchema }).strict(),
  completionFields.extend({ completedAt: z.string().datetime({ offset: true }) }).strict(),
]);

export function manualMaintenanceFingerprint(input: z.output<typeof manualMaintenanceInputSchema>) {
  const { assignee, description, components } = input;
  const responsible = assignee.type === "third_party"
    ? [assignee.type, assignee.nameSnapshot]
    : [assignee.type, assignee.id];
  const action = input.mode === "completed"
    ? ["completed", input.performedOn]
    : ["scheduled", input.dueDate, input.priority, input.checklistSnapshot,
        input.supplierSnapshot ? [input.supplierSnapshot.id ?? null, input.supplierSnapshot.name] : null];
  return createHash("sha256").update(JSON.stringify([action, responsible, description, components])).digest("hex");
}

export function maintenanceCompletionDates(input: z.output<typeof completeOccurrenceInputSchema>, now: string) {
  return "performedOn" in input
    ? { completedAt: now, performedOn: input.performedOn, serviceDate: input.performedOn }
    : { completedAt: input.completedAt, serviceDate: input.completedAt.slice(0, 10) };
}

export const canCompleteMaintenance = (status: unknown) => status === "open" || status === "scheduled";

export const occurrenceId = (source: string, key: string) => `amo_${createHash("sha256").update(`${source}:${key}`).digest("hex").slice(0, 32)}`;
export const taskIdForOccurrence = (id: string) => `asset_maintenance_${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
export function maintenanceMaterializeOn(nextDueDate: string, leadDays: number) {
  const date = new Date(`${nextDueDate.slice(0, 10)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - leadDays);
  return date.toISOString().slice(0, 10);
}
export function maintenanceMaterializedPatch(dueDate: string, at: string) {
  return { materializeOn: null, materializedDueDate: dueDate, materializedAt: at, updatedAt: at } as const;
}
export function nextProvisionAttemptAt(at: string, attempts: number) {
  const boundedAttempts = Math.max(1, Math.min(10, Math.trunc(attempts)));
  const delayMinutes = Math.min(24 * 60, 5 * (2 ** (boundedAttempts - 1)));
  return new Date(new Date(at).getTime() + delayMinutes * 60_000).toISOString();
}
export function nextMaintenanceDate(cadence: { unit: "days" | "months" | "calendar"; interval: number; month?: number; day?: number }, from: string) {
  const base = new Date(`${from.slice(0, 10)}T12:00:00.000Z`);
  if (cadence.unit === "days") base.setUTCDate(base.getUTCDate() + cadence.interval);
  else if (cadence.unit === "months") { const day = base.getUTCDate(); base.setUTCDate(1); base.setUTCMonth(base.getUTCMonth() + cadence.interval); base.setUTCDate(Math.min(day, new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate())); }
  else { base.setUTCFullYear(base.getUTCFullYear() + cadence.interval, (cadence.month ?? 1) - 1, 1); base.setUTCDate(Math.min(cadence.day ?? 1, new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate())); }
  return base.toISOString().slice(0, 10);
}
