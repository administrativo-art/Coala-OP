/** Missing publication metadata is the legacy, already published schedule. */
export function schedulePublicationStatus(value: { publicationStatus?: unknown }): 'draft' | 'published' {
  return value.publicationStatus === 'draft' ? 'draft' : 'published';
}

export function hasPublishedScheduleVersion(value: { publicationVersion?: unknown; publicationStatus?: unknown }) {
  return value.publicationStatus !== 'draft' || Number(value.publicationVersion) > 0;
}

/** Only work/assignment fields participate in conflict detection. Server timestamps do not. */
export function scheduleShiftFingerprint(value: Record<string, unknown> | null): string {
  if (!value) return 'missing';
  return JSON.stringify([
    value.scheduleId ?? null, value.unitId ?? null, value.userId ?? null,
    value.date ?? null, value.startTime ?? null, value.endTime ?? null,
    value.type ?? null, value.shiftDefinitionId ?? null, value.overnight === true,
    value.assignmentKind ?? null, value.originUnitId ?? null,
    value.exceptionReason ?? null,
    ...(value.manualDay ? [value.manualDay, value.manualBreak ?? null] : []), value.dayOffSource ?? null,
  ]);
}

// Older publishers see this prefix as a conflict and leave the official revision intact.
const MANUAL_DRAFT_FINGERPRINT_PREFIX = 'manual-day-draft-v1:';

export function scheduleDraftBaseFingerprint(base: string, manualDay: boolean): string {
  const original = base.startsWith(MANUAL_DRAFT_FINGERPRINT_PREFIX)
    ? base.slice(MANUAL_DRAFT_FINGERPRINT_PREFIX.length) : base;
  return manualDay ? MANUAL_DRAFT_FINGERPRINT_PREFIX + original : original;
}

export type DPScheduleDraftEdit<T extends Record<string, unknown>> = {
  baseFingerprint: string;
  value: T | null;
};

export function mergeScheduleDraft<T extends Record<string, unknown>>(
  published: ReadonlyMap<string, T>,
  edits: ReadonlyMap<string, DPScheduleDraftEdit<T>>,
) {
  const merged = new Map(published);
  const conflicts: string[] = [];
  for (const [id, edit] of edits) {
    if (scheduleShiftFingerprint(published.get(id) ?? null) !== scheduleDraftBaseFingerprint(edit.baseFingerprint, false)) {
      conflicts.push(id);
      continue;
    }
    if (edit.value) merged.set(id, edit.value);
    else merged.delete(id);
  }
  return { merged, conflicts };
}
