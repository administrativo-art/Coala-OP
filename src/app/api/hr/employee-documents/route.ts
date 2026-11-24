import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertHrAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { EMPLOYEE_DOCUMENT_STATUSES } from "@/lib/hr/employee-document-options";
import {
  isAllowedEmployeeDocumentMimeType,
  MAX_EMPLOYEE_DOCUMENT_BYTES,
  fileExtension,
} from "@/lib/hr/employee-document-planning";
import { canAccessDocument, resolveDocumentVisibility } from "@/lib/hr/employee-document-access";
import { assertEmployeeUnitAccess, buildEmployeeDocumentAccessSubject, loadEmployeeDocumentAccessSettings } from "@/features/hr/lib/employee-document-access-server";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import {
  resolveDocumentDestination,
  resolveDuplicateAndVersion,
  type ExistingDocumentRef,
} from "@/lib/hr/employee-document-distribution";
import { matchEmployeeAgainstExpected } from "@/lib/hr/employee-document-match";
import { isPublishedToEmployee } from "@/lib/hr/employee-document-publication";
import { loadExpectedIdentity, employeeCodeFrom, hashBuffer } from "@/lib/hr/employee-document-identity";
import { confirmedSubjectKeysForIdentifier } from "@/features/privacy/person-lookup.server";
import { z } from "zod";
import type { HrAccess } from "@/features/hr/lib/server-access";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "employeeDocuments";
const STATUSES = new Set<string>(EMPLOYEE_DOCUMENT_STATUSES.map((status) => status.id));
const LEGACY_STATUSES = new Set(["expired"]);

function text(value: FormDataEntryValue | null, max = 200) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function cleanDocumentId(value: unknown) {
  return typeof value === "string" && /^[a-f0-9-]{32,40}$/i.test(value) ? value : randomUUID();
}
function pad2(n: number) { return String(n).padStart(2, "0"); }
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function serializedObject(value: unknown): Record<string, unknown> {
  const serialized = serializeHrValue(value);
  return serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? serialized as Record<string, unknown>
    : {};
}

type ManifestDocument = {
  documentId?: string;
  fileField?: string;
  documentTypeCode?: string;
  extractedFields?: Record<string, unknown>;
};

type SaveResult =
  | { id: string; duplicate: true; existingDocumentId: string }
  | ({ id: string; duplicate?: false } & Record<string, unknown>);

const path = "/api/hr/employee-documents" as const;
const documentIdSchema = z.string().trim().min(1).max(256).regex(/^[^/]+$/);
const employeeIdSchema = z.string().trim().min(1).max(128).regex(/^[^/]+$/);
const manifestDocumentSchema = z.object({
  documentId: z.string().max(256).optional(),
  fileField: z.string().min(1).max(128),
  documentTypeCode: z.string().max(80).optional(),
  extractedFields: z.record(z.string(), z.unknown()).optional(),
}).strict();
const manifestSchema = z.object({
  employeeId: employeeIdSchema,
  candidateId: z.string().max(128).nullable().optional(),
  documents: z.array(manifestDocumentSchema).min(1).max(50),
}).strict();
const patchSchema = z.object({ id: documentIdSchema,
  status: z.string().refine(value => STATUSES.has(value) || LEGACY_STATUSES.has(value)) }).strict();
type GetInput = { employeeId: string; paged: boolean; cursor: string | null; pageSize: number };
type PostInput = { employeeId: string; candidateId: string | null; form: FormData;
  documents: ManifestDocument[] | null; file: File | null; documentTypeCode: string | null };
type DocumentInput = { id: string };
type DocumentResource = { workspaceId: string; employeeId: string; ref: FirebaseFirestore.DocumentReference;
  snap: FirebaseFirestore.DocumentSnapshot };

