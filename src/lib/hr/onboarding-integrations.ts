export function requiredOnboardingIntegrationsResolved(value: unknown) {
  if (!Array.isArray(value)) return false;

  const statuses = new Map<string, unknown>();
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const alert = entry as Record<string, unknown>;
    if (typeof alert.id === 'string') statuses.set(alert.id, alert.status);
  });

  return statuses.get('bizneo_id') === 'resolved' && statuses.get('pdv_id') === 'resolved';
}
