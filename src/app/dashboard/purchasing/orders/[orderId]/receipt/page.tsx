"use client";

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
      <div className="container max-w-3xl py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="container max-w-3xl py-8 space-y-4">
        <p className="text-muted-foreground">Recebimento não encontrado.</p>
        <Button variant="outline" onClick={() => router.push(`/dashboard/purchasing/orders/${params.orderId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-3xl py-8 space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push(`/dashboard/purchasing/orders/${params.orderId}`)}
        className="-ml-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Compra
      </Button>

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
