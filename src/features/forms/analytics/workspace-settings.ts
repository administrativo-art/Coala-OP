import type { Firestore } from "firebase-admin/firestore";

import type { FormTaskTrigger } from "@/types/forms";

import { DEFAULT_FORMS_ANALYTICS_TIMEZONE } from "./execution-adapter";

export const ANALYTICS_SETTINGS_COLLECTION = "form_analytics_settings";

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface FormAnalyticsWorkspaceSettings {
  timezone: string;
  default_task_trigger?: FormTaskTrigger;
}

const cache = new Map<
  string,
  { value: FormAnalyticsWorkspaceSettings; expires_at: number }
>();

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseDefaultTaskTrigger(value: unknown): FormTaskTrigger | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (
    typeof data.id !== "string" ||
    typeof data.task_project_id !== "string" ||
    typeof data.assignee_id !== "string"
  ) {
    return undefined;
  }
  return data as unknown as FormTaskTrigger;
}

export async function getWorkspaceAnalyticsSettings(
  db: Firestore,
  workspaceId: string
): Promise<FormAnalyticsWorkspaceSettings> {
  const cached = cache.get(workspaceId);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  let timezone = DEFAULT_FORMS_ANALYTICS_TIMEZONE;
  let defaultTaskTrigger: FormTaskTrigger | undefined;

  const snap = await db
    .collection(ANALYTICS_SETTINGS_COLLECTION)
    .doc(workspaceId)
    .get();

  if (snap.exists) {
    const configured = snap.get("timezone");
    if (typeof configured === "string" && isValidTimezone(configured)) {
      timezone = configured;
    }
    defaultTaskTrigger = parseDefaultTaskTrigger(snap.get("default_task_trigger"));
  }

  const value: FormAnalyticsWorkspaceSettings = {
    timezone,
    ...(defaultTaskTrigger ? { default_task_trigger: defaultTaskTrigger } : {}),
  };
  cache.set(workspaceId, { value, expires_at: Date.now() + CACHE_TTL_MS });
  return value;
}

export function invalidateWorkspaceAnalyticsSettingsCache(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}
