import { subjectKey } from "@/features/privacy/person-subject";
import { randomUUID, createHash } from "node:crypto";
import "server-only";
import { FieldValue, FieldPath, type Query, type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { confirmedOnboardingPublicPrefix } from "./onboarding-upload-scope.server";
import { AppError } from "@/lib/observability/app-error";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const segment = (v: unknown): v is string => typeof v === "string" && Boolean(v) && !/[/\\\u0000]/.test(v) && v !== "." && v !== "..";
const RECORD_LIMIT = 25, FILE_LIMIT = 25, PREFIX_LIMIT = 20;
const unavailable = () => new AppError({ code: "ONBOARDING_DISCARD_INVALID", kind: "CONFLICT", safeMessage: "Somente uma admissão encerrada sem conclusão pode ter seus arquivos excluídos." });
/** Idempotent, bounded physical deletion. Metadata/audit remain; unrelated deduplicated documents do not belong to this source. */
export async function discardCancelledOnboardingDocuments(id: string, actorId: string, assertScope?: (process: Record<string, unknown>) => void) {
  if (!segment(id)) throw unavailable();
  const ref = hrDbAdmin.collection("onboardingProcesses").doc(id), operationId = randomUUID();
  const initial = await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists || current.get("status") !== "cancelled" || current.get("completedAt")) throw unavailable();
    assertScope?.(current.data() ?? {});
    if (Number(current.get("documentDiscardLease.until")) > Date.now()) return null;
    tx.set(ref, { documentDiscardLease: { id: operationId, until: Date.now() + 120_000 } }, { merge: true });
    return current;
  });
  if (!initial) return { status: "pending", waitingForOperation: true, removedFiles: 0, blockedFiles: 0 };
  const process = initial.data() ?? {};
  const serviceActors = new Set(["system:onboarding-document-discard", "system:cancelled-upload", "system:cancelled-signature-return", "system:cancelled-pj-operation"]);
  const actorKeys = serviceActors.has(actorId) ? [] : [subjectKey({ namespace: "main.users", id: actorId })];
  const deadline = Date.now() + 45_000;
  try {
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  // Policy is verified during release; never imply that a provider recovery window was bypassed.
  const configuredRecovery = Number(globalThis.process.env.ONBOARDING_STORAGE_SOFT_DELETE_SECONDS);
  const storageRecoverySeconds = globalThis.process.env.FIREBASE_STORAGE_EMULATOR_HOST ? 0 : Number.isSafeInteger(configuredRecovery) && configuredRecovery >= 0 ? configuredRecovery : null;
  if (storageRecoverySeconds === null) throw new AppError({ code: "ONBOARDING_STORAGE_POLICY_UNKNOWN", kind: "CONFLICT", safeMessage: "A política de exclusão do armazenamento precisa ser confirmada antes de concluir." });
  const progress = object(process.documentDiscardProgress);
  const storagePages = object(progress.storage), blockedObjects = object(progress.blockedObjects);
  progress.storage = storagePages; progress.blockedObjects = blockedObjects;
  const page = (query: Query, key: string) => {
    const ordered = query.orderBy(FieldPath.documentId());
    return (typeof progress[key] === "string" ? ordered.startAfter(progress[key]) : ordered).limit(RECORD_LIMIT + 1).get();
  };
  const [employeeDocs, generated, requests, workflows, scopes, uploads, versions] = await Promise.all([
    page(hrDbAdmin.collection("employeeDocuments").where("sourceOnboardingId", "==", id), "employees"),
    page(dbAdmin.collection("generatedDocuments").where("onboardingId", "==", id), "generated"),
    page(hrDbAdmin.collection("hrSignatureRequests").where("onboardingId", "==", id), "requests"),
    page(hrDbAdmin.collection("hrSignatureDocuments").where("onboardingId", "==", id), "workflows"),
    page(ref.collection("documentStorageScopes"), "scopes"), page(ref.collection("documentFiles"), "uploads"), page(ref.collection("generatedDocuments"), "versions"),
  ]);
  const pages = { employees: employeeDocs, generated, requests, workflows, scopes, uploads, versions };
  const moreRecords = Object.values(pages).some((page) => page.size > RECORD_LIMIT);
  let storagePending = false, waitingForUploads = false, removed = 0, blocked = 0;
  const ownedEmployee = employeeDocs.docs.slice(0, RECORD_LIMIT).filter((doc) => ["recruitment_onboarding", "autentique_signature"].includes(String(doc.get("source"))));
  const records: DocumentSnapshot[] = [...ownedEmployee, ...generated.docs.slice(0, RECORD_LIMIT), ...requests.docs.slice(0, RECORD_LIMIT), ...workflows.docs.slice(0, RECORD_LIMIT), ...versions.docs.slice(0, RECORD_LIMIT)];
  const requestRefs = generated.docs.slice(0, RECORD_LIMIT).map((doc) => doc.get("signatureRequestId")).filter(segment).map((requestId) => hrDbAdmin.collection("hrSignatureRequests").doc(requestId));
  if (requestRefs.length) {
    const linked = await hrDbAdmin.getAll(...requestRefs);
    for (const request of linked) if (request.exists && generated.docs.some((doc) => doc.id === request.get("generatedDocumentId")) && !records.some((doc) => doc.ref.path === request.ref.path)) records.push(request);
  }

  const known = new Set<string>();
  const pointers = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (["storagePath", "filePath", "signedStoragePath", "pdfStoragePath", "generatedPdfStoragePath", "manifestPath", "manifestStoragePath", "preSignaturePath", "generatedStoragePath", "sourceGeneratedStoragePath"].includes(key) && typeof entry === "string") known.add(entry);
      else if (entry && typeof entry === "object") pointers(entry);
    }
  };
  pointers(process); records.forEach((doc) => pointers(doc.data()));
  uploads.docs.slice(0, RECORD_LIMIT).forEach((doc) => { if (typeof doc.get("path") === "string") known.add(doc.get("path")); });
  const prefixes = new Map<string, "public" | "owned" | "process">([[`hr/onboarding/${id}/`, "process"], [`signed-documents/${id}/`, "process"], [`signature-packages/${id}/`, "process"], [`generated-documents/${id}/`, "process"]]);
  for (const scope of scopes.docs.slice(0, RECORD_LIMIT)) if (scope.get("onboardingId") === id && /^hr\/onboarding\/[A-Za-z0-9_-]+\/$/.test(String(scope.get("prefix")))) prefixes.set(String(scope.get("prefix")), "public");
  if (segment(process.publicToken)) {
    const prefix = await confirmedOnboardingPublicPrefix(id, process, `hr/onboarding/${process.publicToken}/probe`);
    if (prefix) prefixes.set(prefix, "public");
  }
  for (const path of known) if (path.startsWith("hr/onboarding/")) {
    const prefix = await confirmedOnboardingPublicPrefix(id, process, path);
    if (prefix) prefixes.set(prefix, "public");
    else if (![...prefixes.keys()].some((ownedPrefix) => path.startsWith(ownedPrefix))) {
      const file = bucket.file(path);
      if ((await file.exists())[0]) {
        const [metadata] = await file.getMetadata();
        blockedObjects[createHash("sha256").update(`${path}#${metadata.generation}`).digest("hex")] = { path, generation: String(metadata.generation) };
      }
    }
  }
  for (const doc of ownedEmployee) if (segment(doc.get("employeeId"))) prefixes.set(`hr/employee-documents/${doc.get("employeeId")}/documents/${doc.id}/`, "owned");
  for (const doc of generated.docs.slice(0, RECORD_LIMIT)) {
    prefixes.set(`generated-documents/${id}/${doc.id}/`, "owned");
    prefixes.set(`signed-documents/generated/${doc.id}/`, "owned");
    prefixes.set(`signature-documents/${doc.id}/`, "owned");
  }
  // Remove availability first. Retrying keeps provenance and paths private until every byte is gone.
  const writeRecords = async (fields: Record<string, unknown>) => {
    const hrBatch = hrDbAdmin.batch(), mainBatch = dbAdmin.batch();
    let hrCount = 0, mainCount = 0;
    for (const doc of records) {
      if (doc.ref.firestore === dbAdmin) { mainBatch.set(doc.ref, fields, { merge: true }); mainCount++; }
      else { hrBatch.set(doc.ref, fields, { merge: true }); hrCount++; }
    }
    await Promise.all([...(hrCount ? [hrBatch.commit()] : []), ...(mainCount ? [mainBatch.commit()] : [])]);
  };
  await writeRecords({ status: "discarded", deletedAt: FieldValue.serverTimestamp(), discardedBy: actorId });
  let prefixesRead = 0, filesRead = 0;
  const orderedPrefixes = [...prefixes].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [prefix, ownership] of orderedPrefixes) {
    if (typeof progress.prefixCursor === "string" && prefix <= progress.prefixCursor) continue;
    if (prefixesRead >= PREFIX_LIMIT || filesRead >= FILE_LIMIT || Date.now() >= deadline) { storagePending = true; break; }
    prefixesRead++;
    await hrDbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get("documentDiscardLease.id") !== operationId) throw unavailable();
      tx.update(ref, { "documentDiscardLease.until": Date.now() + 120_000 });
    });
    const prefixKey = createHash("sha256").update(prefix).digest("hex");
    const [files, next] = await bucket.getFiles({ prefix, versions: true, maxResults: Math.min(5, FILE_LIMIT - filesRead), autoPaginate: false, ...(typeof storagePages[prefixKey] === "string" ? { pageToken: storagePages[prefixKey] as string } : {}) });
    if (next?.pageToken) { storagePending = true; storagePages[prefixKey] = next.pageToken; } else delete storagePages[prefixKey];
    for (const file of files) {
      filesRead++;
      const objectKey = createHash("sha256").update(`${file.name}#${file.metadata.generation}`).digest("hex");
      if (ownership === "public" && file.name.slice(prefix.length).includes("/") || ownership === "process" && file.metadata.metadata?.onboardingId !== id && !known.has(file.name)) { blockedObjects[objectKey] = { path: file.name, generation: String(file.metadata.generation) }; blocked++; continue; }
      const references = await Promise.all([
        hrDbAdmin.collection("employeeDocuments").where("storagePath", "==", file.name).limit(26).get(),
        ...["storagePath", "pdfStoragePath", "signedStoragePath"].map((field) => dbAdmin.collection("generatedDocuments").where(field, "==", file.name).limit(26).get()),
        hrDbAdmin.collection("hrSignatureRequests").where("signedStoragePath", "==", file.name).limit(26).get(),
      ]);
      if (references.some((page) => page.size > 25) || references[0].docs.some((doc) => doc.get("sourceOnboardingId") !== id || !["recruitment_onboarding", "autentique_signature"].includes(String(doc.get("source")))) || references.slice(1, 4).some((page) => page.docs.some((doc) => doc.get("onboardingId") !== id)) || await Promise.all(references[4].docs.map(async (doc) => doc.get("onboardingId") === id || segment(doc.get("generatedDocumentId")) && (await dbAdmin.collection("generatedDocuments").doc(doc.get("generatedDocumentId")).get()).get("onboardingId") === id)).then((allowed) => allowed.some((value) => !value))) { blockedObjects[objectKey] = { path: file.name, generation: String(file.metadata.generation) }; blocked++; continue; }
      const generation = String(file.metadata.generation);
      if (!/^[1-9]\d*$/.test(generation) || !Number.isSafeInteger(Number(generation))) {
        blockedObjects[objectKey] = { path: file.name, generation }; blocked++; continue;
      }
      // Pin each deletion to the enumerated object generation; a replacement is a separate retry.
      await bucket.file(file.name, { generation: file.metadata.generation }).delete({ ignoreNotFound: true });
      delete blockedObjects[objectKey];
      for (const upload of uploads.docs.slice(0, RECORD_LIMIT)) if (upload.get("path") === file.name) await upload.ref.set({ status: "purged" }, { merge: true });
      removed++;
    }
    if (next?.pageToken) break;
    progress.prefixCursor = prefix;
  }
  if (!storagePending) delete progress.prefixCursor;
  // In-flight writes retain a visible retry state, never a false "completed" result.
  for (const file of uploads.docs.slice(0, RECORD_LIMIT)) {
    if (file.get("status") === "uploading") {
      const age = Date.now() - (file.get("createdAt")?.toMillis?.() ?? Date.now());
      const current = await file.ref.get();
      if (current.get("status") !== "purged") {
        const path = file.get("path");
        // Expired claims are reconciled against their exact durable object reference.
        // Storage finalization independently requeues any late generation after this point.
        if (age >= 15 * 60_000 && typeof path === "string" && !(await bucket.file(path).exists())[0]) await file.ref.set({ status: "purged" }, { merge: true });
        else waitingForUploads = true;
      }
    }
  }
  const blockedPage = Object.entries(blockedObjects).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([key]) => typeof progress.blockedCursor !== "string" || key > progress.blockedCursor).slice(0, RECORD_LIMIT);
  await Promise.all(blockedPage.map(async ([key, value]) => {
    const reference = object(value);
    if (typeof reference.path === "string" && typeof reference.generation === "string" && !(await bucket.file(reference.path, { generation: reference.generation }).exists())[0]) delete blockedObjects[key];
  }));
  if (blockedPage.length === RECORD_LIMIT) progress.blockedCursor = blockedPage.at(-1)![0]; else delete progress.blockedCursor;
  blocked = Object.keys(blockedObjects).length;
  storagePending ||= blocked > 0 || waitingForUploads;
  const pending = moreRecords || storagePending;
  if (!storagePending) for (const [key, snapshot] of Object.entries(pages)) if (snapshot.size) progress[key] = snapshot.docs[Math.min(snapshot.size, RECORD_LIMIT) - 1].id;
  const result = { status: pending ? "pending" : "completed", removedFiles: Number(object(process.documentDiscard).removedFiles ?? 0) + removed, blockedFiles: blocked, waitingForUploads, storageRecoverySeconds, updatedAt: new Date().toISOString(), actorId, actorKeys };
  await hrDbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get("status") !== "cancelled" || current.get("completedAt") || current.get("documentDiscardLease.id") !== operationId) throw unavailable();
    if ((current.get("documentDiscardRevision") ?? 0) !== (process.documentDiscardRevision ?? 0)) result.status = "pending";
    tx.set(ref, { documentDiscard: result, documentDiscardProgress: result.status === "pending" ? ((current.get("documentDiscardRevision") ?? 0) === (process.documentDiscardRevision ?? 0) ? progress : FieldValue.delete()) : FieldValue.delete(), ...(result.status === "pending" ? {} : { publicToken: null, documents: [], asoWorkflow: null, accountantWorkflow: null, pjWorkflow: null }) }, { merge: true });
    tx.set(ref.collection("audit").doc(), { action: result.status === "pending" ? "ADMISSION_DOCUMENT_DISCARD_PENDING" : "ADMISSION_DOCUMENTS_DELETED", ...result });
  });
  if (result.status === "completed") await writeRecords({ storagePath: null, pdfStoragePath: null, signedStoragePath: null, generatedPdfStoragePath: null, signedFileUrl: null, fileUrl: null });
  return result;
  } finally {
    await hrDbAdmin.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get("documentDiscardLease.id") === operationId) tx.update(ref, { documentDiscardLease: FieldValue.delete() });
    });
  }
}
