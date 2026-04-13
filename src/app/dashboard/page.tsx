"use client"

import { useMemo, useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { GlassCard } from "@/components/ui/glass-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Box, Package, AlertTriangle, TrendingUp, Users, DollarSign, ListTodo, AreaChart, LayoutDashboard, ShieldCheck, Wifi, UserMinus, ShoppingCart, FileText } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { ScrollArea } from "@/components/ui/scroll-area"
import { type ProductSimulation } from "@/types"
import { cn } from "@/lib/utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PricingDashboard } from "@/components/pricing-dashboard"
import { useProductSimulation } from "@/hooks/use-product-simulation"
import { useCompanySettings } from "@/hooks/use-company-settings"
import { AuditDashboard } from "@/components/audit-dashboard"
import { useStockAudit } from "@/hooks/use-stock-audit"
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories"
import { useProducts } from "@/hooks/use-products"
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PurchaseAlertCard } from "@/components/purchase-alert-card"
import { TechnicalSheetDashboard } from "@/components/technical-sheet-dashboard"
import { TaskManager } from "@/components/task-manager"
import { RestockPanel } from "@/components/restock-panel"

interface OnlineUser {
    id: string;
    username: string;
    status: 'online' | 'offline';
    last_seen: Date;
}

function OnlineUsersPanel() {
    const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const q = query(
            collection(db, "userPresence"), 
            where("last_seen", ">", fiveMinutesAgo)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const users: OnlineUser[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.status === 'online') {
                    const lastSeen = (data.last_seen as Timestamp)?.toDate();
                    if (lastSeen) {
                        users.push({
                            id: doc.id,
                            username: data.username,
                            status: data.status,
                            last_seen: lastSeen,
                        });
                    }
                }
            });
            setOnlineUsers(users.sort((a,b) => a.username.localeCompare(b.username)));
        });

        const timer = setInterval(() => setNow(new Date()), 30 * 1000);

        return () => {
            unsubscribe();
            clearInterval(timer);
        };
    }, []);

    return (
        <Card className="lg:col-span-1">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wifi /> Usuários Online ({onlineUsers.length})</CardTitle>
                <CardDescription>
                    Usuários ativos no sistema nos últimos 5 minutos.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-48">
                    <div className="space-y-2 pr-4">
                        {onlineUsers.length > 0 ? onlineUsers.map(user => (
                             <div key={user.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                                 <div>
                                    <p className="font-semibold">{user.username}</p>
                                    <p className="text-sm text-muted-foreground">
                                        Visto por último: {format(user.last_seen, "'às' HH:mm", { locale: ptBR })}
                                    </p>
                                </div>
                                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                             </div>
                        )) : (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                <Users className="h-8 w-8 mb-2"/>
                                <p>Nenhum usuário online no momento.</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    )
}

function OperationalDashboard() {
  const { user, users, permissions } = useAuth()
  const { lots, loading: lotsLoading } = useExpiryProducts()
  
  const { isLoading: consumptionLoading } = useValidatedConsumptionData();
  
  const lotsInKiosk = useMemo(() => {
    if (lotsLoading || !user) return [];
    if (user.username === 'Tiago Brasil') return lots;
    return lots.filter(lot => user.assignedKioskIds.includes(lot.kioskId));
  }, [lots, user, lotsLoading]);

  const expiringSoonLots = useMemo(() => {
    if (lotsLoading) return [];
    return lotsInKiosk.filter(lot => {
        if (!lot.expiryDate) return false;
        const days = differenceInDays(parseISO(lot.expiryDate), new Date());
        return days >= 0 && days <= 7 && lot.quantity > 0;
    }).sort((a,b) => {
        if (!a.expiryDate || !b.expiryDate) return 0;
        return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    });
  }, [lotsInKiosk, lotsLoading]);

  const expiringSoonCount = useMemo(() => {
    return expiringSoonLots.length;
  }, [expiringSoonLots]);

  const expiredCount = useMemo(() => {
     if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => {
        if (!lot.expiryDate) return false;
        return differenceInDays(parseISO(lot.expiryDate), new Date()) < 0 && lot.quantity > 0;
    }).length;
  }, [lotsInKiosk, lotsLoading]);
  
  const initialLoading = lotsLoading || consumptionLoading;

  if (initialLoading) {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
            </div>
             <div className="mt-6">
                <Skeleton className="h-[400px] w-full" />
            </div>
        </div>
    )
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <Link href="/dashboard/stock/inventory-control" className="group">
        <GlassCard className="transition-all duration-300 hover:bg-muted/50 group-hover:-translate-y-px h-full border border-rose-500/50 bg-card rounded-xl">
          <CardHeader className="flex flex-col items-start justify-between space-y-0 p-5">
            <div className="text-3xl font-bold text-rose-500">{expiringSoonCount}</div>
            <CardTitle className="text-muted-foreground mt-2 text-sm font-medium">Vencendo em 7 dias</CardTitle>
          </CardHeader>
        </GlassCard>
        </Link>
        <Link href="/dashboard/stock/inventory-control" className="group">
        <GlassCard className="transition-all duration-300 hover:bg-muted/50 group-hover:-translate-y-px h-full border border-amber-500/50 bg-card rounded-xl">
          <CardHeader className="flex flex-col items-start justify-between space-y-0 p-5">
            <div className="text-3xl font-bold text-amber-500">{expiredCount}</div>
            <CardTitle className="text-muted-foreground mt-2 text-sm font-medium">Produtos vencidos</CardTitle>
          </CardHeader>
        </GlassCard>
        </Link>
      </div>

      <div className="space-y-4">
        <h2 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">Compras Urgentes</h2>
        <PurchaseAlertCard />
      </div>

<div className="space-y-4 mt-6">
        <div className="flex items-center gap-3">
             <h2 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">Painel de Reposição</h2>
             <Badge variant="outline" className="text-[10px] font-bold border-amber-500/50 text-amber-600 bg-amber-500/10 hover:bg-amber-500/20">Desatualizado</Badge>
         </div>
        <RestockPanel />
      </div>
    </>
  )
}

