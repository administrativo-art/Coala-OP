import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { CentralDocumentSource, CentralHistoryEntry, CentralHistoryPage } from "@/features/documents/central/types";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import { documentUploadsPage } from "@/features/documents/central/uploads-page.server";
import { uploadOutcome } from "@/features/documents/central/upload-outcome";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { TIME_RECORDING_COMPLIANCE_LABEL, TIME_RECORDING_EVIDENCE_SECTIONS } from "@/lib/documents/company-document-folders";
import { canViewDocumentProcess, documentProcessHistory, documentProcessPage } from "@/features/documents/central/processes.server";
import { uploadAccessFilter } from "@/features/documents/central/upload-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const path = "/api/documents/history" as const;
const querySchema = z.object({
  source: z.enum(["all", "generated", "company", "employee_upload", "onboarding", "financial", "vacation", "termination"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().min(1).max(1500).regex(/^[^/]+$/).optional(),
  documentId: z.string().min(1).max(256).regex(/^[^/]+$/).optional(),
}).strict().refine((value) => !value.cursor || value.source !== "all", "Cursor exige origem.")
  .refine((value) => !value.documentId || ["company", "employee_upload", "financial"].includes(value.source), "Origem sem trilha documental.");
type Input = z.infer<typeof querySchema>;
type Resource = { workspaceId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.history.list",
  version: 1,
  surface: { method: "GET", path },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "source-permission-intersection" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.history.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

function canUseHistory(actor: ServerUserContext) {
  return actor.isDefaultAdmin
    || canViewDocumentProcess(actor, "vacation") || canViewDocumentProcess(actor, "termination")
    || hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)
    || hasFormalizationPermission(actor.permissions, "companyDocuments.view", actor.isDefaultAdmin)
    || hasFormalizationPermission(actor.permissions, "view", actor.isDefaultAdmin);
}

const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: "documents-history-list-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "authorization:source-permission-intersection"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: "DOCUMENT_HISTORY_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Filtro de histórico inválido." });
    if (parsed.data.source === "financial" && !actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view)) throw new AppError({ code: "DOCUMENT_HISTORY_FINANCIAL_FORBIDDEN", kind: "AUTHORIZATION" });
    if (parsed.data.source !== "financial" && !canUseHistory(actor)) throw new AppError({ code: "DOCUMENT_HISTORY_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar o histórico documental." });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function serialized(document: FirebaseFirestore.QueryDocumentSnapshot): Record<string, unknown> & { id: string } {
  return { id: document.id, ...((serializeHrValue(document.data()) as Record<string, unknown>) ?? {}) };
}

type Result = { source: CentralDocumentSource; entries: CentralHistoryEntry[]; partial: boolean; nextCursor?: string; message?: string };

async function readPage(query: FirebaseFirestore.Query, input: Input, collection: string) {
  if (input.cursor) {
    const anchor = await query.firestore.collection(collection).doc(input.cursor).get();
    if (!anchor.exists) throw new Error("Cursor expirado.");
    query = query.startAfter(anchor);
  }
  return query.limit(input.limit + 1).get();
}

function continuation(snapshot: FirebaseFirestore.QuerySnapshot, input: Input) {
  return snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : undefined;
}

function requested(input: Input, source: Exclude<Input["source"], "all">) {
  return input.source === "all" || input.source === source;
}

async function generatedHistory(actor: ServerUserContext, input: Input): Promise<Result | null> {
  if (!requested(input, "generated") || !hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) return null;
  const snapshot = await readPage(dbAdmin.collection("generatedDocuments").orderBy("generatedAt", "desc"), input, "generatedDocuments");
  const entries = snapshot.docs.slice(0, input.limit).map(serialized).map((record): CentralHistoryEntry => ({
    id: `generated:${record.id}`,
    source: "generated",
    recordKind: "event",
    occurredAt: text(record.generatedAt),
    eventLabel: "Documento gerado",
    title: text(record.templateName) ?? "Documento gerado",
    subject: text(record.employeeName),
    originalName: text(record.originalName),
    appliedName: text(record.originalName),
    destination: text(record.onboardingId) ? "Fluxo de admissão" : "Geração avulsa",
    statusLabel: text(record.signatureStatus) ?? text(record.status),
    actorName: text(record.generatedByName),
    analysisMethod: "rule",
    href: `/dashboard/documents/generated/manage?document=${encodeURIComponent(record.id)}`,
    detail: text(record.protocol) ? `Protocolo ${text(record.protocol)}` : null,
  }));
  return { source: "generated", entries, partial: snapshot.size > input.limit, nextCursor: continuation(snapshot, input) };
}

async function companyHistory(actor: ServerUserContext, input: Input): Promise<Result | null> {
  if (!requested(input, "company") || !hasFormalizationPermission(actor.permissions, "companyDocuments.view", actor.isDefaultAdmin)) return null;
  if (input.documentId) {
    const ref = dbAdmin.collection("companyDocuments").doc(input.documentId);
    const document = await ref.get();
    if (!document.exists || document.get("deletedAt") || document.get("workspaceId") && document.get("workspaceId") !== actor.workspace_id) throw new AppError({ code: "COMPANY_HISTORY_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento indisponível." });
    const snapshot = await readPage(ref.collection("audit").orderBy("at", "desc"), input, `${ref.path}/audit`);
    const folderLabel = (folder: unknown, section: unknown) => folder === "time_recording_compliance"
      ? [TIME_RECORDING_COMPLIANCE_LABEL, TIME_RECORDING_EVIDENCE_SECTIONS.find((item) => item.code === section)?.label].filter(Boolean).join(" / ")
      : "Pasta da categoria";
    const entries = snapshot.docs.slice(0, input.limit).map(serialized)
      .filter((event) => ["DOCUMENT_FOLDER_CHANGED", "DOCUMENT_CLASSIFIED"].includes(String(event.action)))
      .map((event): CentralHistoryEntry => ({
        id: `company:${document.id}:audit:${event.id}`, source: "company", documentRef: { source: "company", sourceId: document.id },
        recordKind: "event", occurredAt: text(event.at), eventLabel: event.action === "DOCUMENT_CLASSIFIED" ? "Classificação confirmada" : "Documento movido", title: text(document.get("title")) ?? "Documento da empresa",
        subject: text(document.get("unit")), originalName: text(event.originalName), appliedName: text(event.appliedName),
        destination: event.action === "DOCUMENT_CLASSIFIED" ? [text(event.category), text(event.scopeId)].filter(Boolean).join(" / ") : folderLabel(event.folderCode, event.evidenceSection), statusLabel: null,
        actorName: text(event.actorName) ?? text(event.actorId), analysisMethod: event.analysisMethod === "rule" ? "rule" : null,
        href: `/dashboard/documents/company?document=${encodeURIComponent(document.id)}`,
        detail: event.action === "DOCUMENT_CLASSIFIED" ? `Nome anterior: ${text(event.previousName) ?? "Não registrado"}. Classificação confirmada pelo usuário.` : `Origem: ${folderLabel(event.previousFolderCode, event.previousEvidenceSection)}. Motivo: ${text(event.reason) ?? "Não registrado"}.`,
      }));
    return { source: "company", entries, partial: snapshot.size > input.limit, nextCursor: continuation(snapshot, input) };
  }
  const snapshot = await readPage(dbAdmin.collection("companyDocuments").orderBy("uploadedAt", "desc"), input, "companyDocuments");
  const entries = snapshot.docs.slice(0, input.limit).filter((document) => !document.get("deletedAt") && (!document.get("workspaceId") || document.get("workspaceId") === actor.workspace_id)).map(serialized).map((record): CentralHistoryEntry => ({
    id: `company:${record.id}`,
    documentRef: { source: "company", sourceId: record.id },
    source: "company",
    recordKind: "current_snapshot",
    occurredAt: text(record.uploadedAt),
    eventLabel: "Registro atual do acervo da empresa",
    title: text(record.title) ?? "Documento da empresa",
    subject: text(record.unit),
    originalName: text(record.originalName),
    appliedName: text(record.standardizedName),
    destination: [text(record.category), text(record.folderCode), text(record.evidenceSection)].filter(Boolean).join(" / ") || null,
    statusLabel: text(record.status),
    actorName: text(record.uploadedByName),
    analysisMethod: null,
    href: `/dashboard/documents/company?document=${encodeURIComponent(record.id)}`,
    detail: "O nome original e o nome aplicado foram preservados no registro atual.",
  }));
  return { source: "company", entries, partial: snapshot.size > input.limit, nextCursor: continuation(snapshot, input) };
}

async function employeeUploadHistory(actor: ServerUserContext, input: Input): Promise<Result | null> {
  if (!requested(input, "employee_upload") || !hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) return null;
  if (input.documentId) return documentAuditHistory(actor, input, "employee_upload");
  const page = await documentUploadsPage(actor, input.limit, input.cursor);
  const entries = page.records.map((record): CentralHistoryEntry => {
    const destination = object(record.destination);
    const provider = text(record.analysisProvider);
    const outcome = uploadOutcome(record);
    return {
      id: `employee_upload:${record.id}`,
      source: "employee_upload",
      documentRef: { source: "employee_upload", sourceId: record.id },
      recordKind: "current_snapshot",
      occurredAt: text(record.updatedAt) ?? text(record.createdAt),
      eventLabel: "Estado do upload",
      title: text(destination.displayName) ?? text(record.originalName) ?? "Documento do colaborador",
      subject: null,
      originalName: text(record.originalName),
      appliedName: outcome.appliedName,
      destination: outcome.destination,
      statusLabel: text(record.status),
      actorName: null,
      analysisMethod: provider === "openai" ? "ai" : provider === "local_fallback" ? "rule" : "unknown",
      href: text(record.employeeId) ? `/dashboard/documents/collaborators?employeeId=${encodeURIComponent(text(record.employeeId)!)}` : "/dashboard/documents/collaborators",
      detail: outcome.appliedName ? text(record.decisionReason) : `Proposta ainda não confirmada: ${outcome.proposal ?? "nome não definido"}.`,
    };
  });
  return {
    source: "employee_upload",
    entries,
    partial: Boolean(page.nextCursor),
    nextCursor: page.nextCursor,
    message: "Os uploads visíveis respeitam o acesso atual à pessoa, unidade e tipo documental, inclusive os lotes da equipe para gestores autorizados.",
  };
}

async function onboardingHistory(actor: ServerUserContext, input: Input): Promise<Result | null> {
  if (!requested(input, "onboarding") || !hasFormalizationPermission(actor.permissions, "view", actor.isDefaultAdmin)) return null;
  const snapshot = await readPage(hrDbAdmin.collection("onboardingProcesses").where("status", "in", ["completed", "cancelled"]).orderBy("createdAt", "desc"), input, "onboardingProcesses");
  const entries = snapshot.docs.slice(0, input.limit).map(serialized)
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, input.limit)
    .map((record): CentralHistoryEntry => ({
      id: `onboarding:${record.id}`,
      source: "onboarding",
      recordKind: "current_snapshot",
      occurredAt: text(record.updatedAt),
      eventLabel: text(record.status) === "completed" ? "Fluxo concluído" : "Fluxo cancelado",
      title: text(record.employmentRelationshipType) === "pj" ? "Contratação de prestador PJ" : "Admissão",
      subject: text(record.candidateName) ?? text(record.providerLegalName),
      originalName: null,
      appliedName: null,
      destination: "Fluxo de admissão",
      statusLabel: text(record.status),
      actorName: null,
      analysisMethod: null,
      href: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(record.id)}`,
      detail: "Registro atual do processo. Eventos que não foram gravados pela origem aparecem como não registrados no detalhe.",
    }));
  return { source: "onboarding", entries, partial: snapshot.size > input.limit, nextCursor: continuation(snapshot, input) };
}

async function documentAuditHistory(actor: ServerUserContext, input: Input, source: "employee_upload"): Promise<Result> {
  const collection = hrDbAdmin.collection("documentUploadItems");
  const ref = collection.doc(input.documentId!);
  const doc = await ref.get();
  const missing = () => new AppError({ code: "DOCUMENT_TIMELINE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento indisponível." });
  if (!doc.exists || doc.get("deletedAt") || doc.get("workspaceId") && doc.get("workspaceId") !== actor.workspace_id) throw missing();
  if (source === "employee_upload" && !await (await uploadAccessFilter(actor))(doc.data()!)) throw missing();
  const branches: Array<{ id: "item" | "filed"; ref: FirebaseFirestore.CollectionReference }> = [{ id: "item", ref: ref.collection("audit") }];
  const filedId = doc.get("filedDocumentId");
  if (source === "employee_upload" && typeof filedId === "string" && filedId && !filedId.includes("/")) {
    const filed = await hrDbAdmin.collection("employeeDocuments").doc(filedId).get();
    if (filed.exists && !filed.get("deletedAt") && await (await uploadAccessFilter(actor))(filed.data()!)) branches.push({ id: "filed", ref: filed.ref.collection("audit") });
  }
  const cursorSchema = z.object({ item: z.union([z.string().min(1).max(256).regex(/^[^/]+$/), z.literal(false), z.null()]), filed: z.union([z.string().min(1).max(256).regex(/^[^/]+$/), z.literal(false), z.null()]) }).strict();
  let position: z.infer<typeof cursorSchema> = { item: null, filed: null };
  if (input.cursor) position = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
  const next = { ...position };
  const events: Array<Record<string, unknown> & { id: string }> = [];
  for (const branch of branches) {
    if (position[branch.id] === false) continue;
    const pageInput = { ...input, limit: Math.max(1, Math.floor(input.limit / branches.length)), cursor: position[branch.id] || undefined };
    const snapshot = await readPage(branch.ref.orderBy("at", "desc"), pageInput, branch.ref.path);
    next[branch.id] = continuation(snapshot, pageInput) ?? false;
    events.push(...snapshot.docs.slice(0, pageInput.limit).map(serialized).map((event) => ({ ...event, id: `${branch.id}:${event.id}` })));
  }
  if (!branches.some((branch) => branch.id === "filed")) next.filed = false;
  const labels: Record<string, string> = { ITEM_ANALYZED: "Arquivo analisado", ITEM_CORRECTED: "Classificação corrigida", ITEM_EMPLOYEE_CHANGED: "Titular corrigido", ITEM_DISCARDED: "Arquivo descartado", ITEM_DUPLICATE_ACCEPTED: "Duplicata revisada", EXACT_DUPLICATE_BLOCKED: "Duplicata exata bloqueada", DOCUMENT_FILED: "Documento arquivado", DOCUMENT_AUTO_VALIDATED: "Documento validado", DOCUMENT_PUBLISHED: "Documento publicado", DOCUMENT_WITHDRAWN: "Publicação retirada", DOCUMENT_PUBLICATION_PENDING: "Publicação pendente", DOCUMENT_NAMING_CONFIRMED: "Nome confirmado", viewed: "Documento visualizado", downloaded: "Documento baixado" };
  const entries = events.filter((event) => Boolean(labels[String(event.action)])).map((event): CentralHistoryEntry => ({
    id: `${source}:${doc.id}:${event.id}`, source, documentRef: { source, sourceId: doc.id }, recordKind: "event", occurredAt: text(event.at), eventLabel: labels[String(event.action)],
    title: text(doc.get("originalName")) ?? text(doc.get("subject")) ?? "Documento", subject: null, originalName: text(event.originalName), appliedName: text(event.appliedName) ?? text(event.storedName),
    destination: text(event.destination) ?? (Array.isArray(event.destinationTrail) ? event.destinationTrail.map(String).join(" / ") : null), statusLabel: null, actorName: text(event.actorName) ?? text(event.actorId),
    analysisMethod: event.analysisMethod === "rule" || event.analysisMethod === "ocr" || event.analysisMethod === "ai" ? event.analysisMethod : event.analysisModel === "not-run" ? "rule" : text(event.analysisModel) ? "ai" : null,
    href: `/dashboard/documents/collaborators?employeeId=${encodeURIComponent(String(doc.get("employeeId") ?? ""))}`,
    detail: text(event.documentTypeCode) ? `Tipo registrado: ${text(event.documentTypeCode)}` : null,
  }));
  const partial = next.item !== false || next.filed !== false;
  return { source, entries, partial, nextCursor: partial ? Buffer.from(JSON.stringify(next)).toString("base64url") : undefined };
}

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  if (security.input.source === "financial") return NextResponse.json({ continuations: [], entries: [], warnings: ["O histórico da caixa financeira está disponível em Cobranças."], pageInfo: { hasMore: false, limit: security.input.limit } } satisfies CentralHistoryPage, { headers: { "Cache-Control": "private, no-store" } });
  const processHistory = async (source: "vacation" | "termination"): Promise<Result | null> => {
    if (!requested(security.input, source)) return null;
    const page = await documentProcessPage(security.actor, source, security.input.limit, security.input.cursor);
    if (!page) return null;
    return { source, entries: page.records.map((record) => documentProcessHistory(record, source)).filter((entry): entry is CentralHistoryEntry => entry !== null), partial: Boolean(page.nextCursor), nextCursor: page.nextCursor };
  };
  const settled = await Promise.allSettled([
    generatedHistory(security.actor, security.input),
    companyHistory(security.actor, security.input),
    employeeUploadHistory(security.actor, security.input),
    onboardingHistory(security.actor, security.input),
    processHistory("vacation"), processHistory("termination"),
  ]);
  const warnings: string[] = [];
  const entries: CentralHistoryEntry[] = [];
  let hasMore = false;
  const continuations: CentralHistoryPage["continuations"] = [];
  settled.forEach((result) => {
    if (result.status === "rejected") {
      warnings.push("Uma origem não respondeu. O histórico abaixo é parcial.");
      hasMore = true;
      return;
    }
    if (!result.value) return;
    entries.push(...result.value.entries);
    if (result.value.nextCursor) continuations.push({ source: result.value.source, cursor: result.value.nextCursor });
    hasMore ||= result.value.partial;
    if (result.value.partial) warnings.push(`${result.value.source}: há mais registros no módulo de origem.`);
    if (result.value.message) warnings.push(result.value.message);
  });
  const ordered = entries.sort((left, right) => String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? "")));
  const response: CentralHistoryPage = { continuations, entries: ordered, warnings: [...new Set(warnings)], pageInfo: { hasMore, limit: security.input.limit } };
  return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
});
