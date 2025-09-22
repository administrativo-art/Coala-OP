
"use client";

import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './use-auth';
import { useTasks } from './use-tasks';
import { useReposition } from './use-reposition';
import { useReturnRequests } from './use-return-requests';
import { useStockCount } from './use-stock-count';
import { useItemAddition } from './use-item-addition';
import { ClipboardCheck, Truck, ShieldAlert, ListOrdered, PackagePlus } from 'lucide-react';
import { type Task } from '@/types';

export interface LegacyTask {
  id: string;
  type: string;
  title: string;
  description: string;
  link: string;
  icon: React.FC<any>;
}

interface AllTasksContextType {
  allTasks: Task[];
  legacyTasks: LegacyTask[]; 
  loading: boolean;
}

const AllTasksContext = createContext<AllTasksContextType>({
  allTasks: [],
  legacyTasks: [],
  loading: true,
});

export const useAllTasks = () => useContext(AllTasksContext);

export const AllTasksProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, permissions, loading: authLoading } = useAuth();
  const { tasks, loading: tasksLoading } = useTasks();
  const { activities: repositionActivities, loading: repositionLoading } = useReposition();
  const { requests: returnRequests, loading: returnsLoading } = useReturnRequests();
  const { counts, loading: countsLoading } = useStockCount();
  const { requests: itemAdditionRequests, loading: itemAdditionLoading } = useItemAddition();

  const loading = authLoading || tasksLoading || repositionLoading || returnsLoading || countsLoading || itemAdditionLoading;

  const allTasks: Task[] = useMemo(() => {
    if (loading || !user) return [];

    const myTasks = tasks.filter(task => {
      const isAssignee = (task.assigneeType === 'user' && task.assigneeId === user.id) || (task.assigneeType === 'profile' && task.assigneeId === user.profileId);
      const isApprover = (task.approverType === 'user' && task.approverId === user.id) || (task.approverType === 'profile' && task.approverId === user.profileId);
      const isPendingApproval = task.status === 'awaiting_approval';

      return (isPendingApproval && isApprover) || (!isPendingApproval && isAssignee);
    });

    return myTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [user, tasks, loading, permissions]);

  const legacyTasks: LegacyTask[] = useMemo(() => {
    if (loading || !user) return [];
    
    const allLegacyTasks: LegacyTask[] = [];

    if (permissions.stock.stockCount.approve) {
        counts.forEach(count => {
            if (count.status === 'pending') {
                allLegacyTasks.push({
                    id: `count-${count.id}`,
                    type: 'Contagem',
                    title: `Contagem de ${count.kioskName}`,
                    description: `Enviada por ${count.countedBy.username} com ${count.items.filter(i => i.difference !== 0).length} divergência(s).`,
                    link: '/dashboard/stock/count',
                    icon: ListOrdered
                });
            }
        });
    }

    repositionActivities.forEach(activity => {
        if (activity.status === 'Aguardando despacho' && user.username === 'Tiago Brasil') {
             allLegacyTasks.push({
                id: `dispatch-${activity.id}`,
                type: 'Reposição',
                title: 'Despacho Pendente',
                description: `Reposição de ${activity.kioskOriginName} para ${activity.kioskDestinationName}`,
                link: '/dashboard/stock/analysis/restock',
                icon: Truck
            });
        }
        if (activity.status === 'Aguardando recebimento' && activity.kioskDestinationId && user.assignedKioskIds.includes(activity.kioskDestinationId)) {
             allLegacyTasks.push({
                id: `receipt-${activity.id}`,
                type: 'Reposição',
                title: 'Recebimento Pendente',
                description: `Itens enviados de ${activity.kioskOriginName} para ${activity.kioskDestinationName}`,
                link: '/dashboard/stock/analysis/restock',
                icon: ClipboardCheck
            });
        }
         if ((activity.status === 'Recebido com divergência' || activity.status === 'Recebido sem divergência') && permissions.stock.audit.approve) {
             allLegacyTasks.push({
                id: `finalize-${activity.id}`,
                type: 'Reposição',
                title: 'Efetivação Pendente',
                description: `Auditoria da reposição para ${activity.kioskDestinationName} precisa ser efetivada.`,
                link: '/dashboard/stock/analysis/restock',
                icon: ClipboardCheck
            });
        }
    });

    if (permissions.stock.returns.updateStatus) {
        returnRequests.forEach(request => {
            if (request.status === 'em_andamento') {
                allLegacyTasks.push({
                    id: `return-${request.id}`,
                    type: 'Avaria',
                    title: `Chamado ${request.numero}`,
                    description: `${request.tipo} de ${request.insumoNome}`,
                    link: '/dashboard/stock/returns',
                    icon: ShieldAlert
                });
            }
        });
    }

    if (permissions.itemRequests?.approve) {
      itemAdditionRequests.forEach(req => {
        if (req.status === 'pending') {
          allLegacyTasks.push({
            id: `item-request-${req.id}`,
            type: 'Cadastro',
            title: `Solicitação de cadastro de insumo`,
            description: `Enviada por ${req.requestedBy.username} para o quiosque ${req.kioskName}.`,
            link: '/dashboard/stock/count',
            icon: PackagePlus,
          });
        }
      });
    }
    
    return allLegacyTasks;
  }, [user, permissions, counts, repositionActivities, returnRequests, itemAdditionRequests, loading]);
  
  const value = {
    allTasks,
    legacyTasks,
    loading
  };

  return <AllTasksContext.Provider value={value}>{children}</AllTasksContext.Provider>;
};