function PricingReportDashboard() {
  const { simulations, loading: loadingSimulations } = useProductSimulation();
  const { categories, loading: loadingCategories } = useProductSimulationCategories();
  const { pricingParameters, loading: loadingParams } = useCompanySettings();
  
  const [chartFilter, setChartFilter] = useState('all');
  
  const activeSimulations = useMemo(() => {
    return simulations;
  }, [simulations]);


  const getProfitColorClass = (percentage: number) => {
    if (!pricingParameters?.profitRanges) return 'text-primary';
    const sortedRanges = [...pricingParameters.profitRanges].sort((a, b) => a.from - b.from);
    for (const range of sortedRanges) {
      if (percentage >= range.from && (range.to === Infinity || percentage < range.to)) {
        return range.color;
      }
    }
    return 'text-primary';
  };

  const { kpis, profitChartData } = useMemo(() => {
    if (!activeSimulations || activeSimulations.length === 0) {
        return { kpis: {}, profitChartData: [] };
    }

    const filteredSimulations = activeSimulations.filter(s => {
        if (chartFilter === 'all') return true;
        const [type, id] = chartFilter.split(':');
        if (type === 'category') return s.categoryIds.includes(id);
        if (type === 'line') return s.lineId === id;
        return false;
    });

    const totalSimulations = activeSimulations.length;
    const totalProfitPercentage = filteredSimulations.reduce((acc, s) => acc + s.profitPercentage, 0);
    const averageProfitPercentage = filteredSimulations.length > 0 ? totalProfitPercentage / filteredSimulations.length : 0;

    const itemsWithGoal = filteredSimulations.filter(s => s.profitGoal != null && s.profitGoal > 0);
    const itemsMeetingGoal = itemsWithGoal.filter(s => s.profitPercentage >= s.profitGoal!);
    const itemsBelowGoal = itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!);

    let highestMarginItem: ProductSimulation | undefined = filteredSimulations[0];
    let lowestMarginItem: ProductSimulation | undefined = filteredSimulations[0];

    for (const s of filteredSimulations) {
        if (s.profitPercentage > (highestMarginItem?.profitPercentage || -Infinity)) highestMarginItem = s;
        if (s.profitPercentage < (lowestMarginItem?.profitPercentage || Infinity)) lowestMarginItem = s;
    }

    const totalMarkup = filteredSimulations.reduce((acc, s) => acc + s.markup, 0);

    const priceDeltas = itemsBelowGoal.map(s => {
        const priceForGoal = s.totalCmv / (1 - ((pricingParameters?.averageTaxPercentage || 0) / 100) - ((pricingParameters?.averageCardFeePercentage || 0) / 100) - (s.profitGoal! / 100));
        return priceForGoal - s.salePrice;
    });

    const averagePriceDelta = priceDeltas.length > 0 ? priceDeltas.reduce((acc, delta) => acc + delta, 0) / priceDeltas.length : 0;
    
    const categoryCounts: { [name: string]: number } = {};
    const lineCounts: { [name: string]: number } = {};

    activeSimulations.forEach(s => { 
        s.categoryIds.forEach(catId => {
            const category = categories.find(c => c.id === catId);
            if (category && category.type === 'category') {
                categoryCounts[category.name] = (categoryCounts[category.name] || 0) + 1;
            }
        });
        if (s.lineId) {
            const line = categories.find(c => c.id === s.lineId);
            if (line && line.type === 'line') {
                lineCounts[line.name] = (lineCounts[line.name] || 0) + 1;
            }
        }
    });

    const kpisResult = {
        totalSimulations,
        averageProfitPercentage,
        itemsMeetingGoal,
        itemsBelowGoal,
        highestMarginItem,
        lowestMarginItem,
        averageMarkup: filteredSimulations.length > 0 ? totalMarkup / filteredSimulations.length : 0,
        averagePriceDelta: averagePriceDelta,
        categoryCounts,
        lineCounts
    };

    const profitChartDataResult = filteredSimulations
        .map(s => ({
            id: s.id,
            name: s.name,
            'Lucro %': s.profitPercentage,
        }))
        .sort((a, b) => a['Lucro %'] - b['Lucro %']);

    return { kpis: kpisResult, profitChartData: profitChartDataResult };
}, [activeSimulations, categories, chartFilter, pricingParameters]);


  const activeFilters = {
    categoryName: null,
    lineName: null,
    profitGoalFilter: 'all',
    statusFilter: 'all'
  };

  return (
    <PricingDashboard 
      simulations={activeSimulations} 
      categories={categories}
      isLoading={loadingSimulations || loadingParams || loadingCategories}
      getProfitColorClass={getProfitColorClass}
      pricingParameters={pricingParameters}
      activeFilters={activeFilters}
      kpis={kpis}
      profitChartData={profitChartData}
      chartFilter={chartFilter}
      setChartFilter={setChartFilter}
    />
  );
}

