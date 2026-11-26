import type { ContextArchiveSource } from "./context-archive-access";
type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const segment = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !/[/\\\u0000]/.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
export type ContextFileReference = { path: string; filename: string; hash?: string; bucket?: string; generation?: string; size?: number; mimeType: string };
/** These paths come from the existing producers. A source record cannot redirect a reader to another artifact. */
export function contextFileReference(source: ContextArchiveSource, id: string, record: Data, scope: { workspaceId: string; parentId?: string; fiscalBucket?: string }): ContextFileReference | null {
  if (!segment(id)) return null;
  if (source === "aso" || source === "accountant") {
    if (!segment(scope.parentId)) return null;
    const validKind = source === "aso" ? ["aso_admission_referral", "aso_dismissal_referral"].includes(String(record.kind)) : record.kind === "accountant_admission_form";
    const path = `hr/onboarding/${scope.parentId}/generated/${source === "aso" ? "aso-guides" : "accountant-forms"}/${id}.pdf`;
    const digest = hash(record.hashSha256);
    return validKind && record.storagePath === path && digest ? { path, hash: digest, filename: text(record.fileName) ?? "documento-admissao.pdf", mimeType: "application/pdf" } : null;
  }
  if (source === "paymentProof") {
    const path = `financial/payment-proofs/${id}/comprovante-pagamento.pdf`;
    return record.proofStoragePath === path ? { path, filename: "Comprovante-de-pagamento.pdf", mimeType: "application/pdf" } : null;
  }
  if (source === "uniforms") {
    const term = object(record.term);
    if (!segment(record.collaboratorUserId)) return null;
    const path = `hr/employee-documents/${record.collaboratorUserId}/documents/${id}/versions/01/original.pdf`;
    const digest = hash(term.contentHash);
    return term.storagePath === path && digest ? { path, hash: digest, filename: text(term.fileName) ?? "termo-uniforme.pdf", mimeType: "application/pdf" } : null;
  }
  if (source !== "afd" && source !== "aej" || record.status !== "exported") return null;
  const bundle = object(object(record.artifacts).bundle);
  if (record.workspaceId !== scope.workspaceId || !segment(record.establishmentId) || !scope.fiscalBucket) return null;
  const path = `time-recording/fiscal-exports/${scope.workspaceId}/${source}/${record.establishmentId}/${id}/pacote-fiscal-${source}.zip`;
  const digest = hash(bundle.sha256), generation = text(bundle.generation);
  if (bundle.storageBucket !== scope.fiscalBucket || bundle.storagePath !== path || !digest || !generation || !/^[1-9]\d*$/.test(generation) || !Number.isSafeInteger(Number(generation)) || !Number.isSafeInteger(bundle.size) || Number(bundle.size) < 0 || Number(bundle.size) > 100 * 1024 * 1024) return null;
  return { path, bucket: scope.fiscalBucket, generation, hash: digest, size: Number(bundle.size), filename: `pacote-fiscal-${source}-${id}.zip`, mimeType: "application/zip" };
}
