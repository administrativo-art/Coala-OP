import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { canAccessUnit } from "@/lib/unit-access";
import { isCompanyDocumentCategory } from "@/lib/documents/company-document-categories";
import { companyIntakeName, companyIntakeSchema } from "@/lib/documents/company-document-intake";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { z } from "zod";

export const runtime = "nodejs";
const contract = defineSecurityContract({ schemaVersion: 1, id: "documents.company.intake", version: 1,
  surface: { method: "POST", path: "/api/documents/company/intake" }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "company-documents-manage" }, resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.company.intake", unknownFields: "reject" }, effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
type Input = { file: File; metadata: ReturnType<typeof companyIntakeSchema.parse> };
const fail = (message: string) => new AppError({ code: "COMPANY_INTAKE_INVALID", kind: "VALIDATION", safeMessage: message });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, { unitName: string | null }>({
  id: "company-intake-v1", guarantees: ["authenticated-user", "active-user", "authorization:company-documents-manage", "workspace-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!hasFormalizationPermission(actor.permissions, "companyDocuments.manage", actor.isDefaultAdmin)) throw new AppError({ code: "COMPANY_INTAKE_FORBIDDEN", kind: "AUTHORIZATION" });
    if (request.nextUrl.searchParams.size) throw fail("Parâmetros inválidos.");
    const form = await request.formData();
    if ([...form.keys()].some((key) => !["file", "metadata"].includes(key)) || form.getAll("file").length !== 1 || form.getAll("metadata").length !== 1) throw fail("Envio inválido.");
    const file = form.get("file");
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("metadata"))); } catch { throw fail("Metadados inválidos."); }
    const metadata = companyIntakeSchema.safeParse(raw);
    if (!metadata.success || !(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw fail("Confira os campos e envie um arquivo de até 10 MB.");
    if (!isCompanyDocumentCategory(metadata.data.category)) throw fail("Categoria inválida.");
    let unitName: string | null = null;
    if (metadata.data.unitId) {
      if (!canAccessUnit(actor.userDoc, metadata.data.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: "COMPANY_INTAKE_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
      const unit = await dbAdmin.collection("dp_units").doc(metadata.data.unitId).get();
      if (!unit.exists || unit.get("isArchived")) throw fail("Unidade indisponível.");
      unitName = String(unit.get("name") ?? unit.id);
    }
    return { actor, input: { file, metadata: metadata.data }, resource: { unitName } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { file, metadata } = security.input;
  const bytes = Buffer.from(await file.arrayBuffer());
  const extension = bytes.subarray(0, 5).toString() === "%PDF-" ? "pdf"
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpg" : null;
  const mimeType = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : "image/jpeg";
  if (!extension || file.type !== mimeType) throw fail("O conteúdo do arquivo não corresponde a PDF, JPG ou PNG declarado.");
  const id = randomUUID();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const logicalKey = createHash("sha256").update(JSON.stringify([security.actor.workspace_id, metadata.documentType ? companyIntakeName({ ...metadata, documentType: metadata.documentType, version: 1, extension: "" }) : id])).digest("hex");
  const ref = dbAdmin.collection("companyDocuments").doc(id);
  const key = dbAdmin.collection("companyDocumentLogicalKeys").doc(logicalKey);
  const contentKey = dbAdmin.collection("companyDocumentContentKeys").doc(`${logicalKey}-${hash}`);
  const storagePath = `company-documents/${id}/original.${extension}`;
  const blob = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath);
  await blob.save(bytes, { resumable: false, metadata: { contentType: mimeType, cacheControl: "private, no-store" } });
  let result;
  try {
    result = await dbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(key);
      const previousContent = await tx.get(contentKey);
      if (previousContent.get("documentId")) {
        const existing = await tx.get(dbAdmin.collection("companyDocuments").doc(previousContent.get("documentId")));
        if (existing.exists && !existing.get("deletedAt")) return { id: existing.id, data: existing.data()!, duplicate: true };
      }
      const version = Number(current.get("version") ?? 0) + 1;
      const now = Timestamp.now();
      const data = { workspaceId: security.actor.workspace_id, title: metadata.title, category: metadata.documentType ? metadata.category : "A classificar", unit: security.resource.unitName,
        unitId: metadata.unitId ?? null, scopeId: metadata.unitId ?? "GERAL", documentType: metadata.documentType ?? null, reference: metadata.reference,
        originalName: file.name.slice(0, 180), standardizedName: metadata.documentType ? companyIntakeName({ ...metadata, documentType: metadata.documentType, version, extension }) : null,
        namingVersion: 2, logicalKey, version, contentHash: hash, hashAlgorithm: "sha256", mimeType, size: bytes.length, storagePath,
        status: metadata.documentType ? "active" : "pending_classification", accessCount: 0, uploadedAt: now, updatedAt: now,
        uploadedBy: security.actor.decoded.uid, uploadedByName: String(security.actor.userDoc.username ?? ""), deletedAt: null };
      tx.create(ref, data);
      tx.create(ref.collection("audit").doc(), { action: "DOCUMENT_UPLOADED", actorId: security.actor.decoded.uid, originalName: data.originalName, appliedName: data.standardizedName, analysisMethod: "rule", at: now });
      tx.set(key, { documentId: id, contentHash: hash, version });
      tx.set(contentKey, { documentId: id });
      return { id, data, duplicate: false };
    });
  } catch (error) { await blob.delete({ ignoreNotFound: true }); throw error; }
  if (result.duplicate) await blob.delete({ ignoreNotFound: true });
  return NextResponse.json({ document: { ...serializeHrValue(result.data) as Record<string, unknown>, id: result.id, storagePath: undefined }, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
});

const classificationSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().min(1), metadata: companyIntakeSchema }).strict();
const classificationContract = defineSecurityContract({ ...contract, id: "documents.company.classify", surface: { method: "PATCH", path: "/api/documents/company/intake" }, input: { kind: "schema", schema: "documents.company.classify", unknownFields: "reject" } });
const classificationEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, z.infer<typeof classificationSchema>, { unitName: string | null }>({
  id: "company-classification-v1", guarantees: enforcer.guarantees,
  async enforce({ request }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!hasFormalizationPermission(actor.permissions, "companyDocuments.manage", actor.isDefaultAdmin)) throw new AppError({ code: "COMPANY_CLASSIFY_FORBIDDEN", kind: "AUTHORIZATION" });
    const parsed = classificationSchema.safeParse(await request.json().catch(() => null));
    if (request.nextUrl.searchParams.size || !parsed.success || !parsed.data.metadata.documentType || !isCompanyDocumentCategory(parsed.data.metadata.category) || parsed.data.metadata.category === "A classificar") throw fail("Confirme tipo, categoria, escopo e referência.");
    let unitName: string | null = null;
    if (parsed.data.metadata.unitId) {
      if (!canAccessUnit(actor.userDoc, parsed.data.metadata.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: "COMPANY_CLASSIFY_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
      const unit = await dbAdmin.collection("dp_units").doc(parsed.data.metadata.unitId).get();
      if (!unit.exists || unit.get("isArchived")) throw fail("Unidade indisponível.");
      unitName = String(unit.get("name") ?? unit.id);
    }
    return { actor, input: parsed.data, resource: { unitName } };
  },
});
export const PATCH = secureRoute({ contract: classificationContract, enforcer: classificationEnforcer }, async ({ security }) => {
  const { metadata, id, expectedVersion } = security.input;
  const documentType = metadata.documentType!;
  const logicalKey = createHash("sha256").update(JSON.stringify([security.actor.workspace_id, companyIntakeName({ ...metadata, documentType, version: 1, extension: "" })])).digest("hex");
  const ref = dbAdmin.collection("companyDocuments").doc(id);
  const key = dbAdmin.collection("companyDocumentLogicalKeys").doc(logicalKey);
  const result = await dbAdmin.runTransaction(async (tx) => {
    const source = await tx.get(ref);
    if (!source.exists || source.get("deletedAt") || source.get("workspaceId") && source.get("workspaceId") !== security.actor.workspace_id) throw new AppError({ code: "COMPANY_CLASSIFY_NOT_FOUND", kind: "NOT_FOUND" });
    if (source.get("unitId") && !canAccessUnit(security.actor.userDoc, source.get("unitId"), { isDefaultAdmin: security.actor.isDefaultAdmin })) throw new AppError({ code: "COMPANY_CLASSIFY_SOURCE_FORBIDDEN", kind: "AUTHORIZATION" });
    if (source.get("logicalKey") === logicalKey && source.get("status") === "active") return source.data()!;
    if (source.get("version") !== expectedVersion || source.get("status") !== "pending_classification" && source.get("category") !== "A classificar") throw new AppError({ code: "COMPANY_CLASSIFY_CONFLICT", kind: "CONFLICT", safeMessage: "Este documento já foi atualizado. Atualize a lista antes de confirmar." });
    const hash = source.get("contentHash");
    const extension = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" }[String(source.get("mimeType"))];
    if (typeof hash !== "string" || !extension) throw fail("O legado precisa ter formato e hash confirmados antes da classificação.");
    const contentKey = dbAdmin.collection("companyDocumentContentKeys").doc(`${logicalKey}-${hash}`);
    const [current, duplicate] = await Promise.all([tx.get(key), tx.get(contentKey)]);
    if (duplicate.get("documentId") && duplicate.get("documentId") !== id) {
      const existing = await tx.get(dbAdmin.collection("companyDocuments").doc(duplicate.get("documentId")));
      if (existing.exists && !existing.get("deletedAt")) throw new AppError({ code: "COMPANY_CLASSIFY_DUPLICATE", kind: "CONFLICT", safeMessage: "Este arquivo já está arquivado com o mesmo tipo, escopo e referência. Confira a duplicata antes de continuar." });
    }
    const version = Number(current.get("version") ?? 0) + 1;
    const now = Timestamp.now();
    const update = { title: metadata.title, category: metadata.category, documentType, reference: metadata.reference, unitId: metadata.unitId ?? null, unit: security.resource.unitName, scopeId: metadata.unitId ?? "GERAL", logicalKey, version, namingVersion: 2,
      standardizedName: companyIntakeName({ ...metadata, documentType, version, extension }), status: "active", updatedAt: now };
    tx.update(ref, update);
    tx.set(key, { documentId: id, contentHash: hash, version });
    tx.set(contentKey, { documentId: id });
    tx.create(ref.collection("audit").doc(), { action: "DOCUMENT_CLASSIFIED", actorId: security.actor.decoded.uid, originalName: source.get("originalName") ?? null, previousName: source.get("standardizedName") ?? null, appliedName: update.standardizedName, category: update.category, scopeId: update.scopeId, analysisMethod: "rule", at: now });
    return { ...source.data(), ...update };
  });
  return NextResponse.json({ document: { ...serializeHrValue(result) as Record<string, unknown>, id, storagePath: undefined } }, { headers: { "Cache-Control": "private, no-store" } });
});
