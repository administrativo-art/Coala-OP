
"use client"

import { useMemo, useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useReturnRequests } from "@/hooks/use-return-requests"
import { useMonthlySchedule } from "@/hooks/use-monthly-schedule"
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"
import { useItemAddition } from "@/hooks/use-item-addition"
import { useStockCount } from "@/hooks/use-stock-count"
import { useReposition } from "@/hooks/use-reposition"

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Box, Package, AlertTriangle, TrendingUp, ListFilter, Truck, Users, Download, Inbox, ListTodo, ClipboardCheck, PackagePlus, ShieldAlert, TruckForward } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { type ReturnRequest, returnRequestStatuses } from "@/types"
import { cn } from "@/lib/utils"
import { AverageConsumptionChart } from "@/components/average-consumption-chart"


export default function DashboardPage() {
  const { user, permissions } = useAuth()
  const { lots, loading: lotsLoading } = useExpiryProducts()
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { requests: returnRequests, loading: returnRequestsLoading } = useReturnRequests();
  const { schedule, loading: scheduleLoading } = useMonthlySchedule();
  const { requests: itemAdditionRequests, loading: itemAdditionLoading } = useItemAddition();
  const { counts: stockCounts, loading: stockCountsLoading } = useStockCount();
  const { activities: repositionActivities, loading: repositionLoading } = useReposition();
  
  const { isLoading: consumptionLoading } = useValidatedConsumptionData();
  
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

  const myTasks = useMemo(() => {
    if (!user || !permissions) return [];

    const tasks: { id: string, type: string; title: string; description: string; link: string, icon: React.FC<any> }[] = [];

    // 1. Solicitações de Cadastro de Novo Insumo
    if (permissions.itemRequests.manage) {
      itemAdditionRequests.filter(req => req.status === 'pending').forEach(req => {
        tasks.push({
          id: `itemreq-${req.id}`,
          type: 'Cadastro de Insumo',
          title: `Solicitação: ${req.productName} ${req.brand ? `(${req.brand})` : ''}`,
          description: `Por ${req.requestedBy.username} em ${req.kioskName}`,
          link: '/dashboard/stock/count',
          icon: PackagePlus,
        });
      });
    }

    // 2. Contagens de Estoque para Aprovação
    if (permissions.stockCount.approve) {
      stockCounts.filter(sc => sc.status === 'pending').forEach(sc => {
        tasks.push({
          id: `stockcount-${sc.id}`,
          type: 'Aprovação de Contagem',
          title: `Contagem de ${sc.kioskName}`,
          description: `Enviada por ${sc.countedBy.username} em ${format(parseISO(sc.countedAt), 'dd/MM/yyyy HH:mm')}`,
          link: '/dashboard/stock/count',
          icon: ClipboardCheck,
        });
      });
    }

    // 3. Chamados de Avaria
    const activeReturnRequests = returnRequests.filter(r => !r.isArchived);
    const myReturnRequests = (permissions.returns.updateStatus || user.username === 'Tiago Brasil')
      ? activeReturnRequests
      : activeReturnRequests.filter(r => r.createdBy.userId === user.id);
      
    myReturnRequests.forEach(req => {
      tasks.push({
        id: `return-${req.id}`,
        type: 'Chamado de Avaria',
        title: `${req.numero}: ${req.insumoNome}`,
        description: `Status: ${returnRequestStatuses[req.status]?.label || 'Desconhecido'}`,
        link: '/dashboard/stock/returns',
        icon: ShieldAlert,
      });
    });

    // 4. Atividades de Reposição
    const isMaster = user.username === 'Tiago Brasil';
    repositionActivities.filter(act => act.status !== 'Concluído').forEach(act => {
      let isVisible = false;
      let taskTitle = '';
      let taskDesc = `De ${act.kioskOriginName} para ${act.kioskDestinationName}`;
      
      switch (act.status) {
        case 'Aguardando despacho':
          if (isMaster || user.assignedKioskIds.includes(act.kioskOriginId)) {
            isVisible = true;
            taskTitle = 'Gerenciar Despacho';
          }
          break;
        case 'Aguardando recebimento':
          if (isMaster || user.assignedKioskIds.includes(act.kioskDestinationId)) {
            isVisible = true;
            taskTitle = 'Auditar Recebimento';
          }
          break;
        case 'Recebido com divergência':
        case 'Recebido sem divergência':
          if (isMaster) {
            isVisible = true;
            taskTitle = 'Efetivar Movimentação';
          }
          break;
      }

      if(isVisible) {
        tasks.push({
          id: `reposition-${act.id}`,
          type: 'Reposição de Estoque',
          title: taskTitle,
          description: taskDesc,
          link: '/dashboard/stock/analysis/restock',
          icon: Truck,
        });
      }
    });

    return tasks;
  }, [user, permissions, itemAdditionRequests, stockCounts, returnRequests, repositionActivities]);

  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const todaySchedule = useMemo(() => schedule.find(s => s.id === todayISO), [schedule, todayISO]);
  const kiosksToDisplay = useMemo(() => kiosks.filter(k => k.id !== 'matriz'), [kiosks]);

  const initialLoading = lotsLoading || kiosksLoading || returnRequestsLoading || scheduleLoading || consumptionLoading || itemAdditionLoading || stockCountsLoading || repositionLoading;

  if (initialLoading) {
    return (
        <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-5 w-96 mb-6" />
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

  const sortedKiosks = kiosks.sort((a,b) => {
    if (a.id === 'matriz') return -1;
    if (b.id === 'matriz') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
       <div className="mb-6">
        <h1 className="text-3xl font-bold">Bem-vindo, {user?.username}!</h1>
        <p className="text-muted-foreground">Aqui está um resumo das suas atividades e alertas.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencendo em 7 dias</CardTitle>
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-yellow-500">{expiringSoonCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos vencidos</CardTitle>
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-destructive">{expiredCount}</div>
          </CardContent>
        </Card>
      </div>
      
       {myTasks.length > 0 && (
          <Card className="lg:col-span-2">
              <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                      <ListTodo className="h-6 w-6" /> Minhas Tarefas ({myTasks.length})
                  </CardTitle>
                  <CardDescription>
                      Estas são as atividades pendentes que precisam da sua atenção.
                  </CardDescription>
              </CardHeader>
              <CardContent>
                  <ScrollArea className="h-60">
                    <div className="space-y-2 pr-4">
                        {myTasks.map(task => {
                            const Icon = task.icon;
                            return (
                                <Link href={task.link} key={task.id}>
                                    <div className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <Icon className="h-5 w-5 text-primary shrink-0" />
                                            <div>
                                                <p className="font-semibold">{task.title}</p>
                                                <p className="text-sm text-muted-foreground">{task.description}</p>
                                            </div>
                                        </div>
                                        <Badge variant="secondary" className="shrink-0">{task.type}</Badge>
                                    </div>
                                </Link>
                            )
                        })}
                    </div>
                  </ScrollArea>
              </CardContent>
          </Card>
        )}

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
                          {expiringSoonLots.map(lot => (
                              <Link href="/dashboard/stock/inventory-control" key={lot.id}>
                              <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                                  <div>
                                      <p className="font-semibold">{lot.productName}</p>
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
                          ))}
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
                            const isSunday = todaySchedule.diaDaSemana.toLowerCase().includes('domingo');
                            const hasSchedule = t1 || t2 || t3 || folga;

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
                                        <AccordionTrigger className="p-3 hover:no-underline font-semibold text-base">
                                            {kiosk.name}
                                        </AccordionTrigger>
                                        <AccordionContent className="p-3 pt-0">
                                            <div className="text-sm mt-2 space-y-1">
                                                {isSunday ? (
                                                    t1 && <p><strong>Turno Único:</strong> {t1}</p>
                                                ) : (
                                                    <>
                                                        {t1 && <p><strong>T1:</strong> {t1}</p>}
                                                        {t2 && <p><strong>T2:</strong> {t2}</p>}
                                                        {t3 && <p><strong>T3:</strong> {t3}</p>}
                                                    </>
                                                )}
                                                {folga && <p className="text-muted-foreground"><strong>Folga:</strong> {folga}</p>}
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
      </div>
      
      <AverageConsumptionChart />

    </div>
  )
}
