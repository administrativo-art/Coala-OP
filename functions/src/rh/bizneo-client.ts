/**
 * bizneoClient — wrapper para a API Bizneo HR.
 * Auth: token estático via BIZNEO_TOKEN env var.
 * Retry: exponential backoff (1s, 2s, 4s, 8s).
 * Paginação: offset por page + page_size.
 */

const BIZNEO_BASE_URL = 'https://coala.bizneohr.com/api/v1';
const RETRY_DELAYS = [1000, 2000, 4000, 8000];

function getToken(): string {
  const token = process.env.BIZNEO_TOKEN;
  if (!token) throw new Error('[bizneoClient] BIZNEO_TOKEN não configurado.');
  return token;
}

async function fetchWithRetry(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt >= RETRY_DELAYS.length) {
      throw new Error(`[bizneoClient] Request falhou após ${attempt + 1} tentativas: ${res.status} ${url}`);
    }
    const delay = RETRY_DELAYS[attempt];
    console.warn(`[bizneoClient] ${res.status} em ${url} — retry em ${delay}ms (tentativa ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, delay));
    return fetchWithRetry(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`[bizneoClient] HTTP ${res.status} em ${url}`);
  }

  return res;
}

// ─── Tipos de resposta da API Bizneo ────────────────────────────────────────

export type BizneoUser = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  birthday?: string | null;
  department?: string | null;
  work_contracts?: {
    start_at?: string | null;
    end_at?: string | null;
    active?: boolean;
  }[];
  [key: string]: unknown;
};

export type BizneoCustomField = {
  id: number | string;
  name: string;
  field_type: string;
  value?: unknown;
};

export type BizneoUserDetail = BizneoUser & {
  custom_fields?: BizneoCustomField[];
};

// ─── Métodos do cliente ──────────────────────────────────────────────────────

export async function listUsers(updatedSince?: string): Promise<BizneoUser[]> {
  const token = getToken();
  const all: BizneoUser[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      token,
      page_size: '100',
      page: String(page),
    });
    if (updatedSince) params.set('updated_since', updatedSince);

    const res = await fetchWithRetry(`${BIZNEO_BASE_URL}/users?${params}`);
    const data = await res.json() as { users?: BizneoUser[]; pagination?: { total_pages?: number } };

    const users = data.users ?? [];
    if (!Array.isArray(users) || users.length === 0) break;
    all.push(...users);

    const totalPages = data.pagination?.total_pages;
    if (!totalPages || page >= totalPages) break;
    page += 1;
  }

  return all;
}

export async function getUserDetail(bizneoId: number | string): Promise<BizneoUserDetail> {
  const token = getToken();
  const res = await fetchWithRetry(`${BIZNEO_BASE_URL}/users/${bizneoId}?token=${token}`);
  const data = await res.json() as { user?: BizneoUserDetail };
  return data.user ?? (data as BizneoUserDetail);
}

export async function getUserCustomFields(bizneoId: number | string): Promise<BizneoCustomField[]> {
  const token = getToken();
  try {
    const res = await fetchWithRetry(`${BIZNEO_BASE_URL}/users/${bizneoId}/custom_fields?token=${token}`);
    const data = await res.json() as { custom_fields?: BizneoCustomField[] };
    return data.custom_fields ?? [];
  } catch (err) {
    // Endpoint pode não estar disponível — retorna vazio (PENDING_DISCOVERY)
    console.warn(`[bizneoClient] custom_fields indisponível para ${bizneoId}:`, err);
    return [];
  }
}

export async function listCustomFieldDefinitions(): Promise<BizneoCustomField[]> {
  const token = getToken();
  try {
    const res = await fetchWithRetry(`${BIZNEO_BASE_URL}/custom_fields?token=${token}`);
    const data = await res.json() as { custom_fields?: BizneoCustomField[] };
    return data.custom_fields ?? [];
  } catch (err) {
    console.warn('[bizneoClient] Definições de custom_fields indisponíveis:', err);
    return [];
  }
}

export function resolveAdmissionDate(user: BizneoUser): string | null {
  const contracts = user.work_contracts ?? [];
  return (
    contracts.find((c) => !c.end_at && c.start_at)?.start_at ??
    contracts.find((c) => c.start_at)?.start_at ??
    null
  );
}

export function bizneoIdStr(user: BizneoUser): string {
  return String(user.id);
}
