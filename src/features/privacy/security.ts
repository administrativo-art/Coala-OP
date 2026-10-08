import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const civilDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Data inválida.");

export const privacyRequestCreateSchema = z.object({
  subjectName: z.string().trim().min(1).max(160),
  subjectEmail: optionalText(180),
  subjectType: z.enum(["candidate", "employee", "former_employee", "internal_user", "supplier", "other"]),
  requestType: z.enum(["access", "correction", "deletion", "information", "consent_revocation", "opposition", "other"]),
  origin: z.enum(["email", "whatsapp", "in_person", "phone", "system", "other"]),
  description: z.string().trim().min(1).max(3000),
  owner: optionalText(120),
  dueAt: z.union([civilDate, z.literal("")]).optional(),
}).strict();

export const privacyRequestUpdateSchema = z.object({
  status: z.enum(["open", "in_review", "completed", "rejected"]),
  owner: optionalText(120),
  response: optionalText(3000),
}).strict();

export const securityIncidentCreateSchema = z.object({
  title: z.string().trim().min(1).max(180),
  incidentType: z.enum(["unauthorized_access", "wrong_recipient", "account_compromise", "public_exposure", "data_loss", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  occurredAt: z.union([civilDate, z.literal("")]).optional(),
  affectedData: z.string().trim().min(1).max(1500),
  affectedSubjects: optionalText(1000),
  estimatedSubjectsCount: z.preprocess((value) => value === "" || value === null ? undefined : value, z.coerce.number().int().nonnegative().max(100000000).optional()),
  containmentActions: z.string().trim().min(1).max(3000),
  owner: optionalText(120),
}).strict();

export const securityIncidentUpdateSchema = z.object({
  status: z.enum(["open", "contained", "resolved", "dismissed"]),
  owner: optionalText(120),
  resolutionNotes: optionalText(3000),
}).strict();

export const clientAuditEventSchema = z.object({
  module: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  action: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  targetType: optionalText(120),
  targetId: optionalText(180),
  targetName: optionalText(240),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type PrivacyRequestCreateInput = z.infer<typeof privacyRequestCreateSchema>;
export type PrivacyRequestUpdateInput = z.infer<typeof privacyRequestUpdateSchema>;
export type SecurityIncidentCreateInput = z.infer<typeof securityIncidentCreateSchema>;
export type SecurityIncidentUpdateInput = z.infer<typeof securityIncidentUpdateSchema>;
export type ClientAuditEventInput = z.infer<typeof clientAuditEventSchema>;
