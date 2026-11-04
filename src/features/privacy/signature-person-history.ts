import { createHash } from "node:crypto";
import { readSubjectRef, subjectKey } from "./person-subject";

type Data = Record<string, unknown>;
export function validatedPersonKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Referências pessoais históricas inválidas.");
  return [...new Set(value.map((key) => {
    if (typeof key !== "string") throw new Error("Referência pessoal histórica inválida.");
    const split = key.indexOf(":");
    const ref = readSubjectRef({ namespace: key.slice(0, split), id: key.slice(split + 1) });
    if (!ref) throw new Error("Referência pessoal histórica inválida.");
    return subjectKey(ref);
  }))];
}
const origins = ["employeeId", "onboardingId", "generatedDocumentId", "workflowDocumentId", "workflowDocumentIds", "storagePath", "packageHash", "preSignatureHash", "packageId", "sourceFingerprint", "sourceGeneratedVersion", "sourceGeneratedHash", "sourceGeneratedStoragePath"] as const;
function bindingPayload(requestId: string, data: Data) {
  if (!requestId || requestId.includes("/") || typeof data.storagePath !== "string" || !data.storagePath || !/^[a-f0-9]{64}$/.test(String(data.packageHash ?? data.preSignatureHash))) throw new Error("Origem da solicitação pessoal inválida.");
  const payload: Data = { schemaVersion: 1, requestId, subjectKeys: validatedPersonKeys(data.subjectKeys), partyKeys: validatedPersonKeys(data.partyKeys ?? []) };
  for (const field of origins) payload[field] = data[field] ?? null;
  return payload;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
/** Server-created metadata bound to the exact request and pre-signature version. */
export function freezeSignaturePersonBinding<T extends Data>(requestId: string, data: T): T & { personBinding: Data } {
  const payload = bindingPayload(requestId, data);
  return { ...data, personBinding: { ...payload, bindingHash: digest(payload) } };
}
/** Never re-resolve a historical person against today's aliases or accounts. */
export function historicalSignaturePersonKeys(requestId: string, data: Data): { subjectKeys: string[]; partyKeys: string[] } {
  const payload = bindingPayload(requestId, data);
  const frozen = data.personBinding;
  if (frozen !== undefined && frozen !== null) {
    if (typeof frozen !== "object" || Array.isArray(frozen)) throw new Error("Vínculo histórico inválido.");
    const { bindingHash, ...stored } = frozen as Data;
    if (bindingHash !== digest(stored) || bindingHash !== digest(payload)) throw new Error("A origem ou versão da solicitação pessoal mudou.");
  } else if (!payload.subjectKeys || !(payload.subjectKeys as string[]).length) {
    // Narrow legacy fallback: only typed keys already stored on the same request.
    // Missing keys require reconciliation, never a lookup using current aliases.
    throw new Error("Solicitação legada sem titular histórico confirmado exige reconciliação.");
  }
  return { subjectKeys: payload.subjectKeys as string[], partyKeys: payload.partyKeys as string[] };
}
export function assertHistoricalGeneratedSource(request: Data, generatedId: string, generated: Data) {
  if (request.generatedDocumentId !== generatedId) throw new Error("Origem documental divergente.");
  if (request.personBinding && (request.sourceGeneratedVersion !== (generated.version ?? generated.templateVersion ?? null)
    || request.sourceGeneratedHash !== (generated.pdfContentHash ?? generated.docxContentHash ?? null)
    || request.sourceGeneratedStoragePath !== (generated.pdfStoragePath ?? generated.storagePath ?? null))) throw new Error("A versão documental mudou após o envio.");
}

/** Null owner in a frozen request is intentional; a later source edit cannot assign one. */
export function historicalSignatureEmployeeId(request: Data, generated: Data): string | null {
  const id = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  return request.personBinding ? id(request.employeeId) : id(request.employeeId) ?? id(generated.employeeId);
}
