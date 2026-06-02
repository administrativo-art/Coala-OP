import type { PurchaseAssetComponentAction, PurchaseItemTreatment, PurchaseOrderItem, PurchaseReceiptItem, PurchaseStockEntryType } from '@/types';

export const PURCHASE_ITEM_TREATMENT_OPTIONS: Array<{
  value: PurchaseItemTreatment;
  label: string;
  description: string;
}> = [
  {
    value: 'stock',
    label: 'Estoque',
    description: 'Gera lote e movimentacao de estoque no recebimento.',
  },
  {
    value: 'uniform',
    label: 'Uniforme',
    description: 'Gera entrada controlada como uniforme operacional.',
  },
  {
    value: 'asset',
    label: 'Patrimonio',
    description: 'Gera patrimonio individual com etiqueta no recebimento.',
  },
  {
    value: 'asset_component',
    label: 'Componente de patrimonio',
    description: 'Agrega custo/historico a um patrimonio existente, sem criar estoque.',
  },
  {
    value: 'service',
    label: 'Servico/manutencao',
    description: 'Registra custo do servico, sem criar estoque ou patrimonio.',
  },
  {
    value: 'expense',
    label: 'Despesa/consumo direto',
    description: 'Registra despesa operacional, sem entrada de estoque.',
  },
];

export const PURCHASE_COMPONENT_ACTION_OPTIONS: Array<{
  value: PurchaseAssetComponentAction;
  label: string;
}> = [
  { value: 'replacement', label: 'Peca de reposicao' },
  { value: 'improvement', label: 'Melhoria/upgrade' },
  { value: 'repair', label: 'Reparo/manutencao' },
  { value: 'installation', label: 'Instalacao/acessorio' },
  { value: 'other', label: 'Outro' },
];

export function getTreatmentEntryType(treatment?: PurchaseItemTreatment): PurchaseStockEntryType {
  if (treatment === 'asset') return 'asset';
  if (treatment === 'uniform') return 'uniform';
  return 'stock';
}

export function inferPurchaseItemTreatment(
  item: Pick<PurchaseOrderItem | PurchaseReceiptItem, 'itemTreatment' | 'entryType' | 'itemDestination'>,
): PurchaseItemTreatment {
  if (item.itemTreatment) return item.itemTreatment;
  if (item.entryType === 'asset' || item.itemDestination === 'asset') return 'asset';
  if (item.entryType === 'uniform' || item.itemDestination === 'uniform') return 'uniform';
  return 'stock';
}

export function purchaseTreatmentCreatesStock(treatment?: PurchaseItemTreatment) {
  return treatment === 'stock' || treatment === 'uniform' || !treatment;
}

export function purchaseTreatmentCreatesAsset(treatment?: PurchaseItemTreatment) {
  return treatment === 'asset';
}

export function purchaseTreatmentSkipsOperationalEntry(treatment?: PurchaseItemTreatment) {
  return treatment === 'asset_component' || treatment === 'service' || treatment === 'expense';
}

export function getPurchaseItemTreatmentLabel(treatment?: PurchaseItemTreatment) {
  return PURCHASE_ITEM_TREATMENT_OPTIONS.find((option) => option.value === treatment)?.label ?? 'Estoque';
}
