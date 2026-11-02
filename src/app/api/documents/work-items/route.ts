import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { absenceFlowItem } from "@/features/documents/central/adapters/absence";
import { financialWorkItem } from "@/features/documents/central/adapters/financial";
import { generatedWorkItem } from "@/features/documents/central/adapters/generated";
import { admissionSignatureItem } from "@/features/documents/central/adapters/admission-signature";
import { canAccessUnit } from "@/lib/unit-access";
import { assertEmployeeUnitAccess } from "@/features/hr/lib/employee-document-access-server";
import { onboardingClassificationItems, onboardingFlowItem } from "@/features/documents/central/adapters/onboarding";
import { uploadBatchItem } from "@/features/documents/central/adapters/upload-batch";
import { documentUploadsPage } from "@/features/documents/central/uploads-page.server";
import type { CentralDocumentSource, CentralWorkItem, CentralWorkPage } from "@/features/documents/central/types";
import { emptyDimensions } from "@/features/documents/central/types";
import { canViewDocumentProcess, documentProcessPage, documentProcessWorkItem } from "@/features/documents/central/processes.server";
import { listAbsenceRequests } from "@/features/dp/absences/requests/workflow.server";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import { listFinancialInboxMessages } from "@/features/financial/inbox/repository.server";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const path = "/api/documents/work-items" as const;
const querySchema = z.object({
  tab: z.enum(["classify", "preparation", "flows", "signatures"]),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  source: z.enum(["generated", "onboarding", "employee_upload", "financial", "absence", "company", "vacation", "termination"]).optional(),
  stage: z.enum(["classify", "link", "pay", "bank"]).optional(),
  cursor: z.string().min(1).max(1500).regex(/^[^/]+$/).optional(),
}).strict().refine((value) => !value.cursor || Boolean(value.source), "Cursor exige origem.");
type Input = z.infer<typeof querySchema>;
type Resource = { workspaceId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: "documents.work-items.list",
  version: 1,
  surface: { method: "GET", path },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "source-permission-intersection" },
  resourceScope: { kind: "workspace" },
  input: { kind: "schema", schema: "documents.work-items.query", unknownFields: "reject" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

function canUseCentral(actor: ServerUserContext) {
  return actor.isDefaultAdmin
    || canViewDocumentProcess(actor, "vacation") || canViewDocumentProcess(actor, "termination")
    || hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)
    || hasFormalizationPermission(actor.permissions, "signatures.view", actor.isDefaultAdmin)
    || hasFormalizationPermission(actor.permissions, "view", actor.isDefaultAdmin)
    || hasFormalizationPermission(actor.permissions, "companyDocuments.view", actor.isDefaultAdmin)
    || (actor.permissions.financial?.view && actor.permissions.financial?.inbox?.view)
    || actor.permissions.dp?.requests?.view
    || actor.permissions.dp?.requests?.review;
}

const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: "documents-work-items-list-v1",
  guarantees: ["authenticated-user", "active-user", "permission-checked", "workspace-scoped", "input-validated", "fields-allowlisted", "authorization:source-permission-intersection"],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!canUseCentral(actor)) {
      throw new AppError({ code: "DOCUMENT_WORK_ITEMS_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para acessar fluxos documentais." });
    }
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      throw new AppError({ code: "DOCUMENT_WORK_ITEMS_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Filtro documental inválido." });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

function record(document: FirebaseFirestore.QueryDocumentSnapshot): Record<string, unknown> & { id: string } {
  return { id: document.id, ...((serializeHrValue(document.data()) as Record<string, unknown>) ?? {}) };
}

type SourceResult = {
  continuations?: Array<{ cursor: string; stage?: "classify" | "link" | "pay" | "bank" }>;
  nextCursor?: string;
  source: CentralDocumentSource;
  items: CentralWorkItem[];
  partial: boolean;
  message?: string;
};

async function generatedItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (!["preparation", "signatures"].includes(input.tab)
    || !hasFormalizationPermission(actor.permissions, input.tab === "signatures" ? "signatures.view" : "documents.view", actor.isDefaultAdmin)) return null;
  let query = dbAdmin.collection("generatedDocuments").orderBy("generatedAt", "desc");
  if (input.cursor) {
    const anchor = await dbAdmin.collection("generatedDocuments").doc(input.cursor).get();
    if (!anchor.exists) throw new Error("Cursor expirado; atualize a consulta.");
    query = query.startAfter(anchor);
  }
  const snapshot = await query
    .limit(input.limit + 1)
    .get();
  const rows = snapshot.docs.slice(0, input.limit)
    .map(record)
    .map((value) => generatedWorkItem(value, input.tab as "preparation" | "signatures"))
    .filter((value): value is CentralWorkItem => value !== null);
  return { source: "generated", items: rows, partial: snapshot.size > input.limit, nextCursor: snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : undefined };
}

