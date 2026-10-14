import {
  requiredSecurityGuarantees,
  standardEnforcerGuarantees,
  type RouteSecurityContract,
  type SecurityGuarantee,
} from "./route-contract";

export type SecurityExecutionInput<Request, RouteContext, Observation> = {
  request: Request;
  routeContext: RouteContext;
  observation: Observation;
  contract: RouteSecurityContract;
};

export type SecuredRouteContext<Actor, Input, Resource> = {
  actor: Actor;
  input: Input;
  resource: Resource;
};

export type RouteSecurityEnforcer<Request, RouteContext, Observation, Actor, Input, Resource> = {
  id: string;
  guarantees: readonly SecurityGuarantee[];
  enforce(
    execution: SecurityExecutionInput<Request, RouteContext, Observation>,
  ): Promise<SecuredRouteContext<Actor, Input, Resource>>;
};

type MaybePromise<T> = T | Promise<T>;

export type StandardSecuritySteps<Request, RouteContext, Observation, Actor, Input, Resource> = {
  authenticate?: (
    execution: SecurityExecutionInput<Request, RouteContext, Observation>,
  ) => MaybePromise<Actor>;
  parseInput?: (
    execution: SecurityExecutionInput<Request, RouteContext, Observation> & { actor: Actor },
  ) => MaybePromise<Input>;
  loadResource?: (
    execution: SecurityExecutionInput<Request, RouteContext, Observation> & { actor: Actor; input: Input },
  ) => MaybePromise<Resource>;
  authorize?: (
    execution: SecurityExecutionInput<Request, RouteContext, Observation> & SecuredRouteContext<Actor, Input, Resource>,
  ) => MaybePromise<void>;
  assertScope?: (
    execution: SecurityExecutionInput<Request, RouteContext, Observation> & SecuredRouteContext<Actor, Input, Resource>,
  ) => MaybePromise<void>;
};

function requireStep(value: unknown, name: string, contract: RouteSecurityContract) {
  if (typeof value !== "function") {
    throw new TypeError(`Contrato ${contract.id} exige a etapa ${name}.`);
  }
}

export function defineSecurityEnforcer<Request, RouteContext, Observation, Actor, Input, Resource>(
  enforcer: RouteSecurityEnforcer<Request, RouteContext, Observation, Actor, Input, Resource>,
) {
  if (!enforcer.id.trim()) throw new TypeError("Enforcer de segurança precisa de id.");
  if (new Set(enforcer.guarantees).size !== enforcer.guarantees.length) {
    throw new TypeError(`Enforcer ${enforcer.id} contém garantias duplicadas.`);
  }
  return Object.freeze({ ...enforcer, guarantees: Object.freeze([...enforcer.guarantees]) });
}

export function missingSecurityGuarantees(
  contract: RouteSecurityContract,
  enforcer: { guarantees: readonly SecurityGuarantee[] },
) {
  const implemented = new Set(enforcer.guarantees);
  return requiredSecurityGuarantees(contract).filter((guarantee) => !implemented.has(guarantee));
}

export function assertEnforcerSatisfiesContract(
  contract: RouteSecurityContract,
  enforcer: { id: string; guarantees: readonly SecurityGuarantee[] },
) {
  const missing = missingSecurityGuarantees(contract, enforcer);
  if (missing.length > 0) {
    throw new TypeError(`Enforcer ${enforcer.id} não satisfaz ${contract.id}: ${missing.join(", ")}.`);
  }
}

export function createStandardSecurityEnforcer<Request, RouteContext, Observation, Actor = undefined, Input = undefined, Resource = undefined>(
  contract: RouteSecurityContract,
  steps: StandardSecuritySteps<Request, RouteContext, Observation, Actor, Input, Resource>,
) {
  if (contract.identity.kind !== "none") requireStep(steps.authenticate, "authenticate", contract);
  if (contract.input.kind === "schema") requireStep(steps.parseInput, "parseInput", contract);
  if (contract.resourceScope.kind !== "none") {
    requireStep(steps.loadResource, "loadResource", contract);
    requireStep(steps.assertScope, "assertScope", contract);
  }
  if (contract.authorization.kind !== "none") requireStep(steps.authorize, "authorize", contract);

  return defineSecurityEnforcer<Request, RouteContext, Observation, Actor, Input, Resource>({
    id: `standard:${contract.id}:v${contract.version}`,
    guarantees: standardEnforcerGuarantees(contract),
    async enforce(execution) {
      const actor = steps.authenticate
        ? await steps.authenticate(execution)
        : undefined as Actor;
      const input = steps.parseInput
        ? await steps.parseInput({ ...execution, actor })
        : undefined as Input;
      const resource = steps.loadResource
        ? await steps.loadResource({ ...execution, actor, input })
        : undefined as Resource;
      const secured = { actor, input, resource };
      if (steps.authorize) await steps.authorize({ ...execution, ...secured });
      if (steps.assertScope) await steps.assertScope({ ...execution, ...secured });
      return secured;
    },
  });
}
