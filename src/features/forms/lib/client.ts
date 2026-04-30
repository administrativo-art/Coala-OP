import type {
  FormExecution,
  FormExecutionEvent,
  FormProject,
  FormSubtype,
  FormTemplate,
  FormType,
} from "@/types/forms";
import { fetchWithTimeout } from "@/lib/fetch-utils";

type FirebaseUserLike = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type FormsBootstrapPayload = {
  access: {
    can_view: boolean;
    can_create_projects: boolean;
    can_manage_templates: boolean;
    can_view_analytics: boolean;
  };
  projects: FormProject[];
  templates: FormTemplate[];
  executions: FormExecution[];
};

async function parseError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

async function authorizedGet<T>(
  path: string,
  firebaseUser: FirebaseUserLike,
  fallbackError: string
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    path,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
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

export async function fetchFormsBootstrap(firebaseUser: FirebaseUserLike) {
  return authorizedGet<FormsBootstrapPayload>(
    "/api/forms/bootstrap",
    firebaseUser,
    "Falha ao carregar o bootstrap de formulários."
  );
}

export async function fetchFormTemplate(
  firebaseUser: FirebaseUserLike,
  templateId: string
) {
  return authorizedGet<FormTemplate>(
    `/api/forms/templates/${templateId}`,
    firebaseUser,
    "Falha ao carregar o template."
  );
}

export async function fetchFormExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string
) {
  return authorizedGet<{
    execution: FormExecution;
    events: FormExecutionEvent[];
  }>(
    `/api/forms/executions/${executionId}`,
    firebaseUser,
    "Falha ao carregar a execução."
  );
}

async function authorizedJsonRequest<T>(
  path: string,
  firebaseUser: FirebaseUserLike,
  method: "POST" | "PATCH",
  body: unknown,
  fallbackError: string
) {
  const token = await firebaseUser.getIdToken();
  const response = await fetchWithTimeout(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    20000
  );

  if (!response.ok) {
    throw new Error(await parseError(response, fallbackError));
  }

  return (await response.json()) as T;
}

export async function claimFormExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string
) {
  return authorizedJsonRequest<{ execution: FormExecution }>(
    `/api/forms/executions/${executionId}/claim`,
    firebaseUser,
    "POST",
    {},
    "Falha ao assumir a execução."
  );
}

export async function updateFormExecution(
  firebaseUser: FirebaseUserLike,
  executionId: string,
  body: {
    action: "save" | "complete" | "reopen" | "cancel";
    items?: Array<Record<string, unknown>>;
  }
) {
  return authorizedJsonRequest<{ execution: FormExecution }>(
    `/api/forms/executions/${executionId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar a execução."
  );
}

export async function createFormProject(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ project: FormProject }>(
    "/api/forms/projects",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar o projeto."
  );
}

export async function updateFormProject(
  firebaseUser: FirebaseUserLike,
  projectId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ project: FormProject }>(
    `/api/forms/projects/${projectId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar o projeto."
  );
}

export async function createFormTemplate(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ template: FormTemplate }>(
    "/api/forms/templates",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar o template."
  );
}

export async function fetchFormTypes(
  firebaseUser: FirebaseUserLike,
  search?: { formProjectId?: string; active?: boolean }
) {
  const query = new URLSearchParams();
  if (search?.formProjectId) query.set("formProjectId", search.formProjectId);
  if (typeof search?.active === "boolean") query.set("active", String(search.active));
  const suffix = query.size ? `?${query.toString()}` : "";
  return authorizedGet<{ types: FormType[] }>(
    `/api/forms/types${suffix}`,
    firebaseUser,
    "Falha ao carregar tipos de formulário."
  );
}

export async function createFormType(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ type: FormType }>(
    "/api/forms/types",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar tipo."
  );
}

export async function updateFormType(
  firebaseUser: FirebaseUserLike,
  typeId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ type: FormType }>(
    `/api/forms/types/${typeId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar tipo."
  );
}

export async function fetchFormSubtypes(
  firebaseUser: FirebaseUserLike,
  search?: { formProjectId?: string; formTypeId?: string; active?: boolean }
) {
  const query = new URLSearchParams();
  if (search?.formProjectId) query.set("formProjectId", search.formProjectId);
  if (search?.formTypeId) query.set("formTypeId", search.formTypeId);
  if (typeof search?.active === "boolean") query.set("active", String(search.active));
  const suffix = query.size ? `?${query.toString()}` : "";
  return authorizedGet<{ subtypes: FormSubtype[] }>(
    `/api/forms/subtypes${suffix}`,
    firebaseUser,
    "Falha ao carregar subtipos de formulário."
  );
}

export async function createFormSubtype(
  firebaseUser: FirebaseUserLike,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ subtype: FormSubtype }>(
    "/api/forms/subtypes",
    firebaseUser,
    "POST",
    body,
    "Falha ao criar subtipo."
  );
}

export async function updateFormSubtype(
  firebaseUser: FirebaseUserLike,
  subtypeId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ subtype: FormSubtype }>(
    `/api/forms/subtypes/${subtypeId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar subtipo."
  );
}

export async function updateFormTemplate(
  firebaseUser: FirebaseUserLike,
  templateId: string,
  body: Record<string, unknown>
) {
  return authorizedJsonRequest<{ template: FormTemplate }>(
    `/api/forms/templates/${templateId}`,
    firebaseUser,
    "PATCH",
    body,
    "Falha ao atualizar o template."
  );
}

export async function uploadFormAsset(
  firebaseUser: FirebaseUserLike,
  params: {
    file: File;
    kind: "photo" | "signature" | "file";
  }
) {
  const token = await firebaseUser.getIdToken();
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("kind", params.kind);

  const response = await fetchWithTimeout(
    "/api/forms/upload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
      cache: "no-store",
    },
    30000
  );

  if (!response.ok) {
    throw new Error(await parseError(response, "Falha ao enviar arquivo."));
  }

  return (await response.json()) as {
    kind: "photo" | "signature" | "file";
    assetPath: string;
    assetUrl: string;
    fileName: string;
    mime: string;
  };
}

export async function deleteFormAsset(
  firebaseUser: FirebaseUserLike,
  assetPath: string
) {
  return authorizedJsonRequest<{ ok: true }>(
    "/api/forms/upload",
    firebaseUser,
    "PATCH",
    { action: "delete", assetPath },
    "Falha ao remover arquivo."
  );
}
