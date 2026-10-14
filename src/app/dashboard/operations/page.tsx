"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { useProducts } from "@/hooks/use-products";
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData";
import { useStockAudit } from "@/hooks/use-stock-audit";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  ArrowRight, Timer,
} from "lucide-react";
import { differenceInDays, parseISO, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PurchaseAlertCard } from "@/components/purchase-alert-card";
import { TaskManager } from "@/components/task-manager";
import { RestockPanel } from "@/components/restock-panel";
import { AuditDashboard } from "@/components/audit-dashboard";
import { canAccessUnit } from "@/lib/unit-access";
import { ManagementDashboardBuilder, ManagementWidgetFrame } from "@/features/management-dashboard/builder-context";
import { MANAGEMENT_WIDGET_BY_ID } from "@/features/management-dashboard/catalog";
import { WidgetCard, WidgetHead, KpiTile } from "@/features/management-dashboard/widgets/kit";
import { widgetIcons } from "@/features/management-dashboard/widgets/icons";
import type { ManagementWidgetId } from "@/features/management-dashboard/types";
import { PageHero } from "@/components/patterns/page-hero";

// ─── Expiring Products Quick View ─────────────────────────────────────────────

function ExpiringQuickView({ lots, loading }: { lots: any[]; loading: boolean }) {
  const expiringSoon = useMemo(() => {
    if (loading) return [];
    return lots
      .filter(lot => {
        if (!lot.expiryDate) return false;
        const days = differenceInDays(parseISO(lot.expiryDate), new Date());
        return days >= 0 && days <= 7 && lot.quantity > 0;
      })
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
      .slice(0, 8);
  }, [lots, loading]);

  if (loading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="h-4 w-4 text-ds-danger" />
            Vencendo em breve
          </CardTitle>
          <Link href="/dashboard/stock/inventory-control" className="text-xs text-primary hover:underline flex items-center gap-1">
            Ver todos <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {expiringSoon.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-ds-ink-muted gap-2">
            <Package className="h-8 w-8 opacity-40" />
            <p className="text-sm">Nenhum produto vencendo nos próximos 7 dias.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {expiringSoon.map((lot, i) => {
              const days = differenceInDays(parseISO(lot.expiryDate), new Date());
              return (
                <div key={lot.id || i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{lot.productName || lot.name}</p>
                    <p className="text-xs text-ds-ink-muted">Qtd: {lot.quantity}</p>
                  </div>
                  <Badge
                    variant={days <= 2 ? "destructive" : "secondary"}
                    className="shrink-0 text-xs"
                  >
                    {days === 0 ? "Hoje" : days === 1 ? "Amanhã" : `${days} dias`}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OperationsPage() {
  const { user, firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { products } = useProducts();
  const { isLoading: consumptionLoading } = useValidatedConsumptionData();

  const lotsInKiosk = useMemo(() => {
    if (lotsLoading || !user) return [];
    const uniformProductIds = new Set(
      products
        .filter((product) => product.operationalDestination === "uniform" || product.category === "Vestimenta")
        .map((product) => product.id),
    );
    const commonLots = lots.filter((lot) => !uniformProductIds.has(lot.productId));
    return commonLots.filter((lot) => canAccessUnit(user, lot.kioskId, { isDefaultAdmin }));
  }, [isDefaultAdmin, lots, products, user, lotsLoading]);

  const expiringSoonCount = useMemo(() => {
    if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => {
      if (!lot.expiryDate) return false;
      const days = differenceInDays(parseISO(lot.expiryDate), new Date());
      return days >= 0 && days <= 7 && lot.quantity > 0;
    }).length;
  }, [lotsInKiosk, lotsLoading]);

  const expiredCount = useMemo(() => {
    if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => {
      if (!lot.expiryDate) return false;
      return differenceInDays(parseISO(lot.expiryDate), new Date()) < 0 && lot.quantity > 0;
    }).length;
  }, [lotsInKiosk, lotsLoading]);

  const initialLoading = lotsLoading || consumptionLoading;

  if (!permissions.dashboard?.view) {
    return <p className="text-ds-ink-muted p-6">Sem permissão para acessar o Painel de Operações.</p>;
  }

  const show = (id: ManagementWidgetId) => MANAGEMENT_WIDGET_BY_ID.get(id)?.canView(permissions) ?? false;
  const activeLots = lotsInKiosk.filter((lot) => lot.quantity > 0).length;

  return (
    <div className="w-full space-y-3 pb-8 font-ds">
      <PageHero
        kicker="Operação"
        title="Painel de operações"
        subtitle="Visão geral operacional — estoque, validade, reposição e tarefas."
      />

      <ManagementDashboardBuilder firebaseUser={firebaseUser} userId={firebaseUser?.uid ?? user?.id ?? ""} userName={user?.username ?? "Usuário"} permissions={permissions} scope="operations">
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-6 xl:grid-cols-12">
          {show("ops-summary") && (
            <WidgetCard widgetId="ops-summary">
              {(density) => (
                <>
                  <WidgetHead icon={widgetIcons.inventory} tone="accent" title="Validade e estoque" subtitle="Lotes das suas unidades" href="/dashboard/stock/inventory-control" density={density} />
                  {initialLoading ? <Skeleton className="h-20 w-full" /> : (
                    <div className={density === "compact" ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 gap-3 lg:grid-cols-4"}>
                      <KpiTile label="Vencendo em 7 dias" value={String(expiringSoonCount)} note="próximos do vencimento" tone={expiringSoonCount > 0 ? "danger" : "muted"} />
                      <KpiTile label="Vencidos" value={String(expiredCount)} note="ainda em estoque" tone={expiredCount > 0 ? "warn" : "muted"} />
                      <KpiTile label="Estoque" value={String(activeLots)} note="lotes ativos" />
                      <KpiTile label="Monitorados" value={String(lotsInKiosk.length)} note="lotes rastreados" />
                    </div>
                  )}
                </>
              )}
            </WidgetCard>
          )}

          {show("ops-expiring") && (
            <ManagementWidgetFrame id="ops-expiring">
              <ExpiringQuickView lots={lotsInKiosk} loading={lotsLoading} />
            </ManagementWidgetFrame>
          )}

          {show("ops-purchase-alerts") && (
            <ManagementWidgetFrame id="ops-purchase-alerts">
              <div className="space-y-4">
                <h2 className="text-[11px] font-black text-ds-ink-muted uppercase tracking-[0.2em]">Compras Urgentes</h2>
                <PurchaseAlertCard />
              </div>
            </ManagementWidgetFrame>
          )}

          {show("ops-restock") && <ManagementWidgetFrame id="ops-restock"><RestockPanel /></ManagementWidgetFrame>}
          {show("ops-count") && <ManagementWidgetFrame id="ops-count"><AuditDashboard /></ManagementWidgetFrame>}
          {show("ops-tasks") && <ManagementWidgetFrame id="ops-tasks"><TaskManager /></ManagementWidgetFrame>}
        </div>
      </ManagementDashboardBuilder>
    </div>
  );
}