export default function DashboardPage() {
    const { user, permissions } = useAuth();
    
    if (!permissions.dashboard.view) {
        return (
            <div className="flex items-center justify-center h-full">
                <GlassCard className="w-full max-w-md text-center">
                    <CardHeader>
                        <CardTitle>Acesso Negado</CardTitle>
                        <CardDescription>
                            Você não tem permissão para visualizar o dashboard. Entre em contato com um administrador.
                        </CardDescription>
                    </CardHeader>
                </GlassCard>
            </div>
        );
    }
    
    const getDefaultTab = () => {
        if (permissions.dashboard.operational) return 'operational';
        if (permissions.dashboard.pricing) return 'pricing';
        if (permissions.dashboard.technicalSheets) return 'technical-sheets';
        if (permissions.dashboard.audit) return 'audit';
        if (permissions.tasks.view) return 'tasks';
        return 'operational'; 
    }

    return (
        <div className="space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Bem-vindo, {user?.username}!</h1>
                <p className="text-muted-foreground">Aqui está um resumo das suas atividades e alertas.</p>
            </div>
            
            <Tabs defaultValue={getDefaultTab()} className="w-full">
                <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
                    {permissions.dashboard.operational && <TabsTrigger value="operational"><LayoutDashboard className="mr-2" /> Operacional</TabsTrigger>}
                    {permissions.dashboard.pricing && <TabsTrigger value="pricing"><DollarSign className="mr-2" /> Gestão de Preços</TabsTrigger>}
                    {permissions.dashboard.technicalSheets && <TabsTrigger value="technical-sheets"><FileText className="mr-2" /> Fichas Técnicas</TabsTrigger>}
                    {permissions.dashboard.audit && <TabsTrigger value="audit"><ShieldCheck className="mr-2" /> Contagem</TabsTrigger>}
                    {permissions.tasks.view && <TabsTrigger value="tasks"><ListTodo className="mr-2 h-4 w-4" /> Tarefas</TabsTrigger>}
                </TabsList>

                {permissions.dashboard.operational && (
                    <TabsContent value="operational" className="mt-6 space-y-6">
                        <OperationalDashboard />
                    </TabsContent>
                )}
                {permissions.dashboard.pricing && (
                    <TabsContent value="pricing" className="mt-6">
                        <PricingReportDashboard />
                    </TabsContent>
                )}
                {permissions.dashboard.technicalSheets && (
                    <TabsContent value="technical-sheets" className="mt-6">
                        <TechnicalSheetDashboard />
                    </TabsContent>
                )}
                 {permissions.dashboard.audit && (
                     <TabsContent value="audit" className="mt-6">
                        <AuditDashboard />
                    </TabsContent>
                )}
                 {permissions.tasks.view && (
                     <TabsContent value="tasks" className="mt-6">
                        <TaskManager />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
