import type { NextRequest } from "next/server";
import type { z } from "zod";

import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import type { RouteSecurityContract } from "@/lib/security/route-contract";

import {
  assertEditorAccess,
  defaultEditorApiDeps,
  toPublicEditorError,
  type EditorAction,
  type EditorActor,
  type EditorApiDeps,
} from "./editor-api.server";
import { EDITOR_REQUEST_MAX_BYTES, editorDocumentIdSchema } from "./editor-api-schemas";
import { getEditorDocument, type EditorDocumentRecord } from "./document-store.server";

// `id` é opcional no tipo porque a rota de criação não tem segmento dinâmico; nas demais
// rotas o `id` é validado por `editorDocumentIdSchema` e a ausência vira entrada inválida.
export type EditorRouteContext = { params: Promise<{ id?: string }> };
export type EditorResource = { workspaceId: string; document: EditorDocumentRecord | null };
export type EditorRouteInput<Body> = { documentId: string; body: Body };

const invalid = () => new AppError({ code: "EDITOR_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Dados do documento inválidos." });

export async function defaultAuthenticate(request: NextRequest): Promise<EditorActor> {
  const [{ requireUser }, { rethrowServerAuthenticationFailure }] = await Promise.all([
    import("@/lib/auth-server"),
    import("@/lib/server-authentication-failure"),
  ]);
  return requireUser(request).catch(rethrowServerAuthenticationFailure);
}

export async function readJsonBody(request: NextRequest): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > EDITOR_REQUEST_MAX_BYTES) {
    throw new AppError({ code: "EDITOR_REQUEST_TOO_LARGE", kind: "VALIDATION", httpStatus: 413, safeMessage: "Requisição grande demais." });
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > EDITOR_REQUEST_MAX_BYTES) {
    throw new AppError({ code: "EDITOR_REQUEST_TOO_LARGE", kind: "VALIDATION", httpStatus: 413, safeMessage: "Requisição grande demais." });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalid();
  }
}

/**
 * Enforcer comum das rotas do editor (pipeline padrão: autenticar, validar entrada, carregar o
 * recurso por workspace, autorizar, conferir escopo). O recurso só é lido quando o ator já tem
 * `documents.generate`; sem isso a autorização falha antes de qualquer leitura de documento.
 * Documento de outro workspace é "não encontrado" (o store o trata como inexistente).
 */
export function createEditorEnforcer<Schema extends z.ZodTypeAny | null>(
  contract: RouteSecurityContract,
  options: {
    action: EditorAction;
    bodySchema: Schema;
    /** Onde a entrada é lida (padrão corpo JSON); `query` rejeita parâmetro repetido. */
    source?: "body" | "query";
    getDeps?: () => Promise<EditorApiDeps>;
    authenticate?: (request: NextRequest) => Promise<EditorActor>;
  },
) {
  type Body = Schema extends z.ZodTypeAny ? z.infer<Schema> : undefined;
  const getDeps = options.getDeps ?? defaultEditorApiDeps;
  const authenticate = options.authenticate ?? defaultAuthenticate;
  return createStandardSecurityEnforcer<NextRequest, EditorRouteContext, unknown, EditorActor, EditorRouteInput<Body>, EditorResource>(contract, {
    authenticate: ({ request }) => authenticate(request),
    async parseInput({ request, routeContext }) {
      let documentId = "";
      if (options.action !== "create" && options.action !== "list") {
        const parsedId = editorDocumentIdSchema.safeParse((await routeContext.params).id);
        if (!parsedId.success) throw invalid();
        documentId = parsedId.data;
      }
      if (!options.bodySchema) return { documentId, body: undefined as Body };
      let raw: unknown;
      if (options.source === "query") {
        const query: Record<string, string> = {};
        const params = new URL(request.url).searchParams;
        for (const key of new Set(params.keys())) {
          const values = params.getAll(key);
          if (values.length !== 1) throw invalid();
          query[key] = values[0];
        }
        raw = query;
      } else {
        raw = await readJsonBody(request);
      }
      const parsed = options.bodySchema.safeParse(raw);
      if (!parsed.success) throw invalid();
      return { documentId, body: parsed.data as Body };
    },
    async loadResource({ actor, input }) {
      const workspaceId = actor.workspace_id;
      if (options.action === "create" || options.action === "list") return { workspaceId, document: null };
      try {
        // Pré-condição barata: sem generate não há leitura (a autorização seguinte nega).
        assertEditorAccess(actor, null, "create");
      } catch {
        return { workspaceId, document: null };
      }
      try {
        return { workspaceId, document: await getEditorDocument(input.documentId, workspaceId, (await getDeps()).store) };
      } catch (error) {
        throw toPublicEditorError(error);
      }
    },
    authorize: ({ actor, resource }) => assertEditorAccess(actor, resource.document, options.action),
    assertScope: ({ actor, resource }) => {
      if (resource.workspaceId !== actor.workspace_id || (resource.document && resource.document.workspaceId !== actor.workspace_id)) {
        throw new AppError({ code: "EDITOR_DOCUMENT_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
      }
    },
  });
}
