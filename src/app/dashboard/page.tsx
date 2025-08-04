

"use client"

import { useMemo, useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useMonthlySchedule } from "@/hooks/use-monthly-schedule"
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Box, Package, AlertTriangle, TrendingUp, Edit, Users, DollarSign, ListTodo, AreaChart, LayoutDashboard, ShieldCheck, Wifi, UserMinus } from 'lucide-react'
import { differenceInDays, parseISO, formatDistanceToNow } from 'date-fns'
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { ScrollArea } from "@/components/ui/scroll-area"
import { type DailySchedule, type ProductSimulation, type AbsenceEntry } from "@/types"
import { cn } from "@/lib/utils"
import { AverageConsumptionChart } from "@/components/average-consumption-chart"
import { EditScheduleModal } from "@/components/edit-schedule-modal"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PricingDashboard } from "@/components/pricing-dashboard"
import { useProductSimulation } from "@/hooks/use-product-simulation"
import { useCompanySettings } from "@/hooks/use-company-settings"
import { AuditDashboard } from "@/components/audit-dashboard"
import { useStockAudit } from "@/hooks/use-stock-audit"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { PendingTasksDashboard } from "@/components/pending-tasks-dashboard"
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories"
import { useProducts } from "@/hooks/use-products"
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

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

        // Update 'now' every 30 seconds to refresh the 'time ago' display
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
                                        Visto por último: {formatDistanceToNow(user.last_seen, { locale: ptBR, addSuffix: true })}
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
  const { getProductFullName, products } = useProducts();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { schedule, loading: scheduleLoading } = useMonthlySchedule();
  
  const [dayToEdit, setDayToEdit] = useState<DailySchedule | null>(null);
  const [kioskToEdit, setKioskToEdit] = useState<string | null>(null);

  const { isLoading: consumptionLoading } = useValidatedConsumptionData();
  
  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todaySchedule = useMemo(() => schedule.find(s => s.id === todayISO), [schedule, todayISO]);

  const lotsInKiosk = useMemo(() => {
    if (lotsLoading || !user) return [];
    if (user.username === 'Tiago Brasil') return lots;
    return lots.filter(lot => user.assignedKioskIds.includes(lot.kioskId));
  }, [lots, user, lotsLoading]);

  const expiringSoonLots = useMemo(() => {
    if (lotsLoading) return [];
    return lotsInKiosk.filter(lot => {
        const days = differenceInDays(parseISO(lot.expiryDate), new Date());
        return days >= 0 && days <= 7 && lot.quantity > 0;
    }).sort((a,b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }, [lotsInKiosk, lotsLoading]);

  const expiringSoonCount = useMemo(() => {
    return expiringSoonLots.length;
  }, [expiringSoonLots]);

  const expiredCount = useMemo(() => {
     if (lotsLoading) return 0;
    return lotsInKiosk.filter(lot => differenceInDays(parseISO(lot.expiryDate), new Date()) < 0 && lot.quantity > 0).length;
  }, [lotsInKiosk, lotsLoading]);

  const kiosksToDisplay = useMemo(() => kiosks.sort((a, b) => {
      if (a.id === 'matriz') return -1;
      if (b.id === 'matriz') return 1;
      return a.name.localeCompare(b.name);
  }), [kiosks]);
  
  const handleEditDay = (dayData: DailySchedule, kioskId: string) => {
    setDayToEdit(dayData);
    setKioskToEdit(kioskId);
  };
  
  const handleCloseModal = (open: boolean) => {
    if (!open) {
      setDayToEdit(null);
      setKioskToEdit(null);
    }
  };

  const initialLoading = lotsLoading || kiosksLoading || scheduleLoading || consumptionLoading;

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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/dashboard/stock/inventory-control">
        <Card className="hover:bg-muted/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencendo em 7 dias</CardTitle>
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-yellow-500">{expiringSoonCount}</div>
          </CardContent>
        </Card>
        </Link>
        <Link href="/dashboard/stock/inventory-control">
        <Card className="hover:bg-muted/50 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos vencidos</CardTitle>
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-destructive">{expiredCount}</div>
          </CardContent>
        </Card>
        </Link>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {expiringSoonLots.length > 0 && (
            <Card className="lg:col-span-1">
                <CardHeader>
                    <CardTitle>Insumos vencendo em breve</CardTitle>
                    <CardDescription>
                        Estes são os insumos que vencerão nos próximos 7 dias.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-48">
                      <div className="space-y-2 pr-4">
                          {expiringSoonLots.map(lot => {
                              const product = products.find(p => p.id === lot.productId);
                              return (
                              <Link href="/dashboard/stock/inventory-control" key={lot.id}>
                              <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                                  <div>
                                      <p className="font-semibold">{product ? getProductFullName(product) : lot.productName}</p>
                                      <p className="text-sm text-muted-foreground">
                                          Lote: {lot.lotNumber} | Quiosque: {kiosks.find(k => k.id === lot.kioskId)?.name || 'N/A'}
                                      </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="font-bold text-lg">{lot.quantity} un.</p>
                                    <p className="text-xs text-muted-foreground">
                                      Vence em: {format(parseISO(lot.expiryDate), "dd/MM/yyyy")}
                                    </p>
                                  </div>
                              </div>
                              </Link>
                          )})}
                      </div>
                    </ScrollArea>
                </CardContent>
            </Card>
      )}

        <Card className={cn("lg:col-span-1", expiringSoonLots.length === 0 && "lg:col-span-2")}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Users className="h-6 w-6" /> Escala de hoje - {format(new Date(), "dd 'de' MMMM", { locale: ptBR })}
                </CardTitle>
                <CardDescription>
                    Resumo da escala de trabalho para o dia atual.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 {scheduleLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </div>
                ) : todaySchedule ? (
                    <Accordion type="multiple" className="w-full space-y-2">
                        {kiosksToDisplay.map(kiosk => {
                            const t1 = todaySchedule[`${kiosk.name} T1`];
                            const t2 = todaySchedule[`${kiosk.name} T2`];
                            const t3 = todaySchedule[`${kiosk.name} T3`];
                            const folga = todaySchedule[`${kiosk.name} Folga`];
                            const ausencias = (todaySchedule[`${kiosk.name} Ausencia`] || []) as AbsenceEntry[];
                            const isSunday = todaySchedule.diaDaSemana.toLowerCase().includes('domingo');
                            const hasSchedule = t1 || t2 || t3 || folga || ausencias.length > 0;

                            if (!hasSchedule) {
                                return (
                                    <div key={kiosk.id} className="p-3 border rounded-lg bg-muted/50 text-sm">
                                        <h4 className="font-semibold">{kiosk.name}</h4>
                                        <p className="mt-2 text-muted-foreground">Sem escala para hoje.</p>
                                    </div>
                                )
                            }
                            
                            return (
                                <AccordionItem value={kiosk.id} key={kiosk.id} className="border-b-0">
                                    <Card>
                                        <div className="flex items-center pr-2">
                                            <AccordionTrigger className="p-3 hover:no-underline flex-1 font-semibold text-base">
                                                {kiosk.name}
                                            </AccordionTrigger>
                                            {permissions.team.manage && (
                                              <Button variant="ghost" size="icon" onClick={() => handleEditDay(todaySchedule, kiosk.id)}>
                                                  <Edit className="h-4 w-4 text-muted-foreground" />
                                              </Button>
                                            )}
                                        </div>
                                        <AccordionContent className="p-3 pt-0">
                                            <div className="text-sm mt-2 space-y-1">
                                                {isSunday ? (
                                                    t1 && <p><strong>Turno único:</strong> {t1}</p>
                                                ) : (
                                                    <>
                                                        {t1 && <p><strong>T1:</strong> {t1}</p>}
                                                        {t2 && <p><strong>T2:</strong> {t2}</p>}
                                                        {t3 && <p><strong>T3:</strong> {t3}</p>}
                                                    </>
                                                )}
                                                {folga && <p className="text-muted-foreground"><strong>Folga:</strong> {folga}</p>}
                                                {ausencias.length > 0 && (
                                                    <div className="pt-2 mt-2 border-t border-dashed">
                                                        {ausencias.map(a => {
                                                            const employee = users.find(u => u.id === a.userId);
                                                            return (
                                                                <p key={a.userId} className="text-red-500 flex items-center gap-2">
                                                                    <UserMinus className="h-4 w-4"/>
                                                                    <strong>Ausente:</strong> {employee?.username} ({a.reason})
                                                                </p>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            )
                        })}
                    </Accordion>
                ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground text-center py-4">
                        <Users className="h-10 w-10 mb-2" />
                        <p className="font-semibold">Nenhuma escala encontrada para hoje.</p>
                    </div>
                )}
            </CardContent>
        </Card>
        
        { user?.username === 'Tiago Brasil' && <OnlineUsersPanel /> }
        
      </div>
      
      <AverageConsumptionChart />

      <EditScheduleModal 
          dayData={dayToEdit}
          kioskId={kioskToEdit}
          onOpenChange={handleCloseModal}
          users={users}
      />
    </>
  )
}

function PricingReportDashboard() {
  const { simulations, loading: loadingSimulations } = useProductSimulation();
  const { categories, loading: loadingCategories } = useProductSimulationCategories();
  const { pricingParameters, loading: loadingParams } = useCompanySettings();
  
  const [chartFilter, setChartFilter] = useState('all');

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
    if (!simulations || simulations.length === 0) {
        return { kpis: {}, profitChartData: [] };
    }

    const filteredSimulations = simulations.filter(s => {
        if (chartFilter === 'all') return true;
        const [type, id] = chartFilter.split(':');
        if (type === 'category') return s.categoryIds.includes(id);
        if (type === 'line') return s.lineId === id;
        return false;
    });

    const totalSimulations = simulations.length;
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
        const priceForGoal = s.grossCost / (1 - (s.profitGoal! / 100));
        return priceForGoal - s.salePrice;
    });

    const averagePriceDelta = priceDeltas.length > 0 ? priceDeltas.reduce((acc, delta) => acc + delta, 0) / priceDeltas.length : 0;
    
    const categoryCounts: { [name: string]: number } = {};
    const lineCounts: { [name: string]: number } = {};

    simulations.forEach(s => { // Count from all simulations, not just filtered ones
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
}, [simulations, categories, chartFilter]);


  const activeFilters = {
    categoryName: null,
    lineName: null,
    profitGoalFilter: 'all',
    statusFilter: 'all'
  };

  return (
    <PricingDashboard 
      simulations={simulations} 
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
    const canAuditStock = permissions.audit.start || permissions.audit.approve;
    
    return (
        <div className="space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Bem-vindo, {user?.username}!</h1>
                <p className="text-muted-foreground">Aqui está um resumo das suas atividades e alertas.</p>
            </div>
            
            <Tabs defaultValue="operational" className="w-full">
                <TabsList className="grid w-full grid-cols-2 md:grid-cols-3">
                    <TabsTrigger value="operational"><LayoutDashboard className="mr-2" /> Operacional</TabsTrigger>
                    <TabsTrigger value="pricing"><DollarSign className="mr-2" /> Custo e Preço</TabsTrigger>
                    {canAuditStock && <TabsTrigger value="audit"><ShieldCheck className="mr-2" /> Auditoria</TabsTrigger>}
                </TabsList>
                <TabsContent value="operational" className="mt-6 space-y-6">
                    <OperationalDashboard />
                </TabsContent>
                <TabsContent value="pricing" className="mt-6">
                    <PricingReportDashboard />
                </TabsContent>
                {canAuditStock && (
                     <TabsContent value="audit" className="mt-6">
                        <AuditDashboard />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
