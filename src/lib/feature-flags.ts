import { dbAdmin } from './firebase-admin';

export interface FeatureFlags {
  // Activation flags (progressive rollout) — default false (don't activate new features on failure)
  forms_new_engine_enabled: boolean;
  forms_legacy_dual_write_enabled: boolean;
  forms_read_from_legacy_enabled: boolean;
  forms_navigation_api_enabled: boolean;
  forms_recruitment_context_enabled: boolean;
  tasks_new_engine_enabled: boolean;
  tasks_navigation_api_enabled: boolean;
  tasks_from_forms_enabled: boolean;
  tasks_from_purchase_receipt_enabled: boolean;
  hr_navigation_api_enabled: boolean;
  login_restrictor_enabled: boolean;

  // Kill switches (incident response) — default false (don't kill healthy ops on failure)
  kill_forms_module: boolean;
  kill_tasks_module: boolean;
  kill_tasks_from_forms: boolean;
  kill_tasks_from_purchase_receipt: boolean;
  kill_forms_kpis: boolean;
  kill_recruitment_public_landing: boolean;
  kill_login_restrictor: boolean;
}

const SAFE_DEFAULTS: FeatureFlags = {
  forms_new_engine_enabled: false,
  forms_legacy_dual_write_enabled: false,
  forms_read_from_legacy_enabled: false,
  forms_navigation_api_enabled: false,
  forms_recruitment_context_enabled: false,
  tasks_new_engine_enabled: false,
  tasks_navigation_api_enabled: false,
  tasks_from_forms_enabled: false,
  tasks_from_purchase_receipt_enabled: false,
  hr_navigation_api_enabled: false,
  login_restrictor_enabled: false,
  kill_forms_module: false,
  kill_tasks_module: false,
  kill_tasks_from_forms: false,
  kill_tasks_from_purchase_receipt: false,
  kill_forms_kpis: false,
  kill_recruitment_public_landing: false,
  kill_login_restrictor: false,
};

type CachedEntry = {
  flags: FeatureFlags;
  expiresAt: number;
};

const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 30_000;

export async function getFeatureFlags(workspaceId?: string): Promise<FeatureFlags> {
  const cacheKey = workspaceId?.trim() ? workspaceId.trim() : "__global__";
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now < cached.expiresAt) return cached.flags;

  try {
    const flags: FeatureFlags = { ...SAFE_DEFAULTS };
    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      dbAdmin.collection('feature_flags').get(),
    ];

    if (workspaceId?.trim()) {
      queries.push(
        dbAdmin
          .collection('feature_flags')
          .where('workspace_id', '==', workspaceId.trim())
          .get()
      );
    }

    const snapshots = await Promise.all(queries);

    snapshots.forEach((snap) => {
      snap.docs.forEach((doc) => {
        const data = doc.data();
        const key = data.key as keyof FeatureFlags;
        if (key in flags && typeof data.enabled === 'boolean') {
          (flags as unknown as Record<string, boolean>)[key] = data.enabled;
        }
      });
    });

    cache.set(cacheKey, {
      flags,
      expiresAt: now + CACHE_TTL_MS,
    });
    return flags;
  } catch {
    // Fail safe: activation flags → false, kill switches → false
    return { ...SAFE_DEFAULTS };
  }
}

export function invalidateFlagsCache(): void {
  cache.clear();
}
