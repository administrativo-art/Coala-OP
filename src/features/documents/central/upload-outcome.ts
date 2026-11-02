/** Only a persisted filing decision turns a destination proposal into an applied name. */
export function uploadOutcome(record: Record<string, unknown>) {
  const destination = record.destination && typeof record.destination === "object" && !Array.isArray(record.destination)
    ? record.destination as Record<string, unknown> : {};
  const name = typeof destination.downloadName === "string" ? destination.downloadName : null;
  const filed = record.status === "filed" && typeof record.filedDocumentId === "string" && Boolean(record.filedDocumentId);
  return {
    appliedName: filed ? name : null,
    destination: filed && Array.isArray(destination.pathSegments) ? destination.pathSegments.map(String).join(" / ") : null,
    proposal: filed ? null : name,
  };
}
