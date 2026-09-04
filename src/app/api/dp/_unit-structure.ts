import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dpCoverageModeSchema } from "@/lib/dp-coverage-demands";
import { dpOperatingHoursSchema } from "@/lib/dp-operating-hours";

type JsonObject = Record<string, unknown>;

const RESPONSIBILITY_FIELDS = [
  "responsibleSourceType",
  "responsibleSourceId",
  "responsibleSourceName",
  "responsibleUserId",
  "responsibleUserName",
] as const;

const RESPONSIBILITY_VACANCY_FIELDS = [
  "responsibilityStatus",
  "responsibilityVacatedAt",
  "responsibilityVacatedByTerminationUserId",
] as const;

export function canManageOperationalUnits(context: ServerUserContext) {
  return !!(
    context.isDefaultAdmin ||
    context.permissions.settings?.manageUsers ||
    context.permissions.settings?.manageKiosks ||
    context.permissions.dp?.settings?.manageUnits
  );
}

export async function requireOperationalUnitManager(request: NextRequest) {
  const context = await requireUser(request);

  if (!canManageOperationalUnits(context)) {
    throw new Error("Sem permissão para gerenciar unidades operacionais.");
  }

  return context;
}

export function jsonError(error: unknown, fallback: string, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status }
  );
}

export async function readJsonObject(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Payload inválido.");
  }
  return body as JsonObject;
}

export function hasOwn(body: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function requiredString(body: JsonObject, key: string, label: string) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} é obrigatório.`);
  }
  return value.trim();
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function optionalOperatingHours(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const parsed = dpOperatingHoursSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Horário de funcionamento inválido. Confira os dias e os horários de abertura e encerramento.");
  }
  return parsed.data;
}

export function optionalCoverageMode(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = dpCoverageModeSchema.safeParse(value);
  if (!parsed.success) throw new Error("Modo de cobertura inválido.");
  return parsed.data;
}

export function cleanDocument<T extends JsonObject>(payload: T) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as T;
}

export function setOptionalStringPatch(update: JsonObject, body: JsonObject, key: string) {
  if (!hasOwn(body, key)) return;
  const value = optionalString(body[key]);
  update[key] = value ?? FieldValue.delete();
}

export function setOptionalNumberPatch(update: JsonObject, body: JsonObject, key: string) {
  if (!hasOwn(body, key)) return;
  const value = optionalNumber(body[key]);
  update[key] = value ?? FieldValue.delete();
}

export function setOptionalBooleanPatch(update: JsonObject, body: JsonObject, key: string) {
  if (!hasOwn(body, key)) return;
  const value = optionalBoolean(body[key]);
  update[key] = value ?? FieldValue.delete();
}

export function normalizeResponsibleSourceType(value: unknown) {
  return value === "job_role" || value === "job_function" ? value : undefined;
}

export function buildResponsibilityCreatePayload(body: JsonObject) {
  const sourceType = normalizeResponsibleSourceType(body.responsibleSourceType);
  const sourceId = optionalString(body.responsibleSourceId);

  if (!sourceType || !sourceId) return {};

  return cleanDocument({
    responsibleSourceType: sourceType,
    responsibleSourceId: sourceId,
    responsibleSourceName: optionalString(body.responsibleSourceName),
    responsibleUserId: optionalString(body.responsibleUserId),
    responsibleUserName: optionalString(body.responsibleUserName),
  });
}

export function applyResponsibilityPatch(update: JsonObject, body: JsonObject) {
  if (!RESPONSIBILITY_FIELDS.some((field) => hasOwn(body, field))) return;

  const sourceType = normalizeResponsibleSourceType(body.responsibleSourceType);
  const sourceId = optionalString(body.responsibleSourceId);

  if (!sourceType || !sourceId) {
    [...RESPONSIBILITY_FIELDS, ...RESPONSIBILITY_VACANCY_FIELDS].forEach((field) => {
      update[field] = FieldValue.delete();
    });
    return;
  }

  update.responsibleSourceType = sourceType;
  update.responsibleSourceId = sourceId;
  update.responsibleSourceName = optionalString(body.responsibleSourceName) ?? FieldValue.delete();
  update.responsibleUserId = optionalString(body.responsibleUserId) ?? FieldValue.delete();
  update.responsibleUserName = optionalString(body.responsibleUserName) ?? FieldValue.delete();
  RESPONSIBILITY_VACANCY_FIELDS.forEach((field) => {
    update[field] = FieldValue.delete();
  });
}
