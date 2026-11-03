import { createHash } from "node:crypto";

type Workflow = { id: string; signatureRequestId?: unknown; templateId?: unknown; status?: unknown; employeeDocumentId?: unknown; selected?: unknown };
type Request = { status?: unknown; signedStoragePath?: unknown; signedHash?: unknown; manifest?: { schemaVersion?: unknown; packageType?: unknown; components?: Array<{ templateId?: unknown }> } };
const complete = new Set(["signed", "signed_archived_pending_employee", "archived"]);
const string = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** A signed admission bundle is one PDF. Its component workflows are references, not separate signed files. */
export function planSignedAdmissionArchive(onboardingId: string, workflows: Workflow[], request: Request | null) {
  const requestId = `signature_bundle_${onboardingId}`;
  const members = workflows.filter((workflow) => workflow.signatureRequestId === requestId && workflow.selected !== false);
  const workflowIds = members.map((workflow) => workflow.id);
  const base = { requestId, workflowIds };
  if (!members.length) return { ...base, kind: "none" as const };
  if (!members.every((workflow) => complete.has(string(workflow.status)))) return { ...base, kind: "none" as const };
  const existingIds = [...new Set(members.map((workflow) => string(workflow.employeeDocumentId)).filter(Boolean))];
  if (existingIds.length && members.every((workflow) => string(workflow.employeeDocumentId))) {
    return { ...base, kind: "existing" as const, documentIds: existingIds };
  }
  if (existingIds.length) throw new Error("O pacote foi parcialmente arquivado; reconcilie as referências antes de continuar.");
  if (!request || !complete.has(string(request.status))) return { ...base, kind: "none" as const };
  const manifest = request.manifest;
  if (manifest?.schemaVersion !== 1 || manifest.packageType !== "admission" || !Array.isArray(manifest.components)) throw new Error("Manifesto admissional não confirmado.");
  const expected = manifest.components.map((component) => string(component.templateId)).filter((id) => id && id !== "system-admission-bundle-closing-term");
  const actual = members.map((workflow) => string(workflow.templateId));
  if (!expected.length || new Set(expected).size !== expected.length || new Set(actual).size !== actual.length || expected.length !== actual.length || !expected.every((id) => actual.includes(id))) throw new Error("Os componentes do pacote não correspondem ao manifesto assinado.");
  const path = string(request.signedStoragePath), signedHash = string(request.signedHash);
  if (!path || !/^[a-f0-9]{64}$/i.test(signedHash)) throw new Error("Arquivo ou hash assinado não confirmado.");
  return { ...base, kind: "create" as const, documentId: createHash("sha256").update(`signed-admission-package:${requestId}`).digest("hex").slice(0, 32), signedStoragePath: path, signedHash };
}
