
"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Undo2, PackagePlus, ClipboardCheck, ShieldAlert, Truck } from 'lucide-react';
import { useItemAddition } from '@/hooks/use-item-addition';
import { useStockCount } from '@/hooks/use-stock-count';
import { useReturnRequests } from '@/hooks/use-return-requests';
import { useReposition } from '@/hooks/use-reposition';
import { format, parseISO } from 'date-fns';
import { returnRequestStatuses, type ReturnRequest } from '@/types';
import { DebugPanel } from '@/components/debug-panel';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isAuthenticated, loading, originalUser, stopImpersonating, permissions } = useAuth();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [dataLoadTime, setDataLoadTime] = useState<number | null>(null);

  const { requests: itemAdditionRequests, loading: itemAdditionLoading } = useItemAddition();
  const { counts: stockCounts, loading: stockCountsLoading } = useStockCount();
  const { requests: returnRequests, loading: returnRequestsLoading } = useReturnRequests();
  const { activities: repositionActivities, loading: repositionLoading } = useReposition();

  useEffect(() => {
    const startTime = performance.now();
    if (!loading) {
      const endTime = performance.now();
      setDataLoadTime(endTime - startTime);
      if (!isAuthenticated) {
        router.push('/login');
      }
    }
  }, [isAuthenticated, loading, router]);

   const myTasks = useMemo(() => {
    if (!user || !permissions || itemAdditionLoading || stockCountsLoading || returnRequestsLoading || repositionLoading) return [];

    const tasks: { id: string, type: string; title: string; description: string; link: string, icon: React.FC<any> }[] = [];

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
  }, [user, permissions, itemAdditionRequests, stockCounts, returnRequests, repositionActivities, itemAdditionLoading, stockCountsLoading, returnRequestsLoading, repositionLoading]);


  if (loading || !isAuthenticated) {
    return (
      <div className="flex h-screen w-full">
         <div className="hidden border-r bg-muted/40 md:block w-[280px]">
            <div className="flex h-full max-h-screen flex-col">
                 <div className="flex h-14 items-center justify-center border-b px-4 lg:h-[60px]">
                    <Skeleton className="h-8 w-40" />
                 </div>
                 <div className="flex-1 p-4 space-y-4">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                 </div>
            </div>
         </div>
        <div className="flex flex-col flex-1">
            <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
                <Skeleton className="h-8 w-8 rounded-full md:hidden" />
                <div className="w-full flex-1"></div>
                <Skeleton className="h-8 w-8 rounded-full" />
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
            </main>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("grid min-h-screen w-full", isCollapsed ? "md:grid-cols-[80px_1fr]" : "md:grid-cols-[280px_1fr]")}>
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <div className="flex flex-col min-w-0">
        <Header tasks={myTasks} />
        {originalUser && (
          <div className="flex items-center justify-center gap-4 bg-yellow-400 text-black font-bold text-center py-2 px-4 shadow-md">
            <span>Você está navegando como <strong>{user?.username}</strong>.</span>
            <Button variant="ghost" className="h-auto p-0 underline text-black hover:bg-yellow-400/50 hover:text-black" onClick={stopImpersonating}>
              <Undo2 className="mr-1 h-4 w-4"/>
              Voltar para sua conta
            </Button>
          </div>
        )}
        <main className="p-4 lg:p-6 bg-background">
          {children}
        </main>
      </div>
      {process.env.NODE_ENV === 'development' && <DebugPanel dataLoadTime={dataLoadTime} />}
    </div>
  )
}
