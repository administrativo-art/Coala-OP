"use client";

import { useMemo } from 'react';

import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useQuotations } from '@/hooks/use-quotations';
import {
  PurchasingFlowStrip,
  PurchasingModuleTabs,
  purchasingCompactMoney,
} from '@/components/purchasing/purchasing-ui';

export type PurchasingModuleTab = 'quotations' | 'orders' | 'receipts' | 'costs';
export type PurchasingFlowStageKey = 'quotations' | 'issued' | 'to_receive' | 'receiving' | 'costs';

const RECEIVING_STATUSES = new Set([
  'in_conference',
  'awaiting_stock',
  'in_stock_entry',
  'partially_stocked',
  'stocked_with_divergence',
]);

export function PurchasingModuleNavigation({
  activeTab,
  activeStage,
}: {
  activeTab: PurchasingModuleTab;
  activeStage: PurchasingFlowStageKey;
}) {
  const { quotations } = useQuotations();
  const { orders } = usePurchaseOrders();
  const { receipts } = usePurchaseReceipts();

  const summary = useMemo(() => {
    const receiptByOrder = new Map(receipts.map((receipt) => [receipt.purchaseOrderId, receipt]));
    const activeQuotations = quotations.filter((quotation) =>
      ['draft', 'quoted', 'partially_converted'].includes(quotation.status),
    ).length;
    const issued = orders.filter((order) => order.status === 'created').length;
    const awaitingOrders = orders.filter((order) => {
      if (order.status !== 'confirmed' || order.receivedAt) return false;
      const receipt = receiptByOrder.get(order.id);
      return receipt?.status !== 'stocked' && receipt?.status !== 'cancelled';
    });
    const receiving = receipts.filter((receipt) => RECEIVING_STATUSES.has(receipt.status)).length;
    const costs = receipts.filter((receipt) => receipt.status === 'stocked').length;
    const incomingValue = awaitingOrders.reduce(
      (sum, order) => sum + Number(order.totalConfirmed && order.totalConfirmed > 0 ? order.totalConfirmed : order.totalEstimated),
      0,
    );

    return {
      activeQuotations,
      issued,
      awaiting: awaitingOrders.length,
      receiving,
      costs,
      incomingValue,
    };
  }, [orders, quotations, receipts]);

  return (
    <>
      <PurchasingFlowStrip
        stages={[
          {
            label: 'Cotações',
            value: summary.activeQuotations,
            detail: 'abertas e finalizadas',
            tone: 'cyan',
            href: '/dashboard/purchasing/quotations',
            active: activeStage === 'quotations',
          },
          {
            label: 'Emitidos',
            value: summary.issued,
            detail: 'aguardando confirmação',
            tone: 'blue',
            href: '/dashboard/purchasing/orders',
            active: activeStage === 'issued',
          },
          {
            label: 'A receber',
            value: summary.awaiting,
            detail: `${purchasingCompactMoney(summary.incomingValue)} a caminho`,
            tone: 'purple',
            href: '/dashboard/purchasing/receipts',
            active: activeStage === 'to_receive',
          },
          {
            label: 'Recebimento',
            value: summary.receiving,
            detail: summary.receiving ? 'em conferência ou estoque' : 'nenhuma divergência aberta',
            tone: 'amber',
            href: '/dashboard/purchasing/receipts',
            active: activeStage === 'receiving',
          },
          {
            label: 'Custo efetivo',
            value: summary.costs,
            detail: 'compras com custo gravado',
            tone: 'purple',
            href: '/dashboard/purchasing/costs',
            active: activeStage === 'costs',
          },
        ]}
      />
      <PurchasingModuleTabs active={activeTab} />
    </>
  );
}
