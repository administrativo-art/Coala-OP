import { differenceInDays, parseISO } from 'date-fns';

import { formatQuantity } from '@/lib/conversion';
import { type LotEntry, type MovementType, type Product, type RepositionActivity } from '@/types';

export const DEFAULT_URGENT_THRESHOLD = 7;

export const ACTIVE_REPOSITION_RESERVATION_STATUSES: RepositionActivity['status'][] = [
  'Aguardando despacho',
  'Aguardando recebimento',
  'Recebido com divergência',
  'Recebido sem divergência',
];

export type LotStatusKey = 'expired' | 'expiring' | 'ok' | 'no_expiry';

export type LotStatus = { key: LotStatusKey; text: string; pillClass: string };

const PILL_BASE = 'inline-flex h-[21px] items-center whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-bold';

const PILL_TONES: Record<LotStatusKey, string> = {
  no_expiry: 'bg-[#eceae5] text-[#70757d]',
  expired: 'bg-[#ffe4e8] text-[#be123c]',
  expiring: 'bg-[#fff1e6] text-[#c2410c]',
  ok: 'bg-[#e8f5ee] text-[#15803d]',
};

export function lotStatusOf(lot: Pick<LotEntry, 'expiryDate'>, product?: Pick<Product, 'urgentThreshold'>, today = new Date()): LotStatus {
  const make = (key: LotStatusKey, text: string): LotStatus => ({ key, text, pillClass: `${PILL_BASE} ${PILL_TONES[key]}` });
  if (!lot.expiryDate) return make('no_expiry', 'Validade indefinida');

  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  const days = differenceInDays(parseISO(lot.expiryDate), base);
  const urgent = product?.urgentThreshold ?? DEFAULT_URGENT_THRESHOLD;

  if (days < 0) return make('expired', `Vencido há ${Math.abs(days)} dia(s)`);
  if (days === 0) return make('expiring', 'Vence hoje');
  if (days <= urgent) return make('expiring', `Vence em ${days} dia(s)`);
  return make('ok', `Vence em ${days} dias`);
}

const nf = (value: number, max = 2) => value.toLocaleString('pt-BR', { maximumFractionDigits: max });

export type LotQuantityPart = { value: string; unit: string };

/**
 * Quantidade do lote em até três medidas. Quando a embalagem é a própria unidade
 * (ex.: 302 un), aparece uma vez só em vez de repetir o mesmo número.
 */
export function lotQuantityParts(lot: Pick<LotEntry, 'quantity'>, product: Product): LotQuantityPart[] {
  const parts: LotQuantityPart[] = [];
  const unit = (product.unit || '').toLowerCase();
  const isSelfPackage = (unit === 'un' || unit === 'unidade') && product.packageSize === 1;

  if (isSelfPackage) {
    parts.push({ value: nf(lot.quantity), unit: lot.quantity === 1 ? 'unidade' : 'unidades' });
  } else {
    parts.push({ value: formatQuantity(lot.quantity * product.packageSize, product.unit), unit: product.unit });
    const pkg = (product.packageType || 'pct').toLowerCase();
    parts.push({ value: nf(lot.quantity), unit: lot.quantity === 1 ? pkg : `${pkg}s` });
  }

  if (product.multiplo_caixa && product.multiplo_caixa > 0 && product.rotulo_caixa) {
    const boxes = lot.quantity / product.multiplo_caixa;
    if (boxes >= 0.1) {
      const label = product.rotulo_caixa.toLowerCase();
      parts.push({ value: nf(boxes, 1), unit: boxes === 1 ? label : `${label}s` });
    }
  }

  return parts;
}

export function lotQuantityLine(lot: Pick<LotEntry, 'quantity'>, product: Product): string {
  return lotQuantityParts(lot, product).map((part) => `${part.value} ${part.unit}`).join(' · ');
}

/** Ficha do produto em uma linha: marca · embalagem · agrupamento · EAN. */
export function productSpecLine(product: Product, options: { withBarcode?: boolean } = {}): string {
  const pkg = product.packageType || 'un';
  return [
    product.brand || 'Sem marca',
    `${pkg} com ${product.packageSize}${product.unit}`,
    product.multiplo_caixa && product.rotulo_caixa
      ? `1 ${product.rotulo_caixa} = ${product.multiplo_caixa} ${product.packageType ? `${product.packageType}(s)` : 'unidades'}`
      : null,
    options.withBarcode && product.barcode ? `EAN ${product.barcode}` : null,
  ].filter(Boolean).join('  ·  ');
}

