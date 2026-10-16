export type BizneoShiftIdentitySource = 'template_id' | 'numeric_code' | 'missing';

export function resolveBizneoShiftIdentity(definition?: {
  bizneoTemplateId?: string;
  code?: string;
}) {
  const explicitId = String(definition?.bizneoTemplateId ?? '').trim().replace(/^#/, '');
  if (explicitId) return { id: explicitId, source: 'template_id' as const };

  const rawCode = String(definition?.code ?? '').trim();
  const numericCode = rawCode.match(/^#?(\d+)$/)?.[1] ?? '';
  if (numericCode) return { id: numericCode, source: 'numeric_code' as const };

  return { id: '', source: 'missing' as const };
}

export function resolveBizneoShiftId(definition?: {
  bizneoTemplateId?: string;
  code?: string;
}) {
  return resolveBizneoShiftIdentity(definition).id;
}