function invalid(message = "Dados do documento inválidos."): never {
  throw new AppError({ code: "EMPLOYEE_DOCUMENT_INPUT_INVALID", kind: "VALIDATION", safeMessage: message });
}
async function actor(request: NextRequest, mode: "view" | "manage") {
  try { return await assertHrAccess(request, mode); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Sem permissão")) {
      throw new AppError({ code: "EMPLOYEE_DOCUMENT_FORBIDDEN", kind: "AUTHORIZATION",
        safeMessage: "Sem permissão para documentos de colaboradores." });
    }
    rethrowServerAuthenticationFailure(cause);
  }
}
async function assertUnit(access: HrAccess, employeeId: string) {
  await assertEmployeeUnitAccess(access, employeeId).catch(() => {
    throw new AppError({ code: "EMPLOYEE_DOCUMENT_UNIT_FORBIDDEN", kind: "AUTHORIZATION",
      safeMessage: "Colaborador indisponível para seu acesso." });
  });
}
function onlyQuery(request: NextRequest, allowed: readonly string[]) {
  if ([...request.nextUrl.searchParams.keys()].some(key => !allowed.includes(key))) invalid("Parâmetro inválido.");
}
function getInput(request: NextRequest): GetInput {
  onlyQuery(request, ["employeeId", "publishedOnly", "cursor", "limit"]);
  const employeeId = employeeIdSchema.safeParse(request.nextUrl.searchParams.get("employeeId"));
  if (!employeeId.success) invalid("Colaborador não informado.");
  const publishedOnly = request.nextUrl.searchParams.get("publishedOnly");
  if (publishedOnly !== null && publishedOnly !== "1") invalid("Filtro de publicação inválido.");
  const paged = publishedOnly === "1";
  const cursor = request.nextUrl.searchParams.get("cursor");
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (!paged && (cursor !== null || rawLimit !== null)) invalid("Paginação exige filtro publicado.");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) invalid("Cursor inválido.");
  if (rawLimit !== null && !/^(?:[1-9]|[1-9]\d|100)$/.test(rawLimit)) invalid("Limite inválido.");
  return { employeeId: employeeId.data, paged, cursor, pageSize: rawLimit ? Number(rawLimit) : 100 };
}
async function postInput(request: NextRequest): Promise<PostInput> {
  onlyQuery(request, []);
  const form = await request.formData().catch(() => invalid("Formulário de upload inválido."));
  const manifestText = text(form.get("manifest"), 400000);
  if (manifestText) {
    const parsedJson = (() => { try { return JSON.parse(manifestText); } catch { return null; } })();
    const parsed = manifestSchema.safeParse(parsedJson);
    if (!parsed.success) invalid("Manifesto de upload inválido.");
    const fields = new Set(["manifest", ...parsed.data.documents.map(entry => entry.fileField)]);
    if ([...form.keys()].some(key => !fields.has(key))) invalid("Campo de upload inválido.");
    return { employeeId: parsed.data.employeeId, candidateId: parsed.data.candidateId?.trim() || null,
      form, documents: parsed.data.documents, file: null, documentTypeCode: null };
  }
  if ([...form.keys()].some(key => !["file", "employeeId", "candidateId", "documentTypeCode"].includes(key))) {
    invalid("Campo de upload inválido.");
  }
  const employeeId = employeeIdSchema.safeParse(text(form.get("employeeId"), 128));
  const file = form.get("file");
  if (!employeeId.success || !(file instanceof File)) invalid("Selecione um arquivo e informe o colaborador.");
  return { employeeId: employeeId.data, candidateId: text(form.get("candidateId"), 128) || null,
    form, documents: null, file, documentTypeCode: text(form.get("documentTypeCode"), 80) || null };
}
async function documentResource(access: HrAccess, id: string): Promise<DocumentResource> {
  const ref = hrDbAdmin.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError({ code: "EMPLOYEE_DOCUMENT_NOT_FOUND", kind: "NOT_FOUND",
    safeMessage: "Documento não encontrado." });
  const employeeId = String(snap.get("employeeId") ?? "");
  await assertUnit(access, employeeId);
  return { workspaceId: access.workspaceId, employeeId, ref, snap };
}

const getContract = defineSecurityContract({ schemaVersion: 1, id: "hr.employee-documents.read", version: 1,
  surface: { method: "GET", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "hr-view-and-unit" }, resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "hr.employee-documents.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized" });
const postContract = defineSecurityContract({ schemaVersion: 1, id: "hr.employee-documents.upload", version: 1,
  surface: { method: "POST", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "hr-manage-and-unit" }, resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "hr.employee-documents.multipart", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const patchContract = defineSecurityContract({ schemaVersion: 1, id: "hr.employee-documents.status", version: 1,
  surface: { method: "PATCH", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "hr-manage-and-unit" }, resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "hr.employee-documents.status", unknownFields: "reject" },
  effects: { mode: "write", audit: "server-authoritative" }, errorExposure: "sanitized" });
const deleteContract = defineSecurityContract({ schemaVersion: 1, id: "hr.employee-documents.remove", version: 1,
  surface: { method: "DELETE", path }, exposure: "authenticated", identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "hr-manage-and-unit" }, resourceScope: { kind: "unit" },
  input: { kind: "schema", schema: "hr.employee-documents.remove", unknownFields: "reject" },
  effects: { mode: "delete", audit: "server-authoritative" }, errorExposure: "sanitized" });

