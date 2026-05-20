import { dbAdmin } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const BASE_URL = 'https://coala.bizneohr.com/api/v1';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`[Bizneo] Variável de ambiente ${name} não configurada.`);
  return val;
}

function getToken() {
  return requireEnv('BIZNEO_TOKEN');
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type BizneoUser = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  external_id: string | null;
  avatar_url?: string | null;
  birthday?: string | null;
  work_contracts?: Array<{
    id: number;
    start_at: string | null;
    end_at: string | null;
    fte?: number | null;
  }>;
};

function parseBizneoDate(value?: string | null): Timestamp | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
}

function resolveAdmissionDate(user: BizneoUser): string | null {
  const contracts = user.work_contracts ?? [];
  const activeContract = contracts.find((contract) => !contract.end_at && contract.start_at);
  if (activeContract?.start_at) return activeContract.start_at;
  return contracts.find((contract) => contract.start_at)?.start_at ?? null;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function fetchBizneoUsers(): Promise<BizneoUser[]> {
  const token = getToken();
  const all: BizneoUser[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${BASE_URL}/users?token=${token}&page_size=100&page=${page}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Bizneo users fetch falhou: ${res.status}`);
    const data = await res.json();
    const users: BizneoUser[] = data.users ?? data;
    if (!Array.isArray(users) || users.length === 0) break;
    all.push(...users);
    const pagination = data.pagination;
    if (!pagination || page >= pagination.total_pages) break;
    page++;
  }

  return Promise.all(
    all.map(async (user) => {
      try {
        const res = await fetch(`${BASE_URL}/users/${user.id}?token=${token}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return user;
        const data = await res.json();
        return { ...user, ...(data.user ?? data) } as BizneoUser;
      } catch {
        return user;
      }
    })
  );
}

// ─── Sync user IDs by email ───────────────────────────────────────────────────

export type SyncUsersResult = {
  matched: number;
  unmatched: { coala: string; email: string }[];
  bizneoOnly: { bizneoId: number; name: string; email: string }[];
};

export async function syncBizneoUserIds(): Promise<SyncUsersResult> {
  const [bizneoUsers, coalaSnap] = await Promise.all([
    fetchBizneoUsers(),
    dbAdmin.collection('users').get(),
  ]);

  // Index Bizneo users by email (lowercase)
  const bizneoByEmail = new Map<string, BizneoUser>(
    bizneoUsers.map(u => [u.email.toLowerCase(), u])
  );

  const batch = dbAdmin.batch();
  let matched = 0;
  const unmatched: SyncUsersResult['unmatched'] = [];
  const matchedEmails = new Set<string>();

  for (const doc of coalaSnap.docs) {
    const data = doc.data();
    const email = (data.email ?? '').toLowerCase();
    const bizneoUser = bizneoByEmail.get(email);

    if (bizneoUser) {
      const admissionDate = parseBizneoDate(resolveAdmissionDate(bizneoUser));
      const birthDate = parseBizneoDate(bizneoUser.birthday);
      batch.update(doc.ref, {
        registrationIdBizneo: String(bizneoUser.id),
        ...(bizneoUser.avatar_url ? { avatarUrl: bizneoUser.avatar_url } : {}),
        ...(admissionDate ? { admissionDate } : {}),
        ...(birthDate ? { birthDate } : {}),
      });
      matched++;
      matchedEmails.add(email);
    } else if (data.isActive !== false) {
      // Only report active users as unmatched
      unmatched.push({ coala: data.username ?? doc.id, email: data.email ?? '' });
    }
  }

  await batch.commit();

  const bizneoOnly = bizneoUsers
    .filter(u => !matchedEmails.has(u.email.toLowerCase()))
    .map(u => ({
      bizneoId: u.id,
      name: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
    }));

  return { matched, unmatched, bizneoOnly };
}

// ─── Push schedule shifts to Bizneo ──────────────────────────────────────────

export type PushShiftResult = {
  date: string;
  bizneoUserId: number;
  status: 'ok' | 'error';
  error?: string;
};

export type BizneoTimeRange = { start_at: string; end_at: string };

export async function pushShiftToBizneo(
  bizneoUserId: number,
  date: string,                   // YYYY-MM-DD
  timeRanges: BizneoTimeRange[],  // um ou dois ranges
  name?: string,                  // nome do modelo exibido no Bizneo
  taxonId?: number,               // ID do local/unidade no Bizneo
): Promise<void> {
  const token = getToken();

  const body = {
    one_time_schedule: {
      date,
      state: 'draft',
      ...(name ? { name } : {}),
      ...(taxonId ? { taxon_id: taxonId } : {}),
      time_ranges: timeRanges,
    },
  };

  const res = await fetch(
    `${BASE_URL}/users/${bizneoUserId}/one-time-schedules?token=${token}`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bizneo ${res.status}: ${text.slice(0, 200)}`);
  }
}
