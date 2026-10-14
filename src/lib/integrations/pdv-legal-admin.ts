import "server-only";

import { dbAdmin } from '@/lib/firebase-admin';
import { syncDayAdmin as syncPdvDay } from '../../../functions/src/pdv-sync';
import {
  isPdvLegalUserRemovalConfirmed,
  movePdvLegalUserWithCloneFallback,
  PdvLegalUserMoveCleanupError,
} from '@/lib/integrations/pdv-legal-user-move';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[PDV Legal Admin] Variável de ambiente ${name} não configurada.`);
  return val;
}

// Lazy getters — evaluated at request time, never at module load / build time.
function getEnv() {
  return {
    COD_EMPRESA: requireEnv('PDVLEGAL_COD_EMPRESA'),
    API_TOKEN:   requireEnv('PDVLEGAL_TOKEN'),
    USERNAME:    requireEnv('PDVLEGAL_USERNAME'),
    PASSWORD:    requireEnv('PDVLEGAL_PASSWORD'),
  };
}

const BASE_URL = 'https://api.tabletcloud.com.br';

/**
 * Erro estruturado para falhas de comunicação/formato com a API do PDV Legal.
 * O `code` permite à UI distinguir "sem vendas" de "integração quebrada".
 */
export class PdvApiError extends Error {
  constructor(message: string, public code: string, public detail?: string) {
    super(message);
    this.name = 'PdvApiError';
  }
}

export type SyncDiagnostics = {
  couponsReceived: number;
  couponsCancelled: number;
  couponsWithoutItems: number;
  itemsSeen: number;
  itemsCancelled: number;
  itemsMapped: number;
  itemsUnmapped: number;
  itemsZeroValue: number;
  unmappedSkus: { sku: string; name: string; count: number }[];
};

export type PdvLegalFilial = {
  id: string;
  name: string;
  cnpj: string | null;
  active: boolean | null;
};

export type PdvLegalProfile = {
  id: string;
  name: string;
  usersCount: number | null;
};

export type PdvLegalUser = {
  id: string;
  name: string;
  filialId: string | null;
  profileId: string | null;
  active: boolean | null;
};

function responseRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  for (const key of ['data', 'usuarios', 'users', 'items', 'results']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

async function pdvGet(path: string): Promise<unknown> {
  const accessToken = await getAccessToken();
  return pdvGetWithAccessToken(path, accessToken);
}

async function pdvGetWithAccessToken(path: string, accessToken: string): Promise<unknown> {
  const { COD_EMPRESA, API_TOKEN } = getEnv();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      CodEmpresa: COD_EMPRESA,
      Token: API_TOKEN,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new PdvApiError(`Falha ao consultar o PDV Legal (HTTP ${response.status}).`, 'FETCH_FAILED', detail.slice(0, 300));
  }
  return response.json().catch(() => null);
}

export async function fetchPdvLegalCashMovementSources(accessToken: string, date: string) {
  const encodedDate = encodeURIComponent(date);
  const [withdrawals, supplies, paymentMethods] = await Promise.all([
    pdvGetWithAccessToken(`/sangriasuprimento/getSangria/${encodedDate}`, accessToken),
    pdvGetWithAccessToken(`/sangriasuprimento/getSuprimento/${encodedDate}`, accessToken),
    pdvGetWithAccessToken("/formapagamentopdv/get", accessToken),
  ]);
  return { withdrawals, supplies, paymentMethods };
}

/** Leitura leve para listas ao vivo: só as sangrias do dia, sem suprimentos. */
export async function fetchPdvLegalWithdrawals(accessToken: string, date: string) {
  return pdvGetWithAccessToken(`/sangriasuprimento/getSangria/${encodeURIComponent(date)}`, accessToken);
}

export async function fetchPdvLegalPaymentMethods(accessToken: string) {
  return pdvGetWithAccessToken("/formapagamentopdv/get", accessToken);
}

export async function fetchPdvLegalProfiles(): Promise<PdvLegalProfile[]> {
  const rows = responseRows(await pdvGet('/usuariopdv/perfil/get'));
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = String(row.codigo ?? '').trim();
    const name = typeof row.nome === 'string' ? row.nome.trim() : '';
    if (!id || !name) return [];
    return [{ id, name, usersCount: typeof row.numeroUsuarios === 'number' ? row.numeroUsuarios : null }];
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function fetchPdvLegalUsers(): Promise<PdvLegalUser[]> {
  const rows = responseRows(await pdvGet('/usuariopdv/get'));
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = String(row.codigo ?? row.id ?? '').trim();
    const name = typeof row.nome === 'string' ? row.nome.trim() : '';
    if (!id || !name) return [];
    const filial = row.codFilial ?? row.codfilial ?? row.codigoFilial;
    const profile = row.codperfil ?? row.codPerfil ?? row.codigoPerfil;
    return [{
      id,
      name,
      filialId: filial == null ? null : String(filial),
      profileId: profile == null ? null : String(profile),
      active: typeof row.ativo === 'boolean' ? row.ativo : null,
    }];
  });
}

function normalizePersonName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function findPdvLegalUser(params: { name: string; filialId?: string | null; id?: string | null }) {
  const users = await fetchPdvLegalUsers();
  if (params.id) return users.find(user => user.id === params.id) ?? null;
  const target = normalizePersonName(params.name);
  const matches = users.filter(user =>
    normalizePersonName(user.name) === target &&
    (!params.filialId || user.filialId === params.filialId)
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function createPdvLegalUser(params: {
  name: string;
  filialId: string;
  profileId: string;
  password: string;
}): Promise<PdvLegalUser> {
  const { COD_EMPRESA, API_TOKEN } = getEnv();
  const accessToken = await getAccessToken();
  const response = await fetch(`${BASE_URL}/usuariopdv/save`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      CodEmpresa: COD_EMPRESA,
      Token: API_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      codigo: 0,
      nome: params.name,
      codFilial: Number(params.filialId),
      codperfil: Number(params.profileId),
      senha: Number(params.password),
      isEntregador: false,
      ativo: true,
      byApi: true,
    }),
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PdvApiError(`Falha ao criar usuário no PDV Legal (HTTP ${response.status}).`, 'USER_CREATE_FAILED');
  }
  const row = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const id = String(row.codigo ?? row.id ?? '').trim();
  if (id) {
    return { id, name: params.name, filialId: params.filialId, profileId: params.profileId, active: true };
  }
  const found = await findPdvLegalUser({ name: params.name, filialId: params.filialId });
  if (!found) throw new PdvApiError('Usuário criado, mas o código não foi retornado pelo PDV Legal.', 'USER_ID_MISSING');
  return found;
}

async function clonePdvLegalUserAccessToFilialWithDisposition(params: {
  sourceUserId: string;
  filialId: string;
  profileId?: string | null;
}): Promise<{ user: PdvLegalUser; created: boolean }> {
  const cleanSourceId = params.sourceUserId.trim();
  if (!/^\d+$/.test(cleanSourceId) || !/^\d+$/.test(params.filialId)) {
    throw new PdvApiError('Usuário ou filial do PDV inválido.', 'USER_ACCESS_INVALID');
  }

  const raw = await pdvGet(`/usuariopdv/get/${encodeURIComponent(cleanSourceId)}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PdvApiError('Cadastro-base do PDV não localizado para criar o novo acesso.', 'USER_NOT_FOUND');
  }
  const current = raw as Record<string, unknown>;
  const name = typeof current.nome === 'string' ? current.nome.trim() : '';
  const password = current.senha;
  const currentProfileId = String(current.codperfil ?? current.codPerfil ?? current.codigoPerfil ?? '').trim();
  const targetProfileId = params.profileId?.trim() || currentProfileId;
  if (!name || (typeof password !== 'number' && typeof password !== 'string')) {
    throw new PdvApiError('O PDV não retornou os dados necessários para replicar o acesso.', 'USER_CLONE_DATA_MISSING');
  }
  if (!/^\d+$/.test(targetProfileId)) {
    throw new PdvApiError('O PDV não retornou o perfil necessário para replicar o acesso.', 'USER_PROFILE_MISSING');
  }

  const existing = await findPdvLegalUser({ name, filialId: params.filialId });
  if (existing) {
    if (existing.profileId === targetProfileId && existing.active !== false) {
      return { user: existing, created: false };
    }
    return { user: await updatePdvLegalUserAccess({
      userId: existing.id,
      filialId: params.filialId,
      profileId: targetProfileId,
    }), created: false };
  }

  return { user: await createPdvLegalUser({
    name,
    filialId: params.filialId,
    profileId: targetProfileId,
    password: String(password),
  }), created: true };
}