const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, HrAccess, GetInput, { workspaceId: string; employeeId: string }>({
  id: "hr-employee-documents-read-v1", guarantees: ["authenticated-user", "active-user", "authorization:hr-view-and-unit", "unit-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) { const access = await actor(request, "view"); const input = getInput(request);
    if (access.permissions.dp?.collaborators?.ownProfileOnly === true && input.employeeId !== access.userDoc.id) {
      throw new AppError({ code: "EMPLOYEE_DOCUMENT_OWN_ONLY", kind: "AUTHORIZATION" });
    }
    await assertUnit(access, input.employeeId);
    return { actor: access, input, resource: { workspaceId: access.workspaceId, employeeId: input.employeeId } }; },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, HrAccess, PostInput, { workspaceId: string; employeeId: string }>({
  id: "hr-employee-documents-upload-v1", guarantees: ["authenticated-user", "active-user", "authorization:hr-manage-and-unit", "unit-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) { const access = await actor(request, "manage"); const input = await postInput(request);
    await assertUnit(access, input.employeeId);
    return { actor: access, input, resource: { workspaceId: access.workspaceId, employeeId: input.employeeId } }; },
});
const patchEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, HrAccess, { id: string; status: string }, DocumentResource>({
  id: "hr-employee-documents-status-v1", guarantees: ["authenticated-user", "active-user", "authorization:hr-manage-and-unit", "unit-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) { const access = await actor(request, "manage"); onlyQuery(request, []);
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) invalid("Documento ou status inválido.");
    return { actor: access, input: parsed.data, resource: await documentResource(access, parsed.data.id) }; },
});
const deleteEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, HrAccess, DocumentInput, DocumentResource>({
  id: "hr-employee-documents-remove-v1", guarantees: ["authenticated-user", "active-user", "authorization:hr-manage-and-unit", "unit-scoped", "input-validated", "fields-allowlisted"],
  async enforce({ request }) { const access = await actor(request, "manage"); onlyQuery(request, ["id"]);
    const parsed = documentIdSchema.safeParse(request.nextUrl.searchParams.get("id"));
    if (!parsed.success) invalid("Documento inválido.");
    return { actor: access, input: { id: parsed.data }, resource: await documentResource(access, parsed.data) }; },
});

/**
 * Arquivamento server-autoritativo. O cliente só informa `documentTypeCode`
 * (confirmado) e os campos extraídos (claim). O backend RECALCULA: match do
 * colaborador (bloqueia MISMATCH), duplicidade/versão (hash + chave lógica),
 * destino, nomenclatura e política de acesso. Nada de pasta/acesso/nome vem do
 * cliente. Persiste a análise completa e registra auditoria.
 */
async function saveEmployeeDocument(input: {
  access: Awaited<ReturnType<typeof assertHrAccess>>;
  employeeId: string;
  candidateId: string | null;
  documentTypeCode?: string | null;
  extractedFields: Record<string, unknown>;
  documentId?: string;
  file: File;
}): Promise<SaveResult> {
  const { access, employeeId, candidateId, extractedFields, file } = input;
  const subjectKeys = await confirmedSubjectKeysForIdentifier(employeeId);
  if (!isAllowedEmployeeDocumentMimeType(file.type) || file.size > MAX_EMPLOYEE_DOCUMENT_BYTES) {
    throw new Error("Envie PDF, DOC, DOCX, JPG ou PNG de até 15 MB.");
  }

  const config = getDocumentTypeConfig(input.documentTypeCode);
  const id = cleanDocumentId(input.documentId);

  // 1) Match determinístico reverificado no servidor — bloqueia colaborador errado.
  const identity = await loadExpectedIdentity(employeeId);
  if (identity) {
    const match = matchEmployeeAgainstExpected({
      extracted: {
        cpf: asString(extractedFields.cpf),
        registrationNumber: asString(extractedFields.registrationNumber),
        name: asString(extractedFields.employeeName),
        birthDate: asString(extractedFields.birthDate),
      },
      expected: identity,
    });
    if (match.status === "MISMATCH") {
      throw new Error("Documento pertence a outro colaborador (CPF divergente). Arquivamento bloqueado.");
    }
  }
  const employeeCode = employeeCodeFrom(identity, employeeId);

  // 2) Hash + duplicidade/versão contra os documentos já arquivados do colaborador.
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = hashBuffer(buffer);
  const existingSnap = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", employeeId).get();
  const existing: ExistingDocumentRef[] = existingSnap.docs
    .filter((d) => !d.get("deletedAt"))
    .map((d) => ({
      id: d.id,
      documentTypeCode: d.get("documentTypeCode") ?? null,
      contentHash: d.get("contentHash") ?? null,
      logicalKey: d.get("logicalKey") ?? null,
      version: typeof d.get("version") === "number" ? d.get("version") : 1,
    }));

  const dedupe = resolveDuplicateAndVersion({
    employeeId,
    code: config.code,
    strategy: config.duplicateStrategy,
    keys: config.duplicateKeys,
    fields: extractedFields,
    contentHash,
    existing,
  });

  if (dedupe.resolution === "EXACT_DUPLICATE" && dedupe.existingDocumentId) {
    await hrDbAdmin.collection(COLLECTION).doc(dedupe.existingDocumentId).collection("audit").add({
      action: "DUPLICATE_BLOCKED", actorId: access.decoded.uid,
      actorName: access.actorName, contentHash, at: Timestamp.now(),
    });
    return { id: dedupe.existingDocumentId, duplicate: true, existingDocumentId: dedupe.existingDocumentId };
  }

  // 3) Destino determinístico (pasta/processo/nome/acesso) a partir do tipo.
  const version = dedupe.version;
  const destination = resolveDocumentDestination({ config, employeeCode, fields: extractedFields, version });

  // 4) Caminho físico técnico e versionado (sem PII).
  const ext = fileExtension(file.name, file.type);
  const storageSubfolder = `hr/employee-documents/${employeeId}/documents/${id}`;
  const storagePath = `${storageSubfolder}/versions/${pad2(version)}/original.${ext}`;

  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
    resumable: false,
    metadata: { contentType: file.type, cacheControl: "private, max-age=0, no-store", metadata: { employeeId, documentId: id } },
  });

  const now = Timestamp.now();
  const payload = {
    employeeId, candidateId,
    subjectKeys,
    category: config.category,
    documentType: config.label,
    documentTypeCode: config.code,
    accessLevel: config.defaultAccessLevel,   // legado (compat)
    accessPolicyId: config.accessPolicyId,    // autoritativo
    status: "received",
    // Destino determinístico
    folderCode: destination.folderCode,
    caseId: destination.caseId,
    subcaseId: destination.subcaseId,
    destinationTrail: destination.pathSegments,
    displayName: destination.displayName,
    storedName: destination.downloadName,
    // Duplicidade / versão
    contentHash, hashAlgorithm: "sha256", logicalKey: dedupe.logicalKey,
    version, versionResolution: dedupe.resolution,
    // Análise persistida (Fase 2)
    extractedFields: extractedFields ?? {},
    // Arquivo
    originalName: file.name.slice(0, 180), mimeType: file.type, size: file.size,
    storagePath, storageSubfolder,
    uploadedBy: access.decoded.uid, uploadedByName: access.actorName,
    validatedBy: null, validatedByName: null, validatedAt: null, uploadedAt: now, updatedAt: now,
    accessCount: 0, deletedAt: null,
  };
  await hrDbAdmin.collection(COLLECTION).doc(id).set(payload);
  await hrDbAdmin.collection(COLLECTION).doc(id).collection("audit").add({
    action: "DOCUMENT_FILED", actorId: access.decoded.uid, actorName: payload.uploadedByName,
    documentTypeCode: config.code, version, accessPolicyId: config.accessPolicyId,
    versionResolution: dedupe.resolution, at: now,
  });
  return { id, ...serializedObject(payload) };
}

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
    const access = security.actor;
    const { employeeId, paged, cursor, pageSize } = security.input;
    const collection = hrDbAdmin.collection(COLLECTION);
    const query = paged
      ? collection.where("employeeId", "==", employeeId).where("publication.status", "==", "published").orderBy(FieldPath.documentId()).limit(pageSize + 1)
      : collection.where("employeeId", "==", employeeId);
    const snap = await (paged && cursor ? query.startAfter(cursor) : query).get();
    const page = paged ? snap.docs.slice(0, pageSize) : snap.docs;
    const nextCursor = paged && snap.docs.length > pageSize ? page.at(-1)?.id ?? null : null;
    // Aplica a política de sigilo por documento; o usuário só recebe o que pode ver.
    const accessSettings = await loadEmployeeDocumentAccessSettings(access);
    const subject = buildEmployeeDocumentAccessSubject(access, accessSettings, employeeId);
    const documents = page
      .filter((doc) => !doc.get("deletedAt"))
      .filter((doc) => !paged || isPublishedToEmployee(doc.data()))
      .filter((doc) => canAccessDocument(
        { documentTypeCode: doc.get("documentTypeCode"), category: doc.get("category"), accessLevel: doc.get("accessLevel") },
        subject,
        accessSettings.visibilityConfig,
      ).allowed)
      .map((doc) => ({
        id: doc.id,
        ...serializedObject(doc.data()),
        storagePath: undefined,
        storageSubfolder: undefined,
        signedFileUrl: undefined,
        resolvedVisibility: resolveDocumentVisibility(
          { documentTypeCode: doc.get("documentTypeCode"), category: doc.get("category") },
          accessSettings.visibilityConfig,
        ),
      }))
      .sort((a: any, b: any) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return NextResponse.json(paged ? { documents, nextCursor } : { documents });
});

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => {
    const access = security.actor;
    const { form, employeeId, candidateId, documents } = security.input;
    if (documents) {

      const savedDocuments: SaveResult[] = [];
      const failures: { documentId?: string; error: string }[] = [];
      for (const entry of documents) {
        const file = form.get(entry.fileField ?? "");
        if (!(file instanceof File)) { failures.push({ documentId: entry.documentId, error: "Arquivo ausente no lote." }); continue; }
        try {
          // Um item com erro NÃO bloqueia os demais (arquivamento parcial).
          savedDocuments.push(await saveEmployeeDocument({
            access,
            employeeId,
            candidateId,
            documentTypeCode: typeof entry.documentTypeCode === "string" ? entry.documentTypeCode : null,
            extractedFields: entry.extractedFields && typeof entry.extractedFields === "object" ? entry.extractedFields : {},
            documentId: entry.documentId,
            file,
          }));
        } catch (cause) {
          failures.push({ documentId: entry.documentId,
            error: cause instanceof Error && ["Envie PDF, DOC, DOCX, JPG ou PNG de até 15 MB.",
              "Documento pertence a outro colaborador (CPF divergente). Arquivamento bloqueado."].includes(cause.message)
              ? cause.message : "Falha ao arquivar documento." });
        }
      }

      return NextResponse.json({ documents: savedDocuments, failures }, { status: 201 });
    }

    // Caminho de arquivo único (compat): também server-autoritativo pelo tipo.
    const document = await saveEmployeeDocument({
      access, employeeId, candidateId,
      documentTypeCode: security.input.documentTypeCode,
      extractedFields: {},
      file: security.input.file!,
    });
    return NextResponse.json({ document }, { status: 201 });
});

