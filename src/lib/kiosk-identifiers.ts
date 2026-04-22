export const FALLBACK_PDV_FILIAL_IDS: Record<string, string> = {
  tirirical: '17343',
  'joao-paulo': '17344',
};

type KioskPdvLike = {
  id: string;
  pdvFilialId?: string | null;
};

export function resolvePdvFilialId(kiosk: KioskPdvLike): string | undefined {
  const stored = kiosk.pdvFilialId?.trim();
  return stored || FALLBACK_PDV_FILIAL_IDS[kiosk.id] || undefined;
}

export function hasStoredPdvFilialId(kiosk: KioskPdvLike): boolean {
  return Boolean(kiosk.pdvFilialId?.trim());
}
