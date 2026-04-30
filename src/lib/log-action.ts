import { Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { WORKSPACE_ID } from "@/lib/workspace";

const DEFAULT_TTL_DAYS = 90;

export type LogActionParams = {
  workspace_id?: string | null;
  user_id?: string | null;
  username?: string | null;
  module: string;
  action: string;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  timestamp?: Date | string | null;
  ttl?: Date | string | null;
  ttl_days?: number;
};

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function logAction(params: LogActionParams) {
  const occurredAt = normalizeDate(params.timestamp) ?? new Date();
  const ttlDate =
    normalizeDate(params.ttl) ??
    new Date(occurredAt.getTime() + (params.ttl_days ?? DEFAULT_TTL_DAYS) * 86400000);

  return dbAdmin.collection("actionLogs").add({
    workspace_id: params.workspace_id ?? WORKSPACE_ID,
    user_id: params.user_id ?? null,
    username: params.username ?? null,
    module: params.module,
    action: params.action,
    metadata: params.metadata ?? {},
    ip_address: params.ip_address ?? null,
    timestamp: Timestamp.fromDate(occurredAt),
    ttl: Timestamp.fromDate(ttlDate),
  });
}