export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security }) => {
    const access = security.actor;
    const { status } = security.input;
    const { ref } = security.resource;
    const now = Timestamp.now();
    const update: Record<string, unknown> = { status, updatedAt: now };
    if (status === "validated") Object.assign(update, { validatedBy: access.decoded.uid, validatedByName: access.actorName, validatedAt: now });
    await ref.update(update);
    await ref.collection("audit").add({ action: `status_${status}`, actorId: access.decoded.uid, actorName: access.actorName, at: now });
    return NextResponse.json({ ok: true });
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => {
    const access = security.actor;
    const { ref, snap } = security.resource;
    const storagePath = snap.get("storagePath");
    // Signed binaries belong to the signature history and may have multiple references.
    // Removing an archive entry must not destroy that shared original.
    if (snap.get("signatureStatus") === "signed" || snap.get("source") === "autentique_signature") {
      const auditRef = ref.collection("audit").doc();
      await hrDbAdmin.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (current.get("deletedAt")) return;
        if (current.get("storagePath") !== storagePath) throw new Error("O documento mudou; atualize a lista antes de remover.");
        const now = Timestamp.now();
        transaction.update(ref, { deletedAt: now, deletedBy: access.decoded.uid, updatedAt: now });
        transaction.set(auditRef, { action: "DOCUMENT_REMOVED_FROM_ARCHIVE", actorId: access.decoded.uid, actorName: access.actorName, storageRetained: true, reason: "Original assinado preservado na trilha de assinatura", at: now });
      });
      return NextResponse.json({ ok: true, storageRetained: true });
    }
    if (typeof storagePath === "string") await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).delete({ ignoreNotFound: true });
    await ref.update({ deletedAt: Timestamp.now(), deletedBy: access.decoded.uid, storagePath: FieldValue.delete(), updatedAt: Timestamp.now() });
    await ref.collection("audit").add({ action: "DOCUMENT_DELETED", actorId: access.decoded.uid, actorName: access.actorName, at: Timestamp.now() });
    return NextResponse.json({ ok: true });
});
