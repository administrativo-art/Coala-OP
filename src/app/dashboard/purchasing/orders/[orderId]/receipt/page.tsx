"use client";

import { useMemo } from 'react';
import { useParams } from 'next/navigation';

import { BackButton } from '@/components/navigation/back-button';
import { PermissionGuard } from '@/components/permission-guard';
import { Skeleton } from '@/components/ui/skeleton';
import { ReceiptWorkspace } from '@/components/purchasing/receipt-workspace';
import { PurchasingModuleNavigation } from '@/components/purchasing/purchasing-module-navigation';
import { PurchasingPageFrame } from '@/components/purchasing/purchasing-ui';
import { useAuth } from '@/hooks/use-auth';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export default function ReceiptPage() {
  const params = useParams<{ orderId: string }>();
  const { permissions } = useAuth();
  const { receipts, loading } = usePurchaseReceipts();
  const canView = canViewPurchasing(permissions);

  const receipt = useMemo(
    () => receipts.find((r) => r.purchaseOrderId === params.orderId),
    [receipts, params.orderId],
  );

  if (loading) {
    return (
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="receipts" activeStage="receiving" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </PurchasingPageFrame>
    );
  }

  if (!receipt) {
    return (
      <PurchasingPageFrame>
        <PurchasingModuleNavigation activeTab="receipts" activeStage="receiving" />
        <p className="text-muted-foreground">Recebimento não encontrado.</p>
        <BackButton fallbackHref={`/dashboard/purchasing/orders/${params.orderId}`} />
      </PurchasingPageFrame>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <PurchasingPageFrame>
      <PurchasingModuleNavigation activeTab="receipts" activeStage={receipt.status === 'stocked' ? 'costs' : 'receiving'} />
      <BackButton fallbackHref={`/dashboard/purchasing/orders/${params.orderId}`} label="Compra" variant="ghost" size="sm" className="-ml-2 mb-3" />
      <ReceiptWorkspace receipt={receipt} />
      </PurchasingPageFrame>
    </PermissionGuard>
  );
}
