import type { NextRequest } from "next/server";

import {
  withApiErrorHandling,
  type ApiObservationContext,
} from "../observability/api-error";
import { AppError } from "../observability/app-error";
import {
  assertEnforcerSatisfiesContract,
  type RouteSecurityEnforcer,
  type SecuredRouteContext,
} from "./enforcer";
import {
  matchesSecurityContractPath,
  type RouteSecurityContract,
} from "./route-contract";

type EmptyRouteContext = { params: Promise<Record<string, never>> };

export type SecureRouteHandlerInput<RouteContext, Actor, Input, Resource> = {
  request: NextRequest;
  routeContext: RouteContext;
  observation: ApiObservationContext;
  security: SecuredRouteContext<Actor, Input, Resource>;
};

export type SecureRouteOptions<RouteContext, Actor, Input, Resource> = {
  contract: RouteSecurityContract;
  enforcer: RouteSecurityEnforcer<
    NextRequest,
    RouteContext,
    ApiObservationContext,
    Actor,
    Input,
    Resource
  >;
  observability?: {
    source?: string;
    operation?: string;
  };
};

export function secureRoute<
  RouteContext = EmptyRouteContext,
  Actor = undefined,
  Input = undefined,
  Resource = undefined,
>(
  options: SecureRouteOptions<RouteContext, Actor, Input, Resource>,
  handler: (input: SecureRouteHandlerInput<RouteContext, Actor, Input, Resource>) => Response | Promise<Response>,
) {
  assertEnforcerSatisfiesContract(options.contract, options.enforcer);

  return withApiErrorHandling<RouteContext>({
    source: options.observability?.source ?? "api-security-contract",
    operation: options.observability?.operation ?? options.contract.id,
    routeOrJob: options.contract.surface.path,
  }, async (request, routeContext, observation) => {
    if (request.method !== options.contract.surface.method) {
      throw new AppError({
        code: "SECURITY_CONTRACT_METHOD_MISMATCH",
        kind: "VALIDATION",
        safeMessage: "Método não permitido para esta operação.",
        httpStatus: 405,
      });
    }
    if (!matchesSecurityContractPath(options.contract.surface.path, request.nextUrl.pathname)) {
      throw new AppError({
        code: "SECURITY_CONTRACT_PATH_MISMATCH",
        kind: "UNEXPECTED_APPLICATION",
        safeMessage: "A operação não pôde ser processada.",
        httpStatus: 500,
        metadata: {
          contractId: options.contract.id,
          declaredPath: options.contract.surface.path,
          actualPath: request.nextUrl.pathname,
        },
      });
    }
    const security = await options.enforcer.enforce({
      request,
      routeContext,
      observation,
      contract: options.contract,
    });
    return handler({ request, routeContext, observation, security });
  });
}
