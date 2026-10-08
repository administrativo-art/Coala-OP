export const SECURITY_CONTRACT_SCHEMA_VERSION = 1 as const;

export const SECURITY_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type SecurityHttpMethod = (typeof SECURITY_HTTP_METHODS)[number];

export type SecurityGuarantee =
  | "authenticated-user"
  | "active-user"
  | "authenticated-source"
  | "authenticated-service"
  | "purpose-bound-token"
  | "permission-checked"
  | "owner-checked"
  | "workspace-scoped"
  | "unit-scoped"
  | "input-validated"
  | "fields-allowlisted"
  | "errors-sanitized"
  | "client-declared-audit"
  | "server-authoritative-audit"
  | "replay-protected"
  | `identity:${string}`
  | `authorization:${string}`
  | `scope:${string}`
  | `control:${string}`;

export type RouteSecurityContract = {
  schemaVersion: typeof SECURITY_CONTRACT_SCHEMA_VERSION;
  id: string;
  version: number;
  surface: {
    method: SecurityHttpMethod;
    path: `/api/${string}`;
  };
  exposure: "public" | "authenticated" | "internal-service";
  identity:
    | { kind: "none" }
    | { kind: "active-user" }
    | { kind: "signed-webhook"; provider: string }
    | { kind: "service-job"; service: string }
    | { kind: "public-token"; purpose: string }
    | { kind: "custom"; strategy: string; guarantees: readonly SecurityGuarantee[] };
  authorization:
    | { kind: "none" }
    | { kind: "permission"; action: string }
    | { kind: "owner" }
    | { kind: "custom"; strategy: string };
  resourceScope:
    | { kind: "none" }
    | { kind: "workspace" }
    | { kind: "unit" }
    | { kind: "owner" }
    | { kind: "custom"; strategy: string };
  input:
    | { kind: "none" }
    | { kind: "schema"; schema: string; unknownFields: "reject" | "strip" };
  effects: {
    mode: "read" | "write" | "delete" | "external";
    audit: "none" | "client-declared" | "server-authoritative";
  };
  errorExposure: "sanitized";
  additionalGuarantees?: readonly SecurityGuarantee[];
};

const CONTRACT_ID_PATTERN = /^[a-z][a-z0-9.-]{2,119}$/;
const STRATEGY_ID_PATTERN = /^[a-z][a-z0-9.-]{2,119}$/;

