import type { UserPdvAccess } from '@/types';

type LinkedUnit = { id: string; name: string; pdvFilialId?: string | null };

/** Resolve somente vínculos explícitos; nunca usa a unidade financeira como suposição. */
export function pdvAccessUnitLabel(access: UserPdvAccess, units: readonly LinkedUnit[]): string {
  const unit = units.find((item) => item.id === access.unitId)
    ?? (access.filialId ? units.find((item) => item.pdvFilialId === access.filialId) : undefined);
  return unit?.name?.trim() || access.unitName?.trim() || access.filialName?.trim()
    || (access.filialId ? `Filial ${access.filialId}` : 'Unidade do PDV não sincronizada');
}
