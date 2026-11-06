import type { NextRequest } from "next/server";
import type { z } from "zod";

import { AppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import type { RouteSecurityContract } from "@/lib/security/route-contract";

import { editorTemplateIdSchema } from "./editor-api-schemas";
import { defaultAuthenticate, readJsonBody } from "./editor-route-security.server";
import type { EditorActor } from "./editor-api.server";
import { assertTemplateAccess, type TemplateAction } from "./template-api.server";


// `tid` só existe nas rotas com segmento dinâmico; a ausência/formato inválido vira entrada inválida.
export type TemplateRouteContext = { params: Promise<{ tid?: string }> };
export type TemplateResource = { workspaceId: string };
export type TemplateRouteInput<Input> = { templateId: string; body: Input };

const invalid = () => new AppError({ code: "EDITOR_TEMPLATE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Dados do modelo inválidos." });

/**
 * Enforcer comum das rotas de modelo: autenticar, validar entrada (corpo JSON ou query string), autorizar
 * por `assertTemplateAccess` e conferir o workspace. O recurso (modelo) é lido pelo serviço sempre filtrado
 * por `workspaceId` do ator; modelo de outro workspace é "não encontrado". Nenhuma leitura ocorre antes da
 * autorização.
 */
export function createTemplateEnforcer<Schema extends z.ZodTypeAny | null>(
  contract: RouteSecurityContract,
  options: {
    action: TemplateAction;
    schema: Schema;
    /** Onde a entrada é lida; `none` quando não há corpo nem query. */
    source?: "body" | "query";
    authenticate?: (request: NextRequest) => Promise<EditorActor>;
  },
) {
  type Input = Schema extends z.ZodTypeAny ? z.infer<Schema> : undefined;
  const authenticate = options.authenticate ?? defaultAuthenticate;
  const dynamic = options.action !== "list" && options.action !== "create";
  return createStandardSecurityEnforcer<NextRequest, TemplateRouteContext, unknown, EditorActor, TemplateRouteInput<Input>, TemplateResource>(contract, {
    authenticate: ({ request }) => authenticate(request),
    async parseInput({ request, routeContext }) {
      let templateId = "";
      if (dynamic) {
        const parsedId = editorTemplateIdSchema.safeParse((await routeContext.params).tid);
        if (!parsedId.success) throw invalid();
        templateId = parsedId.data;
      }
      if (!options.schema) return { templateId, body: undefined as Input };
      let raw: unknown;
      if (options.source === "query") {
        raw = {};
        const params = new URL(request.url).searchParams;
        for (const key of new Set(params.keys())) {
          const values = params.getAll(key);
          if (values.length !== 1) throw invalid();
          (raw as Record<string, string>)[key] = values[0];
        }
      } else {
        raw = await readJsonBody(request);
      }
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) throw invalid();
      return { templateId, body: parsed.data as Input };
    },
    loadResource: ({ actor }) => ({ workspaceId: actor.workspace_id }),
    authorize: ({ actor }) => assertTemplateAccess(actor, options.action),
    assertScope: ({ actor, resource }) => {
      if (resource.workspaceId !== actor.workspace_id) {
        throw new AppError({ code: "EDITOR_TEMPLATE_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
      }
    },
  });
}
