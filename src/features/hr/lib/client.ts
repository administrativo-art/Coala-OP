import type { JobFunction, JobRole } from "@/types";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import type {
  LoginRestrictionEvaluation,
} from "@/features/hr/lib/login-access";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type HrBootstrapPayload = {
  roles: JobRole[];
  functions: JobFunction[];
  access: {
    canView: boolean;
    canManageCatalog: boolean;
  };
};

export type HrRoleProfileSyncPayload = {
  roleId: string;
  targetProfileId: string;
  targetProfileName: string | null;
  matchedActiveUsers: number;
  updatedUsers: Array<{
    id: string;
    username: string;
    previousProfileId?: string;
  }>;
  skippedUsers: Array<{
    id: string;
    username: string;
    reason: string;
  }>;
};

export type HrLoginAccessPayload = {
  user: {
    id: string;
    username: string;
    email: string | null;
    jobRoleId: string | null;
    jobRoleName: string | null;
    loginRestrictionEnabled: boolean;
    shiftDefinitionId: string | null;
  };
  role: {
    id: string;
    name: string;
    loginRestricted: boolean;
  } | null;
  evaluation: LoginRestrictionEvaluation;
};

export type HrLoginAccessJustificationPayload = HrLoginAccessPayload & {
  justification: {
    id: string;
    actorUserId: string;
    userId: string;
    usernameSnapshot: string;
    emailSnapshot: string | null;
    jobRoleId: string | null;
    jobRoleName: string | null;
    scheduleId: string;
    shiftId: string;
    shiftDate: string;
    shiftEndDate: string;
    shiftStartTime: string;
    shiftEndTime: string;
    unitId: string;
    blockedAt: string;
    submittedAt: string;
    justificationText: string;
    sequence: number;
    grantedMinutes: number;
    grantedUntil: string;
    reason: "after_shift_extension";
    timeZone: string;
    createdAt: string;
  };
};

export type HrLoginAccessAuditPayload = {
  filters: {
    dateFrom: string;
    dateTo: string;
    userId: string | null;
    unitId: string | null;
    shiftId: string | null;
    limit: number;
  };
  summary: {
    totalJustifications: number;
    totalExtensionMinutes: number;
    uniqueUsers: number;
    uniqueShifts: number;
    limitReachedShifts: number;
    truncated: boolean;
  };
  availableUnits: Array<{
    id: string;
    name: string;
    count: number;
  }>;
  groups: Array<{
    id: string;
    userId: string;
    username: string;
    email: string | null;
    jobRoleName: string | null;
    unitId: string;
    unitName: string;
    scheduleId: string;
    shiftId: string;
    shiftDate: string;
    shiftEndDate: string;
    shiftStartTime: string;
    shiftEndTime: string;
    extensionCount: number;
    totalGrantedMinutes: number;
    blockedAtFirst: string | null;
    lastGrantedUntil: string | null;
    limitReached: boolean;
    remainingExtensions: number;
    items: Array<{
      id: string;
      actorUserId: string | null;
      userId: string;
      usernameSnapshot: string;
      emailSnapshot: string | null;
      jobRoleId: string | null;
      jobRoleName: string | null;
      scheduleId: string;
      shiftId: string;
      shiftDate: string;
      shiftEndDate: string;
      shiftStartTime: string;
      shiftEndTime: string;
      unitId: string;
      blockedAt: string;
      submittedAt: string;
      justificationText: string;
      sequence: number;
      grantedMinutes: number;
      grantedUntil: string;
      timeZone: string;
    }>;
  }>;
};

async function parseError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

async function authorizedJsonRequest<T>(
  path: string,
  firebaseUser: FirebaseUserLike,
  init: RequestInit,
  fallbackError: string
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    path,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    },
    20000
  );

  if (!response.ok) {
    throw new Error(await parseError(response, fallbackError));
  }

  return (await response.json()) as T;
}

export async function fetchHrBootstrap(firebaseUser: FirebaseUserLike) {
  return authorizedJsonRequest<HrBootstrapPayload>(
    "/api/hr/bootstrap",
    firebaseUser,
    { method: "GET" },
    "Falha ao carregar os dados do RH."
  );
}

export async function createHrRole(
  firebaseUser: FirebaseUserLike,
  payload: Record<string, unknown>
) {
  return authorizedJsonRequest<{ role: JobRole }>(
    "/api/hr/roles",
    firebaseUser,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "Falha ao criar cargo."
  );
}

export async function updateHrRole(
  firebaseUser: FirebaseUserLike,
  roleId: string,
  payload: Record<string, unknown>
) {
  return authorizedJsonRequest<{ role: JobRole }>(
    `/api/hr/roles/${roleId}`,
    firebaseUser,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    "Falha ao atualizar cargo."
  );
}

export async function syncHrRoleProfile(
  firebaseUser: FirebaseUserLike,
  roleId: string
) {
  return authorizedJsonRequest<HrRoleProfileSyncPayload>(
    `/api/hr/roles/${roleId}/sync-profile`,
    firebaseUser,
    {
      method: "POST",
    },
    "Falha ao aplicar o perfil padrão do cargo."
  );
}

export async function fetchHrLoginAccess(
  firebaseUser: FirebaseUserLike,
  params: {
    userId?: string;
    at?: string;
    timeZone?: string;
  }
) {
  const searchParams = new URLSearchParams();

  if (params.userId) searchParams.set("userId", params.userId);
  if (params.at) searchParams.set("at", params.at);
  if (params.timeZone) searchParams.set("timeZone", params.timeZone);

  return authorizedJsonRequest<HrLoginAccessPayload>(
    `/api/hr/login-access?${searchParams.toString()}`,
    firebaseUser,
    { method: "GET" },
    "Falha ao avaliar acesso por escala."
  );
}

export async function submitHrLoginJustification(
  firebaseUser: FirebaseUserLike,
  payload: {
    userId?: string;
    justificationText: string;
  }
) {
  return authorizedJsonRequest<HrLoginAccessJustificationPayload>(
    "/api/hr/login-access",
    firebaseUser,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "Falha ao registrar justificativa de acesso."
  );
}

export async function fetchHrLoginAccessAudit(
  firebaseUser: FirebaseUserLike,
  params: {
    userId?: string;
    unitId?: string;
    shiftId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }
) {
  const searchParams = new URLSearchParams();

  if (params.userId) searchParams.set("userId", params.userId);
  if (params.unitId) searchParams.set("unitId", params.unitId);
  if (params.shiftId) searchParams.set("shiftId", params.shiftId);
  if (params.dateFrom) searchParams.set("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.set("dateTo", params.dateTo);
  if (params.limit) searchParams.set("limit", String(params.limit));

  return authorizedJsonRequest<HrLoginAccessAuditPayload>(
    `/api/hr/login-access/audit?${searchParams.toString()}`,
    firebaseUser,
    { method: "GET" },
    "Falha ao carregar a auditoria de acesso por escala."
  );
}

export async function createHrFunction(
  firebaseUser: FirebaseUserLike,
  payload: Record<string, unknown>
) {
  return authorizedJsonRequest<{ function: JobFunction }>(
    "/api/hr/functions",
    firebaseUser,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "Falha ao criar função."
  );
}

export async function updateHrFunction(
  firebaseUser: FirebaseUserLike,
  functionId: string,
  payload: Record<string, unknown>
) {
  return authorizedJsonRequest<{ function: JobFunction }>(
    `/api/hr/functions/${functionId}`,
    firebaseUser,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    "Falha ao atualizar função."
  );
}