export async function clonePdvLegalUserAccessToFilial(params: {
  sourceUserId: string;
  filialId: string;
  profileId?: string | null;
}): Promise<PdvLegalUser> {
  const result = await clonePdvLegalUserAccessToFilialWithDisposition(params);
  return result.user;
}

export async function updatePdvLegalUserAccess(params: {
  userId: string;
  filialId: string;
  profileId?: string | null;
}): Promise<PdvLegalUser> {
  const cleanId = params.userId.trim();
  if (!/^\d+$/.test(cleanId)) throw new PdvApiError('Código de usuário do PDV inválido.', 'USER_ID_INVALID');
  const requestedProfileId = params.profileId?.trim() || null;
  if (!/^\d+$/.test(params.filialId) || (requestedProfileId !== null && !/^\d+$/.test(requestedProfileId))) {
    throw new PdvApiError('Filial ou perfil do PDV inválido.', 'USER_ACCESS_INVALID');
  }

  const raw = await pdvGet(`/usuariopdv/get/${encodeURIComponent(cleanId)}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PdvApiError('Cadastro do PDV não localizado para atualização.', 'USER_NOT_FOUND');
  }
  const current = raw as Record<string, unknown>;
  const name = typeof current.nome === 'string' ? current.nome.trim() : '';
  const password = current.senha;
  const currentProfileId = String(current.codperfil ?? current.codPerfil ?? current.codigoPerfil ?? '').trim();
  const targetProfileId = requestedProfileId ?? currentProfileId;
  if (!name || (typeof password !== 'number' && typeof password !== 'string')) {
    throw new PdvApiError('O PDV não retornou os dados necessários para preservar usuário e senha.', 'USER_UPDATE_DATA_MISSING');
  }
  if (!/^\d+$/.test(targetProfileId)) {
    throw new PdvApiError('O PDV não retornou o perfil atual necessário para preservar o acesso.', 'USER_PROFILE_MISSING');
  }

  const { COD_EMPRESA, API_TOKEN } = getEnv();
  const accessToken = await getAccessToken();
  const response = await fetch(`${BASE_URL}/usuariopdv/update`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      CodEmpresa: COD_EMPRESA,
      Token: API_TOKEN,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      codigo: Number(cleanId),
      nome: name,
      codFilial: Number(params.filialId),
      codperfil: Number(targetProfileId),
      senha: Number(password),
      isEntregador: current.isEntregador === true,
      codRefExterna: typeof current.codRefExterna === 'number' ? current.codRefExterna : 0,
      ativo: current.ativo !== false,
      segment: typeof current.segment === 'string' ? current.segment : '',
      byApi: true,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new PdvApiError(`Falha ao atualizar acesso no PDV Legal (HTTP ${response.status}).`, 'USER_UPDATE_FAILED', detail.slice(0, 300));
  }
  const updated = await findPdvLegalUser({ name, filialId: params.filialId, id: cleanId });
  if (!updated || updated.filialId !== params.filialId || updated.profileId !== targetProfileId) {
    throw new PdvApiError('O PDV Legal não confirmou a nova filial e o novo perfil.', 'USER_UPDATE_NOT_CONFIRMED');
  }
  return updated;
}

export async function deletePdvLegalUser(userId: string): Promise<void> {
  const cleanId = userId.trim();
  if (!/^\d+$/.test(cleanId)) throw new PdvApiError('Código de usuário do PDV inválido.', 'USER_ID_INVALID');
  const { COD_EMPRESA, API_TOKEN } = getEnv();
  const accessToken = await getAccessToken();
  const response = await fetch(`${BASE_URL}/usuariopdv/delete/${encodeURIComponent(cleanId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      CodEmpresa: COD_EMPRESA,
      Token: API_TOKEN,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '');
    throw new PdvApiError(`Falha ao remover acesso no PDV Legal (HTTP ${response.status}).`, 'USER_DELETE_FAILED', detail.slice(0, 300));
  }
  const remaining = await findPdvLegalUser({ name: '', id: cleanId });
  if (!isPdvLegalUserRemovalConfirmed(remaining)) {
    throw new PdvApiError('O PDV Legal ainda retorna o usuário após a solicitação de remoção.', 'USER_DELETE_NOT_CONFIRMED');
  }
}

export async function movePdvLegalUserAccessToFilial(params: {
  userId: string;
  filialId: string;
  profileId?: string | null;
}): Promise<PdvLegalUser> {
  try {
    const result = await movePdvLegalUserWithCloneFallback({
      sourceUserId: params.userId,
      update: () => updatePdvLegalUserAccess(params),
      clone: () => clonePdvLegalUserAccessToFilialWithDisposition({
        sourceUserId: params.userId,
        filialId: params.filialId,
        profileId: params.profileId,
      }),
      remove: deletePdvLegalUser,
      isUnconfirmedUpdate: (error) =>
        error instanceof PdvApiError && error.code === 'USER_UPDATE_NOT_CONFIRMED',
    });
    return result.user;
  } catch (error) {
    if (error instanceof PdvLegalUserMoveCleanupError) {
      throw new PdvApiError(
        error.message,
        error.compensationFailed ? 'USER_MOVE_COMPENSATION_FAILED' : 'USER_MOVE_CLEANUP_FAILED',
      );
    }
    throw error;
  }
}

function normalizePdvFilial(value: unknown): PdvLegalFilial | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const rawId = row.codigo ?? row.Codigo ?? row.id ?? row.Id;
  const rawName = row.nome ?? row.Nome ?? row.razaoSocial ?? row.RazaoSocial;
  if ((typeof rawId !== 'string' && typeof rawId !== 'number') || typeof rawName !== 'string') {
    return null;
  }
  const id = String(rawId).trim();
  const name = rawName.trim();
  if (!id || !name) return null;
  const rawCnpj = row.cnpj ?? row.Cnpj ?? row.cpfCnpj ?? row.CpfCnpj;
  const rawActive = row.ativo ?? row.Ativo;
  return {
    id,
    name,
    cnpj: typeof rawCnpj === 'string' && rawCnpj.trim() ? rawCnpj.trim() : null,
    active: typeof rawActive === 'boolean' ? rawActive : null,
  };
}

