

"use client";

import React, { createContext, useContext, useMemo, useEffect } from 'react';
import { useAuth } from './use-auth';
import { useItemAddition } from './use-item-addition';
import { useStockCount } from './use-stock-count';
import { useReturnRequests } from './use-return-requests';
import { useReposition } from './use-reposition';
import { useStockAudit } from './use-stock-audit'; // Importar o hook de auditoria
import { useTasks } from './use-tasks';
import { format, parseISO } from 'date-fns';
import { returnRequestStatuses, type ReturnRequest, type Task } from '@/types';
import { PackagePlus, ClipboardCheck, ShieldAlert, Truck, ShieldCheck as AuditIcon, FileText, BookOpen } from 'lucide-react';
import { useAuthorBoardDiary } from './use-author-board-diary';

export interface LegacyTask {
  id: string;
  type: string;
  title: string;
  description: string;
  link: string;
  icon: React.FC<any>;
  createdAt?: string; // Optional for sorting
}

interface AllTasksContextType {
  legacyTasks: LegacyTask[];
  allTasks: Task[];
  formTasks: Task[];
  loading: boolean;
}

const AllTasksContext = createContext<AllTasksContextType>({
  legacyTasks: [],
  allTasks: [],
  formTasks: [],
  loading: true,
});

export const useAllTasks = () => useContext(AllTasksContext);

export const AllTasksProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, permissions, profiles, loading: authLoading } = useAuth();
  const { requests: itemAdditionRequests, loading: itemAdditionLoading } = useItemAddition();
  const { counts: stockCounts, loading: stockCountsLoading } = useStockCount();
  const { requests: returnRequests, loading: returnRequestsLoading } = useReturnRequests();
  const { activities: repositionActivities, loading: repositionLoading } = useReposition();
  const { auditSessions, loading: auditLoading } = useStockAudit();
  const { tasks: formTasks, loading: tasksLoading, addTask, updateTask: updateFormTask } = useTasks();
  const { logs, loading: diaryLoading } = useAuthorBoardDiary();

  const loading = authLoading || itemAdditionLoading || stockCountsLoading || returnRequestsLoading || repositionLoading || auditLoading || tasksLoading || diaryLoading;

  const legacyTasks = useMemo((): LegacyTask[] => {
    if (!user || !permissions || loading) return [];

    const tasks: LegacyTask[] = [];

    // Tarefa para auditorias pendentes
    if (permissions.audit.approve) {
        (auditSessions || []).filter(s => s.status === 'pending_review').forEach(s => {
            tasks.push({
                id: `audit-${s.id}`,
                type: 'Auditoria pendente',
                title: `Auditoria de estoque em ${s.kioskName}`,
                description: `Iniciada por ${s.auditedBy.username} em ${format(parseISO(s.startedAt), 'dd/MM/yyyy HH:mm')}`,
                link: '/dashboard/stock/audit/stock-audit',
                icon: AuditIcon,
                createdAt: s.startedAt
            })
        })
    }


    if (permissions.itemRequests.manage) {
      itemAdditionRequests.filter(req => req.status === 'pending').forEach(req => {
        tasks.push({
          id: `itemreq-${req.id}`,
          type: 'Cadastro de Insumo',
          title: `Solicitação: ${req.productName} ${req.brand ? `(${req.brand})` : ''}`,
          description: `Por ${req.requestedBy.username} em ${req.kioskName}`,
          link: '/dashboard/stock/count',
          icon: PackagePlus,
          createdAt: req.createdAt,
        });
      });
    }

    if (permissions.stockCount.approve) {
      stockCounts.filter(sc => sc.status === 'pending').forEach(sc => {
        tasks.push({
          id: `stockcount-${sc.id}`,
          type: 'Aprovação de contagem',
          title: `Contagem de ${sc.kioskName}`,
          description: `Enviada por ${sc.countedBy.username} em ${format(parseISO(sc.countedAt), 'dd/MM/yyyy HH:mm')}`,
          link: '/dashboard/stock/count',
          icon: ClipboardCheck,
          createdAt: sc.countedAt,
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
        type: 'Chamado de avaria',
        title: `${req.numero}: ${req.insumoNome}`,
        description: `Status: ${returnRequestStatuses[req.status]?.label || 'Desconhecido'}`,
        link: '/dashboard/stock/returns',
        icon: ShieldAlert,
        createdAt: req.createdAt,
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
            taskTitle = 'Gerenciar despacho';
          }
          break;
        case 'Aguardando recebimento':
          if (isMaster || user.assignedKioskIds.includes(act.kioskDestinationId)) {
            isVisible = true;
            taskTitle = 'Auditar recebimento';
          }
          break;
        case 'Recebido com divergência':
        case 'Recebido sem divergência':
          if (isMaster) {
            isVisible = true;
            taskTitle = 'Efetivar movimentação';
          }
          break;
      }

      if(isVisible) {
        tasks.push({
          id: `reposition-${act.id}`,
          type: 'Reposição de estoque',
          title: taskTitle,
          description: taskDesc,
          link: '/dashboard/stock/analysis/restock',
          icon: Truck,
          createdAt: act.createdAt,
        });
      }
    });

    return tasks.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

  }, [user, permissions, itemAdditionRequests, stockCounts, returnRequests, repositionActivities, auditSessions, loading]);
  
  const allTasks = useMemo(() => {
    // This will combine legacy and new tasks in the future.
    // For now, it just holds formTasks.
    return formTasks;
  }, [formTasks]);

  const value = {
    legacyTasks,
    allTasks,
    formTasks,
    loading
  };

  return <AllTasksContext.Provider value={value}>{children}</AllTasksContext.Provider>;
};