export function productInitials(product: Pick<Product, 'baseName'>): string {
  return (product.baseName || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export type LotReservation = { total: number; destinations: Record<string, number> };

export function buildReservationsByLot(activities: RepositionActivity[]): Map<string, LotReservation> {
  const map = new Map<string, LotReservation>();
  activities
    .filter((activity) => ACTIVE_REPOSITION_RESERVATION_STATUSES.includes(activity.status))
    .forEach((activity) => {
      activity.items.forEach((item) => {
        item.suggestedLots.forEach((suggested) => {
          const current = map.get(suggested.lotId) ?? { total: 0, destinations: {} };
          current.total += suggested.quantityToMove;
          current.destinations[activity.kioskDestinationName] =
            (current.destinations[activity.kioskDestinationName] ?? 0) + suggested.quantityToMove;
          map.set(suggested.lotId, current);
        });
      });
    });
  return map;
}

/** Reserva exibida: a maior entre o campo do lote e a derivada das atividades de reposição. */
export function lotReservedQuantity(lot: Pick<LotEntry, 'reservedQuantity'>, reservation?: LotReservation): number {
  return Math.max(Number(lot.reservedQuantity ?? 0), reservation?.total ?? 0);
}

/** Disponível para baixa: quantidade menos a reserva ativa. */
export function lotAvailableQuantity(lot: Pick<LotEntry, 'quantity' | 'reservedQuantity'>, reservation?: LotReservation): number {
  return Math.max(0, lot.quantity - lotReservedQuantity(lot, reservation));
}

export const WRITE_DOWN_REASONS: { value: MovementType; label: string }[] = [
  { value: 'SAIDA_CONSUMO', label: 'Consumo / Venda' },
  { value: 'SAIDA_DESCARTE_VENCIMENTO', label: 'Descarte por vencimento' },
  { value: 'SAIDA_DESCARTE_AVARIA', label: 'Descarte por avaria / quebra' },
  { value: 'SAIDA_DESCARTE_PERDA', label: 'Extravio de mercadoria' },
  { value: 'SAIDA_DESCARTE_OUTROS', label: 'Outros (especificar)' },
];

export type WriteDownInput = { quantity: string; type: MovementType; notes: string; available: number };

/** Valida a baixa do painel; devolve a mensagem de erro ou `null` quando pode gravar. */
export function validateWriteDown(input: WriteDownInput): string | null {
  const quantity = parseFloat(String(input.quantity).replace(/\./g, '').replace(',', '.'));
  if (!(quantity > 0)) return 'Informe uma quantidade maior que zero.';
  if (quantity > input.available) return `Quantidade maior que o disponível (${nf(input.available)}).`;
  if (input.type === 'SAIDA_DESCARTE_OUTROS' && !input.notes.trim()) return 'A observação é obrigatória para o motivo “Outros”.';
  return null;
}

export function parseWriteDownQuantity(value: string): number {
  return parseFloat(String(value).replace(/\./g, '').replace(',', '.'));
}

export type KpiFilterKey = 'expiring' | 'expired' | 'reserved' | 'no_expiry';

/** O filtro de "reserved" não vem do status de validade, e sim da reserva do lote. */
export function lotMatchesStatusFilters(
  filters: readonly string[],
  status: LotStatus,
  reservedQuantity: number,
): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => (filter === 'reserved' ? reservedQuantity > 0 : status.key === filter));
}

export type MovementTone = 'in' | 'out' | 'transfer' | 'reversal';

const MOVEMENT_LABELS: Partial<Record<MovementType, string>> = {
  ENTRADA: 'Entrada · Recebimento',
  SAIDA_CONSUMO: 'Saída · Consumo/Venda',
  SAIDA_DESCARTE_VENCIMENTO: 'Saída · Descarte por vencimento',
  SAIDA_DESCARTE_AVARIA: 'Saída · Descarte por avaria',
  SAIDA_DESCARTE_PERDA: 'Saída · Extravio',
  SAIDA_DESCARTE_OUTROS: 'Saída · Outros',
  SAIDA_CORRECAO: 'Saída · Correção',
  ENTRADA_CORRECAO: 'Entrada · Correção',
  TRANSFERENCIA_SAIDA: 'Transferência · Saída',
  TRANSFERENCIA_ENTRADA: 'Transferência · Entrada',
  ENTRADA_ESTORNO: 'Estorno · Entrada',
  SAIDA_ESTORNO: 'Estorno · Saída',
};

export function movementLabel(type: MovementType): string {
  return MOVEMENT_LABELS[type] ?? String(type).replace(/_/g, ' ').toLowerCase();
}

export function movementTone(type: MovementType): MovementTone {
  if (String(type).includes('ESTORNO')) return 'reversal';
  if (String(type).includes('TRANSFERENCIA')) return 'transfer';
  if (String(type).startsWith('ENTRADA')) return 'in';
  return 'out';
}