export async function fetchPdvLegalFiliais(): Promise<PdvLegalFilial[]> {
  const { COD_EMPRESA, API_TOKEN } = getEnv();
  const accessToken = await getAccessToken();
  const response = await fetch(`${BASE_URL}/filial/get`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      CodEmpresa: COD_EMPRESA,
      Token: API_TOKEN,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new PdvApiError(
      `Falha ao consultar filiais do PDV Legal (HTTP ${response.status}).`,
      'FILIAIS_FETCH_FAILED',
      detail.slice(0, 300),
    );
  }
  const raw: unknown = await response.json().catch(() => null);
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).data)
      ? (raw as { data: unknown[] }).data
      : [];
  return rows
    .map(normalizePdvFilial)
    .filter((filial): filial is PdvLegalFilial => filial !== null)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

/**
 * Detecta e valida o formato da resposta de cupons. Array direto, paginado
 * `{ data }` ou objeto vazio são aceitos; qualquer outro formato lança erro
 * estrutural em vez de virar silenciosamente uma lista vazia.
 */
function parseCouponsResponse(raw: unknown): { coupons: any[]; format: string } {
  if (Array.isArray(raw)) return { coupons: raw, format: 'array' };

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, any>;
    if ('data' in obj) {
      return { coupons: Array.isArray(obj.data) ? obj.data : [], format: 'paginated' };
    }
    const apiMsg = obj.Message || obj.message || obj.Error || obj.error;
    if (apiMsg) {
      throw new PdvApiError(`API do PDV Legal retornou erro: ${apiMsg}`, 'API_ERROR_PAYLOAD', JSON.stringify(obj).slice(0, 300));
    }
    if (Object.keys(obj).length === 0) return { coupons: [], format: 'empty-object' };
    throw new PdvApiError('Estrutura inesperada na resposta de cupons do PDV Legal.', 'UNEXPECTED_STRUCTURE', JSON.stringify(obj).slice(0, 300));
  }

  throw new PdvApiError('Resposta de cupons em formato não reconhecido.', 'UNEXPECTED_TYPE', String(raw).slice(0, 100));
}

