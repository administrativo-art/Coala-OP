"use client";

import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BarChart3, Plus, FileText, CheckCircle2, Clock, ChevronRight, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PermissionGuard } from '@/components/permission-guard';
import { CreateQuotationModal } from '@/components/purchasing/create-quotation-modal';
import { useQuotations } from '@/hooks/use-quotations';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { canCreateQuotation, canViewPurchasing } from '@/lib/purchasing-permissions';
import { type Quotation } from '@/types';

const STATUS_CONFIG: Record<
  Quotation['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Rascunho', variant: 'secondary' },
  quoted: { label: 'Finalizada', variant: 'default' },
  partially_converted: { label: 'Parcialmente convertida', variant: 'outline' },
  converted: { label: 'Convertida', variant: 'default' },
  archived: { label: 'Arquivada', variant: 'outline' },
  expired: { label: 'Expirada', variant: 'destructive' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
};

function QuotationRow({ quotation }: { quotation: Quotation }) {
  const { entities } = useEntities();
  const supplier = entities.find((e) => e.id === quotation.supplierId);
  const status = STATUS_CONFIG[quotation.status];

  return (
    <Link
      href={`/dashboard/purchasing/quotations/${quotation.id}`}
      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex-shrink-0 p-2 rounded-md bg-muted">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">
              {supplier?.fantasyName ?? supplier?.name ?? '—'}
            </span>
            <Badge variant={status.variant} className="text-xs">
              {status.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {quotation.mode === 'remote' ? 'Remota' : 'In loco'}
            </span>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span>{format(parseISO(quotation.createdAt), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}</span>
            {quotation.validUntil && (
              <span>Válida até {format(parseISO(quotation.validUntil), 'dd/MM/yyyy')}</span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
    </Link>
  );
}

export default function QuotationsPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const { quotations, loading } = useQuotations();
  const [createOpen, setCreateOpen] = useState(false);
  const canView = canViewPurchasing(permissions);

  const active = useMemo(
    () => quotations.filter((q) => q.status === 'draft' || q.status === 'partially_converted'),
    [quotations],
  );

  const history = useMemo(
    () => quotations.filter((q) => q.status === 'quoted' || q.status === 'converted' || q.status === 'archived' || q.status === 'expired' || q.status === 'cancelled'),
    [quotations],
  );

  const canCreate = canCreateQuotation(permissions);

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
            <h1 className="text-2xl font-bold">Cotações</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie cotações por fornecedor antes de criar uma compra.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard/purchasing/quotations/compare">
                <BarChart3 className="mr-2 h-4 w-4" />
                Comparativo
              </Link>
            </Button>
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nova cotação
              </Button>
            )}
          </div>
        </div>

        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active" className="gap-2">
              <Clock className="h-4 w-4" />
              Ativas
              {active.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-xs font-medium">
                  {active.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4 space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : active.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-16">
                Nenhuma cotação ativa.
              </div>
            ) : (
              active.map((q) => <QuotationRow key={q.id} quotation={q} />)
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-2">
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : history.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-16">
                Nenhuma cotação no histórico.
              </div>
            ) : (
              history.map((q) => <QuotationRow key={q.id} quotation={q} />)
            )}
          </TabsContent>
        </Tabs>
      </div>

      <CreateQuotationModal open={createOpen} onOpenChange={setCreateOpen} />
    </PermissionGuard>
  );
}
