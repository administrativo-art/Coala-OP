"use client";

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { BackButton } from '@/components/navigation/back-button';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/permission-guard';
import { Skeleton } from '@/components/ui/skeleton';
import { ReceiptWorkspace } from '@/components/purchasing/receipt-workspace';
import { useAuth } from '@/hooks/use-auth';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useEntities } from '@/hooks/use-entities';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export default function ReceiptPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const { permissions } = useAuth();
  const { receipts, loading } = usePurchaseReceipts();
  const { entities } = useEntities();
  const canView = canViewPurchasing(permissions);

  const receipt = useMemo(
    () => receipts.find((r) => r.purchaseOrderId === params.orderId),
    [receipts, params.orderId],
  );

  const supplier = useMemo(
    () => entities.find((e) => e.id === receipt?.supplierId),
    [entities, receipt],
  );

  if (loading) {
    return (
      <div className="container max-w-[1600px] py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="container max-w-3xl py-8 space-y-4">
        <p className="text-muted-foreground">Recebimento não encontrado.</p>
        <BackButton fallbackHref={`/dashboard/purchasing/orders/${params.orderId}`} />
      </div>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-[1600px] py-8 space-y-6">
      <BackButton fallbackHref={`/dashboard/purchasing/orders/${params.orderId}`} label="Compra" variant="ghost" size="sm" className="-ml-2" />

      <div>
        <h1 className="text-2xl font-bold">Recebimento</h1>
        <p className="text-sm text-muted-foreground">
          {supplier?.fantasyName ?? supplier?.name ?? '—'} —{' '}
          {receipt.expectedDate ? format(parseISO(receipt.expectedDate), "dd 'de' MMM 'de' yyyy", { locale: ptBR }) : 'Data não informada'}
        </p>
      </div>

        <ReceiptWorkspace receipt={receipt} />
      </div>
    </PermissionGuard>
  );
}
