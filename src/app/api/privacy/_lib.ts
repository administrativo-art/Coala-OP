import { Timestamp } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { AppError } from "@/lib/observability/app-error";

export function canViewPrivacy(context: ServerUserContext) {
  return Boolean(
    context.isDefaultAdmin ||
      context.permissions.settings.view ||
      context.permissions.settings.manageUsers ||
      context.permissions.settings.manageProfiles ||
      context.permissions.dp?.collaborators?.edit ||
      context.permissions.dp?.collaborators?.terminate
  );
}

export function canManagePrivacy(context: ServerUserContext) {
  return Boolean(
    context.isDefaultAdmin ||
      context.permissions.settings.manageUsers ||
      context.permissions.settings.manageProfiles ||
      context.permissions.dp?.collaborators?.edit ||
      context.permissions.dp?.collaborators?.terminate
  );
}

export async function authenticatePrivacyUser(request: NextRequest) {
  return requireUser(request).catch((cause) => {
    throw new AppError({ code: "PRIVACY_AUTH_REQUIRED", kind: "AUTHENTICATION", cause });
  });
}

export function requirePrivacyView(context: ServerUserContext) {
  if (!canViewPrivacy(context)) throw new AppError({ code: "PRIVACY_VIEW_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para visualizar dados de privacidade." });
}

export function requirePrivacyManage(context: ServerUserContext) {
  if (!canManagePrivacy(context)) throw new AppError({ code: "PRIVACY_MANAGE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para alterar dados de privacidade." });
}

export function ttlFrom(date: Date, days: number) {
  return Timestamp.fromDate(new Date(date.getTime() + days * 86400000));
}

export function serializeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "object" && "toDate" in (value as Record<string, unknown>)) {
    const date = (value as { toDate?: () => Date }).toDate?.();
    return date ? date.toISOString() : null;
  }
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function cleanText(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
