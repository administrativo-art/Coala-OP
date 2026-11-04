/** Reject every explicit contradictory/invalid workspace before projection or fallback.
 * Missing/null are legacy absence only when the caller explicitly allows it. */
export function matchesPersonWorkspace(data: Record<string, unknown> | undefined | null, expected: string, allowLegacyMissing = false): boolean {
  const values = [data?.workspaceId, data?.workspace_id].filter((value) => value !== undefined && value !== null);
  return values.length ? values.every((value) => typeof value === "string" && value.length > 0 && value === expected) : allowLegacyMissing;
}
