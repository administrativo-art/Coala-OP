"use client"

import { useState } from 'react';
import { type Task } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Inbox, FileText, AlertCircle, History, CheckCircle2, ClipboardCheck, Truck, ShieldAlert, PackagePlus, Trash2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useTasks } from '@/hooks/use-tasks';

interface TaskListProps {
  tasks: Task[]; 
  onTaskSelect: (task: Task) => void;
}

const getStatusInfo = (status: Task['status']) => {
    switch (status) {
        case 'pending':
        case 'reopened':
            return { icon: AlertCircle, color: 'text-orange-500', label: status === 'reopened' ? 'Reaberta' : 'Pendente' };
        case 'in_progress':
            return { icon: AlertCircle, color: 'text-blue-500', label: 'Em progresso' };
        case 'awaiting_approval':
            return { icon: History, color: 'text-purple-500', label: 'Aguardando aprovação' };
        case 'completed':
            return { icon: CheckCircle2, color: 'text-green-600', label: 'Concluída' };
        case 'rejected':
            return { icon: AlertCircle, color: 'text-red-500', label: 'Rejeitada' };
        default:
            return { icon: AlertCircle, color: 'text-gray-500', label: 'Desconhecido' };
    }
}


export function TaskList({ tasks, onTaskSelect }: TaskListProps) {
  const router = useRouter();
  const { deleteTask } = useTasks();
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);

  const handleTaskClick = (task: Task) => {
    if (task.legacyLink) {
        router.push(task.legacyLink);
    } else {
        onTaskSelect(task);
    }
  };
  
  const handleDeleteConfirm = () => {
    if (taskToDelete) {
      deleteTask(taskToDelete.id);
      setTaskToDelete(null);
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed rounded-lg">
        <Inbox className="h-12 w-12 mb-4" />
        <p className="font-semibold">Nenhuma tarefa nesta categoria</p>
      </div>
    );
  }


  return (
    <>
    <div className="space-y-3">
      {tasks.map(task => {
        const { icon: StatusIcon, color: statusColor, label: statusLabel } = getStatusInfo(task.status);
        const createdAt = task.createdAt;
        const LegacyIcon = task.legacyIcon;

        return (
          <div
            key={task.id}
            className="border rounded-lg p-4 flex items-start gap-4 cursor-pointer hover:bg-muted/50 group"
            onClick={() => handleTaskClick(task)}
          >
            {LegacyIcon ? (
                 <LegacyIcon className={`h-6 w-6 mt-1 shrink-0 text-primary`} />
            ) : (
                 <StatusIcon className={`h-6 w-6 mt-1 shrink-0 ${statusColor}`} />
            )}
            <div className="flex-grow">
              <p className="font-semibold">{task.title}</p>
              <div className="text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:gap-4">
                  <span>Criada em: {format(parseISO(createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</span>
              </div>
              {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{statusLabel}</Badge>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); setTaskToDelete(task); }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
    <DeleteConfirmationDialog
        open={!!taskToDelete}
        onOpenChange={() => setTaskToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={`a tarefa "${taskToDelete?.title}"`}
        description="Esta ação é permanente e não pode ser desfeita."
      />
    </>
  );
}
