import "server-only";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { requireUser, requireAuthenticatedUser, type ServerUserContext } from "@/lib/auth-server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { AppError } from "@/lib/observability/app-error";
import { canViewContextArchive, isContextArchiveSource, type ContextArchiveSource } from "./context-archive-access";
import { requireTimeManager } from "@/features/dp/time-config/access.server";

export type ContextArchiveRoute = { params: Promise<{ source: string }> };
const id = z.string().min(1).max(256).regex(/^[^/\\\u0000]+$/);
const listSchema = z.object({ parent: id.optional(), mine: z.literal("true").optional(), limit: z.coerce.number().int().min(1).max(25).default(25), cursor: z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict();
const fileSchema = z.object({ id: z.string().min(1).max(1024).regex(/^[^/\\\u0000]+$/), parent: id.optional() }).strict();
type Input = { source: ContextArchiveSource; limit?: number; cursor?: string; id?: string; parent?: string; mine?: "true" };
export function contextArchiveSecurity(file: boolean) {
  const contract = defineSecurityContract({
    schemaVersion: 1, id: file ? "documents.archive.sources.file" : "documents.archive.sources.list", version: 1,
    surface: { method: "GET", path: file ? "/api/documents/archive/sources/[source]/file" : "/api/documents/archive/sources/[source]" }, exposure: "authenticated",
    identity: { kind: "active-user" }, authorization: { kind: "custom", strategy: "archive-source-permission" },
    resourceScope: { kind: "custom", strategy: "archive-source-record-scope" },
    input: { kind: "schema", schema: file ? "documents.archive.sources.file" : "documents.archive.sources.list", unknownFields: "reject" },
    effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
  });
  const enforcer = defineSecurityEnforcer<NextRequest, ContextArchiveRoute, unknown, ServerUserContext, Input, undefined>({
    id: file ? "archive-source-file-v1" : "archive-source-list-v1",
    guarantees: ["authenticated-user", "active-user", "authorization:archive-source-permission", "scope:archive-source-record-scope", "input-validated", "fields-allowlisted"],
    async enforce({ request, routeContext }) {
      const { source } = await routeContext.params;
      if (!isContextArchiveSource(source)) throw new AppError({ code: "ARCHIVE_SOURCE_INVALID", kind: "VALIDATION", safeMessage: "Pasta documental inválida." });
      // Official personal receipts always use the real authenticated owner, matching their existing service.
      const actor = await ((source === "receipts" || source === "pilotReceipts") ? requireAuthenticatedUser(request) : source === "afd" || source === "aej" ? requireTimeManager(request) : requireUser(request)).catch(rethrowServerAuthenticationFailure);
      if ((source === "afd" || source === "aej") && actor.viewAs) throw new AppError({ code: "ARCHIVE_FISCAL_VIEW_AS_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Use seu próprio perfil para acessar arquivos fiscais coletivos." });
      if (!canViewContextArchive(source, actor)) throw new AppError({ code: "ARCHIVE_SOURCE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para acessar esta pasta." });
      const parsed = (file ? fileSchema : listSchema).safeParse(Object.fromEntries(request.nextUrl.searchParams));
      if (!parsed.success || "mine" in parsed.data && parsed.data.mine && source !== "uniforms") throw new AppError({ code: "ARCHIVE_SOURCE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Consulta documental inválida." });
      if (!file && "parent" in parsed.data && parsed.data.parent && !["admissionUploads"].includes(source)) throw new AppError({ code: "ARCHIVE_SOURCE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Pasta de processo inválida." });
      return { actor, input: { source, ...parsed.data }, resource: undefined };
    },
  });
  return { contract, enforcer };
}
