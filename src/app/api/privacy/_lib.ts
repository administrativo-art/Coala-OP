import { Timestamp } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";

import { requireUser, type ServerUserContext } from "@/lib/auth-server";

export function canUsePrivacy(context: ServerUserContext) {
  return Boolean(
    context.isDefaultAdmin ||
      context.permissions.settings.view ||
      context.permissions.settings.manageUsers ||
      context.permissions.settings.manageProfiles ||
      context.permissions.dp?.collaborators?.edit ||
      context.permissions.dp?.collaborators?.terminate
  );
}

export async function requirePrivacyUser(request: NextRequest) {
  const context = await requireUser(request);
  if (!canUsePrivacy(context)) {
    throw new Error("Sem permissao para acessar privacidade.");
  }
  return context;
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