export async function getAccessToken() {
  const { COD_EMPRESA, API_TOKEN, USERNAME, PASSWORD } = getEnv();

  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', USERNAME);
  params.append('password', PASSWORD);

  const authString = Buffer.from(`${COD_EMPRESA}:${API_TOKEN}`).toString('base64');

  const response = await fetch(`${BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${authString}`,
      'Token': API_TOKEN,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => '');
    throw new PdvApiError(`Falha na autenticação com o PDV Legal (HTTP ${response.status}).`, 'AUTH_FAILED', error.slice(0, 300));
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new PdvApiError('Resposta de autenticação do PDV Legal não é JSON válido.', 'AUTH_BAD_JSON');
  }
  if (!data?.access_token) {
    throw new PdvApiError('Token de acesso ausente na resposta do PDV Legal.', 'AUTH_NO_TOKEN');
  }
  return data.access_token as string;
}

/**
 * Busca cupons exaustivamente (Paginado) no servidor.
 */
export async function fetchAllCouponsForDay(accessToken: string, date: string, filialId: string) {
  const { COD_EMPRESA, API_TOKEN } = getEnv();
  console.log(`[PDV Legal] Iniciando coleta: ${date} (Filial: ${filialId})`);

  const url = `${BASE_URL}/cupom/get/${date}/${date}/${filialId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'CodEmpresa': COD_EMPRESA,
      'Token': API_TOKEN,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`[PDV Legal] Erro na API: ${response.status} - ${errorText}`);
    // Antes retornava [] silenciosamente → erro de API virava "0 cupons".
    throw new PdvApiError(`Falha ao buscar cupons da filial ${filialId} (HTTP ${response.status}).`, 'FETCH_FAILED', errorText.slice(0, 300));
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PdvApiError(`Resposta de cupons (${date}) não é JSON válido.`, 'COUPONS_BAD_JSON');
  }
  const { coupons, format } = parseCouponsResponse(raw);
  console.log(`[PDV Legal] ${date}: Recebidos ${coupons.length} cupons (formato: ${format}).`);
  return coupons;
}

/** All entrypoints use the transactional, reconciled import engine. */
export async function syncDayAdmin(dateStr: string, kioskId: string, pdvFilialId: string) {
  const result = await syncPdvDay(dateStr, kioskId, pdvFilialId, dbAdmin, { mode: 'manual' });
  return {
    ...result,
    unmapped: result.diagnostics.unmappedSkus.map(item => ({ sku: item.sku, name: item.name })),
  };
}