function requireIdentifier(value: string, label: string, pattern = STRATEGY_ID_PATTERN) {
  if (!pattern.test(value)) {
    throw new TypeError(`${label} deve ser um identificador estável em minúsculas.`);
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as unknown as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function validateContract(contract: RouteSecurityContract) {
  if (contract.schemaVersion !== SECURITY_CONTRACT_SCHEMA_VERSION) {
    throw new TypeError("Versão de schema do contrato de segurança incompatível.");
  }
  requireIdentifier(contract.id, "RouteSecurityContract.id", CONTRACT_ID_PATTERN);
  if (!Number.isInteger(contract.version) || contract.version < 1) {
    throw new TypeError("RouteSecurityContract.version deve ser inteiro positivo.");
  }
  if (!SECURITY_HTTP_METHODS.includes(contract.surface.method)) {
    throw new TypeError("Método HTTP inválido no contrato de segurança.");
  }
  if (!contract.surface.path.startsWith("/api/") || contract.surface.path.includes("?")) {
    throw new TypeError("O caminho do contrato deve ser canônico, começar com /api/ e não conter query string.");
  }

  const identityKindsByExposure: Record<
    RouteSecurityContract["exposure"],
    ReadonlySet<RouteSecurityContract["identity"]["kind"]>
  > = {
    public: new Set(["none", "public-token", "custom"]),
    authenticated: new Set(["active-user", "custom"]),
    "internal-service": new Set(["signed-webhook", "service-job", "custom"]),
  };
  if (!identityKindsByExposure[contract.exposure].has(contract.identity.kind)) {
    throw new TypeError(`Identidade ${contract.identity.kind} é incompatível com exposição ${contract.exposure}.`);
  }
  if (contract.authorization.kind === "owner" && contract.resourceScope.kind !== "owner") {
    throw new TypeError("Autorização por proprietário exige resourceScope owner.");
  }

  if (contract.identity.kind === "signed-webhook") requireIdentifier(contract.identity.provider, "identity.provider");
  if (contract.identity.kind === "service-job") requireIdentifier(contract.identity.service, "identity.service");
  if (contract.identity.kind === "public-token") requireIdentifier(contract.identity.purpose, "identity.purpose");
  if (contract.identity.kind === "custom") requireIdentifier(contract.identity.strategy, "identity.strategy");
  if (contract.authorization.kind === "permission") requireIdentifier(contract.authorization.action, "authorization.action");
  if (contract.authorization.kind === "custom") requireIdentifier(contract.authorization.strategy, "authorization.strategy");
  if (contract.resourceScope.kind === "custom") requireIdentifier(contract.resourceScope.strategy, "resourceScope.strategy");
  if (contract.input.kind === "schema") requireIdentifier(contract.input.schema, "input.schema");
}

export function defineSecurityContract<const T extends RouteSecurityContract>(contract: T): Readonly<T> {
  validateContract(contract);
  return deepFreeze(contract);
}

function baseEnforcerGuarantees(contract: RouteSecurityContract): Set<SecurityGuarantee> {
  const guarantees = new Set<SecurityGuarantee>();

  switch (contract.identity.kind) {
    case "active-user":
      guarantees.add("authenticated-user");
      guarantees.add("active-user");
      break;
    case "signed-webhook":
      guarantees.add("authenticated-source");
      break;
    case "service-job":
      guarantees.add("authenticated-service");
      break;
    case "public-token":
      guarantees.add("purpose-bound-token");
      break;
    case "custom":
      guarantees.add(`identity:${contract.identity.strategy}`);
      contract.identity.guarantees.forEach((guarantee) => guarantees.add(guarantee));
      break;
    case "none":
      break;
  }

  switch (contract.authorization.kind) {
    case "permission":
      guarantees.add("permission-checked");
      break;
    case "owner":
      guarantees.add("owner-checked");
      break;
    case "custom":
      guarantees.add(`authorization:${contract.authorization.strategy}`);
      break;
    case "none":
      break;
  }

  switch (contract.resourceScope.kind) {
    case "workspace":
      guarantees.add("workspace-scoped");
      break;
    case "unit":
      guarantees.add("unit-scoped");
      break;
    case "owner":
      guarantees.add("owner-checked");
      break;
    case "custom":
      guarantees.add(`scope:${contract.resourceScope.strategy}`);
      break;
    case "none":
      break;
  }

  if (contract.input.kind === "schema") {
    guarantees.add("input-validated");
    guarantees.add("fields-allowlisted");
  }
  return guarantees;
}

export function standardEnforcerGuarantees(contract: RouteSecurityContract): readonly SecurityGuarantee[] {
  return Object.freeze([...baseEnforcerGuarantees(contract)].sort());
}

export function requiredSecurityGuarantees(contract: RouteSecurityContract): readonly SecurityGuarantee[] {
  const guarantees = baseEnforcerGuarantees(contract);
  contract.additionalGuarantees?.forEach((guarantee) => guarantees.add(guarantee));

  return Object.freeze([...guarantees].sort());
}

export function declaredSecurityGuarantees(contract: RouteSecurityContract): readonly SecurityGuarantee[] {
  const guarantees = new Set(requiredSecurityGuarantees(contract));
  guarantees.add("errors-sanitized");
  if (contract.effects.audit === "client-declared") guarantees.add("client-declared-audit");
  if (contract.effects.audit === "server-authoritative") guarantees.add("server-authoritative-audit");

  return Object.freeze([...guarantees].sort());
}

function normalizePath(path: string) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function matchesSecurityContractPath(contractPath: `/api/${string}`, actualPath: string) {
  const expectedSegments = normalizePath(contractPath).split("/").filter(Boolean);
  const actualSegments = normalizePath(actualPath).split("/").filter(Boolean);

  for (let expectedIndex = 0, actualIndex = 0; expectedIndex < expectedSegments.length; expectedIndex += 1, actualIndex += 1) {
    const expected = expectedSegments[expectedIndex];
    if (!expected) return false;
    if (/^\[\[\.\.\.[^\]]+\]\]$/.test(expected)) return true;
    if (/^\[\.\.\.[^\]]+\]$/.test(expected)) return actualIndex < actualSegments.length;
    if (actualIndex >= actualSegments.length) return false;
    if (/^\[[^\]]+\]$/.test(expected)) continue;
    if (expected !== actualSegments[actualIndex]) return false;
  }

  return expectedSegments.length === actualSegments.length;
}
