import type { IntegrationTemplateVersion } from "./schemas";

export type IntegrationTemplateMetadataClient = {
  id: string;
  name: string;
  description?: string;
  roleId: string;
  functionId: string | null;
  isDefault: boolean;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  hasDraft: boolean;
  updatedAt: string;
  publishedAt: string | null;
};

export type IntegrationTemplateDetailClient = {
  metadata: IntegrationTemplateMetadataClient;
  draft: IntegrationTemplateVersion | null;
  currentVersion: IntegrationTemplateVersion | null;
};

async function authorizedJson<T>(
  path: string,
  getToken: () => Promise<string>,
  init?: RequestInit,
): Promise<T> {
  const token = await getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}

export async function listIntegrationTemplatesClient(getToken: () => Promise<string>) {
  const payload = await authorizedJson<{ templates: IntegrationTemplateMetadataClient[] }>(
    "/api/hr/integration-templates",
    getToken,
  );
  return payload.templates;
}

export async function getIntegrationTemplateClient(templateId: string, getToken: () => Promise<string>) {
  const payload = await authorizedJson<{ template: IntegrationTemplateDetailClient }>(
    `/api/hr/integration-templates/${encodeURIComponent(templateId)}`,
    getToken,
  );
  return payload.template;
}

export async function createIntegrationTemplateClient(
  input: {
    name: string;
    description?: string;
    roleId: string;
    functionId?: string | null;
    isDefault?: boolean;
    cloneFromTemplateId?: string;
    cloneFromVersion?: number;
  },
  getToken: () => Promise<string>,
) {
  return authorizedJson<{ metadata: IntegrationTemplateMetadataClient; draft: IntegrationTemplateVersion }>(
    "/api/hr/integration-templates",
    getToken,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function updateIntegrationTemplateClient(
  templateId: string,
  input: Record<string, unknown>,
  getToken: () => Promise<string>,
) {
  const payload = await authorizedJson<{ template: IntegrationTemplateDetailClient }>(
    `/api/hr/integration-templates/${encodeURIComponent(templateId)}`,
    getToken,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return payload.template;
}

export async function publishIntegrationTemplateClient(templateId: string, getToken: () => Promise<string>) {
  const payload = await authorizedJson<{ version: IntegrationTemplateVersion }>(
    `/api/hr/integration-templates/${encodeURIComponent(templateId)}/publish`,
    getToken,
    { method: "POST" },
  );
  return payload.version;
}

export async function archiveIntegrationTemplateClient(templateId: string, getToken: () => Promise<string>) {
  await authorizedJson<{ ok: boolean }>(
    `/api/hr/integration-templates/${encodeURIComponent(templateId)}`,
    getToken,
    { method: "DELETE" },
  );
}

