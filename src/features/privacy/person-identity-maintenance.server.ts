import { dbAdmin } from '@/lib/firebase-admin';

const WINDOW_REF = dbAdmin.collection('privacyOperations').doc('personSubjectBackfillWindow');

type MaintenanceTarget = {
  userId?: string | null;
  onboardingProcessId?: string | null;
};

function stringSet(value: unknown) {
  return new Set(Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []);
}

function milliseconds(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return Number.NaN;
}

export function personIdentityWriteBlocked(
  window: Record<string, unknown>,
  target: MaintenanceTarget,
  now = Date.now(),
) {
  if (window.enabled !== true) return false;
  const expiresAt = milliseconds(window.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const userId = typeof target.userId === 'string' ? target.userId : '';
  const processId = typeof target.onboardingProcessId === 'string' ? target.onboardingProcessId : '';
  return (userId !== '' && stringSet(window.userIds).has(userId))
    || (processId !== '' && stringSet(window.onboardingProcessIds).has(processId));
}

/**
 * Short-lived, scope-bound guard used only while reconciling historical person links.
 * The operational window is stored outside the source tree so personal IDs never enter git.
 */
export async function assertPersonIdentityWriteAllowed(target: MaintenanceTarget) {
  const snapshot = await WINDOW_REF.get();
  if (!snapshot.exists || !personIdentityWriteBlocked(snapshot.data() ?? {}, target)) return;
  throw new Error('Os vínculos desta pessoa estão em manutenção por alguns minutos. Tente novamente em seguida.');
}
