"use client";

import { type Task, type TaskOrigin, type TaskProject, type TaskStatusDoc } from "@/types";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

type TasksBootstrapResponse = {
  projects: TaskProject[];
  statuses: TaskStatusDoc[];
  tasks: Task[];
};

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : "Falha na operação de tarefas.";
    throw new Error(message || "Falha na operação de tarefas.");
  }

  return payload as T;
}

async function authedFetch(
  firebaseUser: FirebaseUserLike,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await firebaseUser.getIdToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function fetchTasksBootstrap(firebaseUser: FirebaseUserLike) {
  const response = await authedFetch(firebaseUser, "/api/tasks", {
    method: "GET",
  });
  return parseJson<TasksBootstrapResponse>(response);
}

export async function createTask(
  firebaseUser: FirebaseUserLike,
  input: {
    title: string;
    description?: string;
    assigneeType?: "user" | "profile";
    assigneeId?: string;
    requiresApproval?: boolean;
    approverType?: "user" | "profile";
    approverId?: string;
    dueDate?: string;
    projectId?: string;
    origin?: Extract<TaskOrigin, { kind: "manual" | "legacy" }>;
  }
) {
  const response = await authedFetch(firebaseUser, "/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<Task>(response);
}

export async function updateTask(
  firebaseUser: FirebaseUserLike,
  taskId: string,
  updates: Partial<Task>
) {
  const response = await authedFetch(firebaseUser, `/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  return parseJson<Task>(response);
}

export async function updateTaskStatus(
  firebaseUser: FirebaseUserLike,
  taskId: string,
  status: Task["status"],
  details?: string
) {
  const response = await authedFetch(firebaseUser, `/api/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, details }),
  });
  return parseJson<Task>(response);
}

export async function deleteTask(firebaseUser: FirebaseUserLike, taskId: string) {
  const response = await authedFetch(firebaseUser, `/api/tasks/${taskId}`, {
    method: "DELETE",
  });
  return parseJson<{ ok: true }>(response);
}

export async function fetchTaskProjects(firebaseUser: FirebaseUserLike) {
  const response = await authedFetch(firebaseUser, "/api/tasks/projects", {
    method: "GET",
  });
  return parseJson<{ projects: TaskProject[] }>(response);
}

export async function createTaskProject(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  const response = await authedFetch(firebaseUser, "/api/tasks/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ project: TaskProject }>(response);
}

export async function updateTaskProject(
  firebaseUser: FirebaseUserLike,
  projectId: string,
  body: Record<string, unknown>
) {
  const response = await authedFetch(firebaseUser, `/api/tasks/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ project: TaskProject }>(response);
}

export async function deleteTaskProject(firebaseUser: FirebaseUserLike, projectId: string) {
  const response = await authedFetch(firebaseUser, `/api/tasks/projects/${projectId}`, {
    method: "DELETE",
  });
  return parseJson<{ ok: true }>(response);
}

export async function fetchTaskStatuses(
  firebaseUser: FirebaseUserLike,
  projectIds: string[]
) {
  const search = new URLSearchParams();
  projectIds.forEach((projectId) => search.append("projectId", projectId));
  const suffix = search.size ? `?${search.toString()}` : "";
  const response = await authedFetch(firebaseUser, `/api/tasks/statuses${suffix}`, {
    method: "GET",
  });
  return parseJson<{ statuses: TaskStatusDoc[] }>(response);
}

export async function createTaskStatus(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  const response = await authedFetch(firebaseUser, "/api/tasks/statuses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ status: TaskStatusDoc }>(response);
}

export async function updateTaskStatusDoc(
  firebaseUser: FirebaseUserLike,
  statusId: string,
  body: Record<string, unknown>
) {
  const response = await authedFetch(firebaseUser, `/api/tasks/statuses/${statusId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ status: TaskStatusDoc }>(response);
}

export async function deleteTaskStatus(firebaseUser: FirebaseUserLike, statusId: string) {
  const response = await authedFetch(firebaseUser, `/api/tasks/statuses/${statusId}`, {
    method: "DELETE",
  });
  return parseJson<{ ok: true }>(response);
}

export async function syncPurchaseReceiptTask(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  const response = await authedFetch(firebaseUser, "/api/tasks/purchase-receipt-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<{ task?: Task; created?: boolean; skipped?: boolean }>(response);
}