async function companyItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (input.tab !== "classify" || !hasFormalizationPermission(actor.permissions, "companyDocuments.view", actor.isDefaultAdmin)) return null;
  let query = dbAdmin.collection("companyDocuments").orderBy("uploadedAt", "desc");
  if (input.cursor) {
    const anchor = await dbAdmin.collection("companyDocuments").doc(input.cursor).get();
    if (!anchor.exists) throw new Error("Cursor expirado.");
    query = query.startAfter(anchor);
  }
  const snapshot = await query.limit(input.limit + 1).get();
  const items = snapshot.docs.slice(0, input.limit).map(record).filter((value) => !value.deletedAt && (!value.workspaceId || value.workspaceId === actor.workspace_id) && (value.status === "pending_classification" || value.category === "A classificar"))
    .map((value): CentralWorkItem => ({ id: `company:classify:${value.id}`, source: "company", tab: "classify", documentRef: { source: "company", sourceId: value.id }, processRef: null,
      title: String(value.title ?? "Documento da empresa"), subject: typeof value.unit === "string" ? value.unit : null, status: "pending_classification", statusLabel: "Tipo documental pendente",
      detail: "Arquivo preservado com o nome original; classificação e nome definitivo aguardam confirmação.", updatedAt: typeof value.uploadedAt === "string" ? value.uploadedAt : null,
      href: `/dashboard/documents/company?document=${encodeURIComponent(value.id)}`, actionLabel: "Abrir no Acervo", missingFields: ["Tipo documental"],
      dimensions: { ...emptyDimensions(), classification: "pending", archiving: "pending" }, metadata: { originalName: typeof value.originalName === "string" ? value.originalName : null } }));
  return { source: "company", items, partial: snapshot.size > input.limit, nextCursor: snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : undefined };
}

async function onboardingItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (input.tab === "signatures") return admissionSignatureItems(actor, input);
  if (!["classify", "flows"].includes(input.tab)
    || !hasFormalizationPermission(actor.permissions, "view", actor.isDefaultAdmin)) return null;
  const activeStatuses = [
    "pending_setup", "collecting_documents", "reviewing_documents", "accountant_pending",
    "contract_pending", "ready_to_create_user", "awaiting_first_access", "active",
  ];
  let query = hrDbAdmin.collection("onboardingProcesses")
    .where("status", "in", activeStatuses)
    .orderBy("createdAt", "desc");
  if (input.cursor) {
    const anchor = await hrDbAdmin.collection("onboardingProcesses").doc(input.cursor).get();
    if (!anchor.exists) throw new Error("Cursor expirado.");
    query = query.startAfter(anchor);
  }
  const snapshot = await query
    .limit(input.limit + 1)
    .get();
  const processes = snapshot.docs.slice(0, input.limit).map(record);
  const items = input.tab === "flows"
    ? processes.map(onboardingFlowItem)
    : processes.flatMap(onboardingClassificationItems);
  return { source: "onboarding", items, partial: snapshot.size > input.limit, nextCursor: snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : undefined };
}

async function admissionSignatureItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (!hasFormalizationPermission(actor.permissions, "signatures.view", actor.isDefaultAdmin) || (!actor.isDefaultAdmin && actor.permissions.dp?.collaborators?.ownProfileOnly)) return null;
  let query = hrDbAdmin.collection("hrSignatureRequests").orderBy("__name__");
  if (input.cursor) query = query.startAfter(input.cursor);
  const snapshot = await query.limit(input.limit + 1).get();
  const processes = new Map<string, Promise<Record<string, unknown> | null>>();
  const items: CentralWorkItem[] = [];
  for (const document of snapshot.docs.slice(0, input.limit)) {
    const request = record(document);
    const id = typeof request.onboardingId === "string" ? request.onboardingId : "";
    if (!id || id.includes("/") || request.deletedAt || request.workspaceId && request.workspaceId !== actor.workspace_id) continue;
    if (!processes.has(id)) processes.set(id, (async () => {
      const process = await hrDbAdmin.collection("onboardingProcesses").doc(id).get();
      if (!process.exists || process.get("deletedAt") || process.get("workspaceId") && process.get("workspaceId") !== actor.workspace_id) return null;
      const employeeId = process.get("employeeId") ?? process.get("collaboratorUserId");
      if (typeof employeeId === "string" && employeeId) {
        if (!await assertEmployeeUnitAccess(actor, employeeId).then(() => true, () => false)) return null;
      } else if (!canAccessUnit(actor.userDoc, process.get("unitId"), { isDefaultAdmin: actor.isDefaultAdmin })) return null;
      return { ...serializeHrValue(process.data()) as Record<string, unknown>, id: process.id };
    })());
    const process = await processes.get(id);
    if (!process) continue;
    const item = admissionSignatureItem(request, process);
    if (item) items.push(item);
  }
  return { source: "onboarding", items, partial: snapshot.size > input.limit, nextCursor: snapshot.size > input.limit ? snapshot.docs[input.limit - 1].id : undefined };
}

