import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
import { canAccessDocument, subjectFromPermissions } from "@/lib/hr/employee-document-access";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import {
  resolveDocumentDestination,
  resolveDuplicateAndVersion,
  type ExistingDocumentRef,
} from "@/lib/hr/employee-document-distribution";
import { matchEmployeeAgainstExpected } from "@/lib/hr/employee-document-match";
import { loadExpectedIdentity, employeeCodeFrom, hashBuffer } from "@/lib/hr/employee-document-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "employeeDocuments";
const STATUSES = new Set<string>(EMPLOYEE_DOCUMENT_STATUSES.map((status) => status.id));
const LEGACY_STATUSES = new Set(["expired"]);

function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
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

export async function GET(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "view");
    const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim();
    if (!employeeId) return error("Colaborador não informado.");
    if (access.permissions.dp?.collaborators?.ownProfileOnly === true && employeeId !== access.userDoc.id) {
      return error("Este perfil permite acessar apenas os próprios documentos.", 403);
    }
    const snap = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", employeeId).get();
    // Aplica a política de sigilo por documento; o usuário só recebe o que pode ver.
    const subject = subjectFromPermissions(access.permissions, {
      isDefaultAdmin: access.isDefaultAdmin,
      isOwner: employeeId === access.decoded.uid,
    });
    const documents = snap.docs
      .filter((doc) => !doc.get("deletedAt"))
      .filter((doc) => canAccessDocument(
        { documentTypeCode: doc.get("documentTypeCode"), accessLevel: doc.get("accessLevel") },
        subject,
      ).allowed)
      .map((doc) => ({ id: doc.id, ...serializedObject(doc.data()) }))
      .sort((a: any, b: any) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return NextResponse.json({ documents });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao carregar documentos.", 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const form = await request.formData();
    const manifestText = text(form.get("manifest"), 400000);
    if (manifestText) {
      const manifest = JSON.parse(manifestText) as {
        employeeId?: string;
        candidateId?: string | null;
        documents?: ManifestDocument[];
      };
      const employeeId = typeof manifest.employeeId === "string" ? manifest.employeeId.trim() : "";
      const candidateId = typeof manifest.candidateId === "string" && manifest.candidateId.trim() ? manifest.candidateId.trim() : null;
      const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
      if (!employeeId || documents.length === 0) return error("Manifesto de upload inválido.");

      const savedDocuments: SaveResult[] = [];
      const failures: { documentId?: string; error: string }[] = [];
      for (const entry of documents) {
        const fileField = typeof entry.fileField === "string" ? entry.fileField : "";
        const file = form.get(fileField);
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
          failures.push({ documentId: entry.documentId, error: cause instanceof Error ? cause.message : "Falha ao arquivar." });
        }
      }

      return NextResponse.json({ documents: savedDocuments, failures }, { status: 201 });
    }

    // Caminho de arquivo único (compat): também server-autoritativo pelo tipo.
    const file = form.get("file");
    const employeeId = text(form.get("employeeId"), 128);
    const candidateId = text(form.get("candidateId"), 128) || null;
    if (!(file instanceof File) || !employeeId) return error("Selecione um arquivo e informe o colaborador.");
    const document = await saveEmployeeDocument({
      access, employeeId, candidateId,
      documentTypeCode: text(form.get("documentTypeCode"), 80) || null,
      extractedFields: {},
      file,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao enviar documento.", 403);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!id || (!STATUSES.has(status) && !LEGACY_STATUSES.has(status))) return error("Documento ou status inválido.");
    const ref = hrDbAdmin.collection(COLLECTION).doc(id);
    if (!(await ref.get()).exists) return error("Documento não encontrado.", 404);
    const now = Timestamp.now();
    const update: Record<string, unknown> = { status, updatedAt: now };
    if (status === "validated") Object.assign(update, { validatedBy: access.decoded.uid, validatedByName: access.actorName, validatedAt: now });
    await ref.update(update);
    await ref.collection("audit").add({ action: `status_${status}`, actorId: access.decoded.uid, actorName: access.actorName, at: now });
    return NextResponse.json({ ok: true });
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Falha ao atualizar documento.", 403); }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await assertHrAccess(request, "manage");
    const id = request.nextUrl.searchParams.get("id") ?? "";
    const ref = hrDbAdmin.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return error("Documento não encontrado.", 404);
    const storagePath = snap.get("storagePath");
    if (typeof storagePath === "string") await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).delete({ ignoreNotFound: true });
    await ref.update({ deletedAt: Timestamp.now(), deletedBy: access.decoded.uid, storagePath: FieldValue.delete(), updatedAt: Timestamp.now() });
    await ref.collection("audit").add({ action: "DOCUMENT_DELETED", actorId: access.decoded.uid, actorName: access.actorName, at: Timestamp.now() });
    return NextResponse.json({ ok: true });
  } catch (cause) { return error(cause instanceof Error ? cause.message : "Falha ao excluir documento.", 403); }
}
