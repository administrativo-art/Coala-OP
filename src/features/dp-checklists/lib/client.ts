import type {
  DPChecklistExecution,
  DPChecklistExecutionItem,
  DPChecklistTemplate,
} from "@/types";
import { fetchWithTimeout } from "@/lib/fetch-utils";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type DPChecklistBootstrapPayload = {
  date: string;
  templates: DPChecklistTemplate[];
  executions: DPChecklistExecution[];
  access: {
    canView: boolean;
    canOperate: boolean;
    canManageTemplates: boolean;
  };
};

export type DPChecklistGeneratePayload = {
  date: string;
  matchedShifts: number;
  createdExecutions: number;
  skippedExecutions: number;
};

export type DPChecklistAnalyticsPayload = {
  filters: {
    dateFrom: string;
    dateTo: string;
    unitId: string | null;
    templateId: string | null;
    status: "all" | DPChecklistExecution["status"];
    timeZone: string;
  };
  summary: {
    totalExecutions: number;
    completedExecutions: number;
    claimedExecutions: number;
    pendingExecutions: number;
    overdueExecutions: number;
    completionRate: number;
    averageScore: number;
    averageRequiredScore: number;
    uniqueTemplates: number;
    uniqueUsers: number;
  };
  dailyTrend: Array<{
    date: string;
    totalExecutions: number;
    completedExecutions: number;
    overdueExecutions: number;
    averageScore: number;
  }>;
  byUnit: Array<{
    unitId: string;
    unitName: string;
    totalExecutions: number;
    completedExecutions: number;
    overdueExecutions: number;
    averageScore: number;
  }>;
  byTemplate: Array<{
    templateId: string;
    templateName: string;
    totalExecutions: number;
    completedExecutions: number;
    overdueExecutions: number;
    averageScore: number;
  }>;
  byUser: Array<{
    userId: string;
    username: string;
    totalExecutions: number;
    completedExecutions: number;
    overdueExecutions: number;
    averageScore: number;
  }>;
  overdueExecutions: Array<{
    id: string;
    checklistDate: string;
    templateId: string;
    templateName: string;
    unitId: string;
    unitName: string;
    assignedUserId: string;
    assignedUsername: string;
    claimedByUsername: string | null;
    status: DPChecklistExecution["status"];
    shiftStartTime: string;
    shiftEndTime: string;
    shiftEndDate: string;
    completionPercent: number;
    requiredCompletionPercent: number;
    overdueSinceLocal: string | null;
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

export async function fetchDPChecklistBootstrap(
  firebaseUser: FirebaseUserLike,
  params: { date: string }
) {
  const searchParams = new URLSearchParams({ date: params.date });

  return authorizedJsonRequest<DPChecklistBootstrapPayload>(
    `/api/dp/checklists/bootstrap?${searchParams.toString()}`,
    firebaseUser,
    { method: "GET" },
    "Falha ao carregar os checklists do dia."
  );
}

export async function createDPChecklistTemplate(
  firebaseUser: FirebaseUserLike,
  payload: Record<string, unknown>
) {
  return authorizedJsonRequest<{ template: DPChecklistTemplate }>(
    "/api/dp/checklists/templates",
    firebaseUser,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "Falha ao criar o template de checklist."
  );
}

export async function updateDPChecklistTemplate(
  firebaseUser: FirebaseUserLike,
  templateId: string,
  payload: Record<string, unknown>
) {
  return authorizedJsonRequest<{ template: DPChecklistTemplate }>(
    `/api/dp/checklists/templates/${templateId}`,
    firebaseUser,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    "Falha ao atualizar o template de checklist."
  );
}

export async function generateDPChecklistExecutions(
  firebaseUser: FirebaseUserLike,
  payload: { date: string }
) {
  return authorizedJsonRequest<DPChecklistGeneratePayload>(
    "/api/dp/checklists/daily/generate",
    firebaseUser,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    "Falha ao gerar os checklists do dia."
  );
}

export async function claimDPChecklistExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string
) {
  return authorizedJsonRequest<{ execution: DPChecklistExecution }>(
    `/api/dp/checklists/executions/${executionId}/claim`,
    firebaseUser,
    {
      method: "POST",
    },
    "Falha ao assumir o checklist."
  );
}

export async function updateDPChecklistExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string,
  payload: {
    action: "save" | "complete";
    items: Array<
      Pick<
        DPChecklistExecutionItem,
        | "templateItemId"
        | "sectionId"
        | "checked"
        | "textValue"
        | "numberValue"
        | "photoUrls"
        | "signatureUrl"
      >
    >;
  }
) {
  return authorizedJsonRequest<{ execution: DPChecklistExecution }>(
    `/api/dp/checklists/executions/${executionId}`,
    firebaseUser,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    payload.action === "complete"
      ? "Falha ao concluir o checklist."
      : "Falha ao salvar o checklist."
  );
}

export async function fetchDPChecklistAnalytics(
  firebaseUser: FirebaseUserLike,
  params: {
    dateFrom: string;
    dateTo: string;
    unitId?: string;
    templateId?: string;
    status?: "all" | DPChecklistExecution["status"];
    timeZone?: string;
  }
) {
  const searchParams = new URLSearchParams({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  if (params.unitId) searchParams.set("unitId", params.unitId);
  if (params.templateId) searchParams.set("templateId", params.templateId);
  if (params.status && params.status !== "all") {
    searchParams.set("status", params.status);
  }
  if (params.timeZone) searchParams.set("timeZone", params.timeZone);

  return authorizedJsonRequest<DPChecklistAnalyticsPayload>(
    `/api/dp/checklists/analytics?${searchParams.toString()}`,
    firebaseUser,
    { method: "GET" },
    "Falha ao carregar o painel gerencial dos checklists."
  );
}
