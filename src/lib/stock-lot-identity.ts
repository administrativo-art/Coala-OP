import type { LotEntry } from '@/types';
import { WORKSPACE_ID } from './workspace';

type LotCode = { lotNumber: string; expiryDate?: string | null };
type LotIdentity = Pick<LotEntry, 'productId' | 'kioskId'> & LotCode;

/** Only an empty code or a lone hyphen without expiry means untracked stock. */
export function isUntrackedStockLot(lot: LotCode): boolean {
  return !lot.expiryDate && ['', '-'].includes((lot.lotNumber ?? '').trim());
}

export function stockLotNumber(lot: LotCode): string {
  return isUntrackedStockLot(lot) ? '-' : lot.lotNumber;
}

export function stockLotLabel(lot: LotCode): string {
  if (isUntrackedStockLot(lot)) return 'Sem lote';
  return lot.lotNumber?.trim() ? lot.lotNumber : 'Sem número de lote';
}

/** Share this ID across entry channels only for stock with no lot and no expiry. */
export function untrackedStockLotId(lot: LotIdentity): string | null {
  return isUntrackedStockLot(lot)
    ? `prod_${lot.productId}__kiosk_${lot.kioskId}__lot_-__exp_null`
    : null;
}

/** The document ID can outlive edits to its identifying fields. */
export function canReceiveUntrackedStock(existing: LotIdentity & Pick<LotEntry, 'workspaceId' | 'condition' | 'uniformStockStatus'>, incoming: LotIdentity): boolean {
  return existing.productId === incoming.productId &&
    existing.kioskId === incoming.kioskId &&
    (existing.workspaceId ?? WORKSPACE_ID) === WORKSPACE_ID &&
    !existing.condition && !existing.uniformStockStatus &&
    isUntrackedStockLot(existing);
}

export const incompatibleUntrackedStockMessage =
  'O registro reservado para estoque sem lote tem outra identificação. Revise o lote existente antes de continuar.';

export const missingDatedStockLotNumberMessage = 'Informe o número do lote quando houver validade.';

export type StockLotGroup = LotEntry & { sourceLots: LotEntry[] };

/** Physical IDs remain available; totals must never be passed to a single-ID action. */
export function groupStockLots(lots: LotEntry[]): StockLotGroup[] {
  const groups = new Map<string, StockLotGroup>();
  for (const lot of lots) {
    const key = JSON.stringify([lot.workspaceId ?? WORKSPACE_ID, lot.productId, lot.kioskId,
      stockLotNumber(lot), lot.expiryDate || null, lot.locationId || null,
      lot.condition ?? null, lot.uniformStockStatus ?? null]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += lot.quantity;
      existing.reservedQuantity = (existing.reservedQuantity || 0) + (lot.reservedQuantity || 0);
      existing.sourceLots.push(lot);
    } else {
      groups.set(key, { ...lot, lotNumber: stockLotNumber(lot), sourceLots: [lot] });
    }
  }
  return [...groups.values()];
}

export function physicalLotForAction(group: StockLotGroup, selectedId?: string | null): LotEntry | null {
  return selectedId ? group.sourceLots.find(lot => lot.id === selectedId) ?? null
    : group.sourceLots.length === 1 ? group.sourceLots[0] : null;
}