async function uploadItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (input.tab !== "classify"
    || !hasFormalizationPermission(actor.permissions, "documents.view", actor.isDefaultAdmin)) return null;
  const page = await documentUploadsPage(actor, input.limit, input.cursor);
  const items = page.records.map((value) => {
    const destination = value.destination && typeof value.destination === "object" && !Array.isArray(value.destination)
      ? value.destination as Record<string, unknown> : {};
    return uploadBatchItem({
      ...value,
      destinationDisplayName: destination.displayName,
    });
  }).filter((value): value is CentralWorkItem => value !== null).slice(0, input.limit);
  return {
    source: "employee_upload",
    items,
    partial: Boolean(page.nextCursor),
    nextCursor: page.nextCursor,
    message: "A fila considera o acesso atual à pessoa, unidade e tipo documental. Gestores autorizados também podem retomar lotes da equipe.",
  };
}

async function financialItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (!["classify", "preparation"].includes(input.tab)
    || (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view))) return null;
  const stages = input.tab === "classify" ? ["classify" as const] : input.stage && input.stage !== "classify" ? [input.stage] : ["link" as const, "pay" as const, "bank" as const];
  const perStage = Math.max(1, Math.ceil(input.limit / stages.length));
  const results = await Promise.all(stages.map((stage) => listFinancialInboxMessages({
    workspaceId: actor.workspace_id, view: "work", status: null, stage,
    resolutionKind: null, financialState: null, search: null, cursor: input.cursor ?? null, limit: perStage,
  })));
  const items = results.flatMap((result) => result.messages)
    .map((message) => financialWorkItem(message as unknown as Record<string, unknown> & { id: string }))
    .filter((value): value is CentralWorkItem => value !== null)
    .filter((item) => item.tab === input.tab);
  return { source: "financial", items, partial: results.some((result) => Boolean(result.nextCursor)), continuations: results.flatMap((result, index) => result.nextCursor ? [{ cursor: result.nextCursor, stage: stages[index] }] : []) };
}

async function absenceItems(actor: ServerUserContext, input: Input): Promise<SourceResult | null> {
  if (input.tab !== "flows"
    || (!actor.isDefaultAdmin && actor.permissions.dp?.requests?.view !== true && actor.permissions.dp?.requests?.review !== true)) return null;
  const scope = actor.isDefaultAdmin || actor.permissions.dp?.requests?.review ? "review" : "team";
  const result = await listAbsenceRequests(actor, { scope, limit: input.limit, status: "in_review", cursor: input.cursor });
  return {
    source: "absence",
    items: result.requests.map((request) => absenceFlowItem(request as unknown as Record<string, unknown> & { id: string })),
    partial: Boolean(result.nextCursor),
    nextCursor: result.nextCursor ?? undefined,
  };
}

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, input } = security;
  const processReader = (source: "vacation" | "termination") => async (actor: ServerUserContext, input: Input): Promise<SourceResult | null> => {
    if (input.tab !== "flows") return null;
    const page = await documentProcessPage(actor, source, input.limit, input.cursor);
    if (!page) return null;
    return { source, items: page.records.map((record) => documentProcessWorkItem(record, source)).filter((item): item is CentralWorkItem => item !== null), partial: Boolean(page.nextCursor), nextCursor: page.nextCursor };
  };
  const sourceNames: CentralDocumentSource[] = ["generated", "onboarding", "employee_upload", "financial", "absence", "company", "vacation", "termination"];
  const readers = [generatedItems, onboardingItems, uploadItems, financialItems, absenceItems, companyItems, processReader("vacation"), processReader("termination")];
  const settled = await Promise.allSettled([
    ...readers.map((reader, index) => !input.source || input.source === sourceNames[index] ? reader(actor, input) : Promise.resolve(null)),
  ]);
  const warnings: string[] = [];
  const sources: CentralWorkPage["sources"] = [];
  const items: CentralWorkItem[] = [];
  const continuations: CentralWorkPage["continuations"] = [];
  settled.forEach((entry, index) => {
    const source = sourceNames[index];
    if (entry.status === "rejected") {
      warnings.push(`Não foi possível carregar ${source}. Tente atualizar esta origem.`);
      sources.push({ source, available: true, partial: true, message: "Falha temporária na origem." });
      return;
    }
    if (!entry.value) {
      sources.push({ source, available: false, partial: false });
      return;
    }
    items.push(...entry.value.items);
    if (entry.value.nextCursor) continuations.push({ source, cursor: entry.value.nextCursor });
    continuations.push(...(entry.value.continuations ?? []).map((page) => ({ source, ...page })));
    sources.push({ source, available: true, partial: entry.value.partial, message: entry.value.message });
    if (entry.value.partial) warnings.push(`${source}: há mais registros; use Carregar mais para continuar.`);
  });
  const ordered = items.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  const response: CentralWorkPage = {
    continuations,
    items: ordered,
    warnings: [...new Set(warnings)],
    sources,
    pageInfo: { hasMore: sources.some((source) => source.partial), limit: input.limit },
  };
  return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
});
