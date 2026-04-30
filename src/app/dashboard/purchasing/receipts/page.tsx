"use client";

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, PackageCheck, ChevronRight, Clock, Package, CheckCircle2, Boxes } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionGuard } from '@/components/permission-guard';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type PurchaseReceipt } from '@/types';

type PhaseConfig = {
  label: string;
  icon: React.ElementType;
  className: string;
};

const PHASE_CONFIG: Record<PurchaseReceipt['status'], PhaseConfig> = {
  awaiting_delivery: { label: 'Aguardando recebimento', icon: Clock, className: 'border-orange-300 bg-orange-50 text-orange-700' },
  in_conference: { label: 'Em conferência', icon: PackageCheck, className: 'border-blue-300 bg-blue-50 text-blue-700' },
  awaiting_stock: { label: 'Aguardando estoque', icon: Package, className: 'border-amber-300 bg-amber-50 text-amber-700' },
  in_stock_entry: { label: 'Entrada no estoque', icon: Boxes, className: 'border-purple-300 bg-purple-50 text-purple-700' },
  partially_stocked: { label: 'Estoque parcial', icon: Boxes, className: 'border-amber-300 bg-amber-50 text-amber-700' },
  stocked: { label: 'Estocado', icon: CheckCircle2, className: 'border-green-400 bg-green-50 text-green-700' },
  stocked_with_divergence: { label: 'Estocado c/ divergência', icon: CheckCircle2, className: 'border-red-300 bg-red-50 text-red-700' },
  cancelled: { label: 'Cancelado', icon: CheckCircle2, className: 'border-zinc-300 bg-zinc-50 text-zinc-500' },
};

function ReceiptRow({ receipt }: { receipt: PurchaseReceipt }) {
  const { entities } = useEntities();
  const supplier = entities.find((e) => e.id === receipt.supplierId);
  const phase = PHASE_CONFIG[receipt.status];
  const PhaseIcon = phase.icon;

  return (
    <Link
      href={`/dashboard/purchasing/orders/${receipt.purchaseOrderId}/receipt`}
      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex-shrink-0 p-2 rounded-md bg-muted">
          <PhaseIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {supplier?.fantasyName ?? supplier?.name ?? '—'}
            </span>
            <Badge variant="outline" className={`text-xs ${phase.className}`}>
              {phase.label}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {receipt.receiptMode === 'immediate_pickup' ? '⚡ Retirada' : '🚚 Entrega futura'}
            </Badge>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
            {receipt.totalEstimated != null && (
              <span className="font-medium text-foreground">
                {receipt.totalEstimated.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            )}
            {receipt.expectedDate && (
              <span>Previsto: {format(parseISO(receipt.expectedDate), 'dd/MM/yyyy', { locale: ptBR })}</span>
            )}
            {receipt.stockEnteredAt && (
              <span>Estocado: {format(parseISO(receipt.stockEnteredAt), 'dd/MM/yyyy', { locale: ptBR })}</span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  );
}

export default function ReceiptsPage() {
  const router = useRouter();
  const { permissions, firebaseUser } = useAuth();
  const { receipts, loading } = usePurchaseReceipts();
  const canView = canViewPurchasing(permissions);

  const pending = useMemo(
    () => receipts.filter((r) => r.status === 'awaiting_delivery' || r.status === 'in_conference' || r.status === 'awaiting_stock' || r.status === 'in_stock_entry' || r.status === 'partially_stocked'),
    [receipts],
  );

  const done = useMemo(
    () => receipts.filter((r) => r.status === 'stocked' || r.status === 'stocked_with_divergence' || r.status === 'cancelled'),
    [receipts],
  );

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/purchasing')} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Compras
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recebimentos</h1>
          <p className="text-sm text-muted-foreground">
            Confira mercadorias e registre a entrada no estoque.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const token = await firebaseUser?.getIdToken(true);
            if (!token) return;
            try {
              const res = await fetch('/api/admin/fix-receipts', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: '{}'
              });
              const data = await res.json();
              if (data.ok) {
                alert(`${data.recovered?.length || 0} recebimento(s) sincronizado(s).`);
                window.location.reload();
              }
            } catch (err) {
              console.error(err);
            }
          }}
        >
          <Boxes className="mr-2 h-4 w-4" />
          Sincronizar
        </Button>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-4 w-4" />
            Pendentes
            {pending.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-xs font-medium">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="done" className="gap-2">
            <PackageCheck className="h-4 w-4" />
            Concluídos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : pending.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              Nenhum recebimento pendente.
            </div>
          ) : (
            pending.map((r) => <ReceiptRow key={r.id} receipt={r} />)
          )}
        </TabsContent>

        <TabsContent value="done" className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : done.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              Nenhum recebimento concluído.
            </div>
          ) : (
            done.map((r) => <ReceiptRow key={r.id} receipt={r} />)
          )}
        </TabsContent>
      </Tabs>
      </div>
    </PermissionGuard>
  );
}
