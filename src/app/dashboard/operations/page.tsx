"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData";
import { useStockAudit } from "@/hooks/use-stock-audit";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package, AlertTriangle, ClipboardCheck, ShoppingCart, ListTodo,
  ArrowRight, Box, BarChart3, Activity, Timer, TrendingDown,
} from "lucide-react";
import { differenceInDays, parseISO, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PurchaseAlertCard } from "@/components/purchase-alert-card";
import { TaskManager } from "@/components/task-manager";
import { RestockPanel } from "@/components/restock-panel";
import { AuditDashboard } from "@/components/audit-dashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, subtitle, icon, accent, href }: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  accent: string;
  href?: string;
}) {
  const content = (
    <Card className={`relative overflow-hidden transition-all duration-300 group ${href ? 'hover:shadow-lg hover:-translate-y-0.5 cursor-pointer' : ''}`}>
      <div className={`absolute inset-0 opacity-[0.04] bg-gradient-to-br ${accent}`} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`rounded-xl p-2.5 bg-gradient-to-br ${accent} text-white shadow-lg`}>
            {icon}
          </div>
        </div>
        {href && (
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            Ver detalhes <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

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
            <Timer className="h-4 w-4 text-rose-500" />
            Vencendo em breve
          </CardTitle>
          <Link href="/dashboard/stock/inventory-control" className="text-xs text-primary hover:underline flex items-center gap-1">
            Ver todos <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {expiringSoon.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
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
                    <p className="text-xs text-muted-foreground">Qtd: {lot.quantity}</p>
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
  const { user, permissions } = useAuth();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { isLoading: consumptionLoading } = useValidatedConsumptionData();

  const lotsInKiosk = useMemo(() => {
    if (lotsLoading || !user) return [];
    if (user.username === "Tiago Brasil") return lots;
    return lots.filter(lot => user.assignedKioskIds.includes(lot.kioskId));
  }, [lots, user, lotsLoading]);

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
    return <p className="text-muted-foreground p-6">Sem permissão para acessar o Painel de Operações.</p>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Painel de Operações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visão geral operacional — estoque, validade, reposição e tarefas.
        </p>
      </div>

      {/* KPIs */}
      {initialLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Vencendo em 7 dias"
            value={expiringSoonCount}
            subtitle="produtos próximos do vencimento"
            icon={<AlertTriangle className="h-5 w-5" />}
            accent="from-rose-500 to-pink-600"
            href="/dashboard/stock/inventory-control"
          />
          <StatCard
            title="Vencidos"
            value={expiredCount}
            subtitle="produtos já vencidos em estoque"
            icon={<TrendingDown className="h-5 w-5" />}
            accent="from-amber-500 to-orange-600"
            href="/dashboard/stock/inventory-control"
          />
          <StatCard
            title="Estoque"
            value={lotsInKiosk.filter(l => l.quantity > 0).length}
            subtitle="lotes ativos no quiosque"
            icon={<Box className="h-5 w-5" />}
            accent="from-blue-500 to-indigo-600"
            href="/dashboard/stock"
          />
          <StatCard
            title="Itens Monitorados"
            value={lotsInKiosk.length}
            subtitle="total de lotes rastreados"
            icon={<Activity className="h-5 w-5" />}
            accent="from-emerald-500 to-teal-600"
          />
        </div>
      )}

      {/* Tabs de conteúdo */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Visão Geral
          </TabsTrigger>
          <TabsTrigger value="restock" className="gap-2">
            <ShoppingCart className="h-4 w-4" /> Reposição
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ClipboardCheck className="h-4 w-4" /> Contagem
          </TabsTrigger>
          {permissions.tasks?.view && (
            <TabsTrigger value="tasks" className="gap-2">
              <ListTodo className="h-4 w-4" /> Tarefas
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <ExpiringQuickView lots={lotsInKiosk} loading={lotsLoading} />
            <div className="space-y-4">
              <h2 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                Compras Urgentes
              </h2>
              <PurchaseAlertCard />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="restock" className="mt-6">
          <RestockPanel />
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <AuditDashboard />
        </TabsContent>

        {permissions.tasks?.view && (
          <TabsContent value="tasks" className="mt-6">
            <TaskManager />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
