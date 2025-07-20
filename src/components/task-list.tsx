
"use client"

import { type Task } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Inbox, FileText, AlertCircle, History, CheckCircle2, ClipboardCheck, Truck, ShieldAlert, PackagePlus } from 'lucide-react';
import { Badge } from './ui/badge';
import { useForm } from '@/hooks/use-form';
import { useRouter } from 'next/navigation';

interface TaskListProps {
  tasks: (Task | any)[]; // Using any to accommodate legacy tasks
  onTaskSelect: (task: Task) => void;
}

const getStatusInfo = (status: Task['status']) => {
    switch (status) {
        case 'pending':
        case 'reopened':
            return { icon: AlertCircle, color: 'text-orange-500', label: status === 'reopened' ? 'Reaberta' : 'Pendente' };
        case 'in_progress':
            return { icon: AlertCircle, color: 'text-blue-500', label: 'Em Progresso' };
        case 'awaiting_approval':
            return { icon: History, color: 'text-purple-500', label: 'Aguardando Aprovação' };
        case 'completed':
            return { icon: CheckCircle2, color: 'text-green-600', label: 'Concluída' };
        case 'rejected':
            return { icon: AlertCircle, color: 'text-red-500', label: 'Rejeitada' };
        default:
            return { icon: AlertCircle, color: 'text-gray-500', label: 'Desconhecido' };
    }
}

const getLegacyIcon = (type: string) => {
    switch (type) {
        case 'Cadastro de Insumo': return PackagePlus;
        case 'Aprovação de contagem': return ClipboardCheck;
        case 'Chamado de avaria': return ShieldAlert;
        case 'Reposição de estoque': return Truck;
        default: return AlertCircle;
    }
}


export function TaskList({ tasks, onTaskSelect }: TaskListProps) {
  const { submissions } = useForm();
  const router = useRouter();
  
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed rounded-lg">
        <Inbox className="h-12 w-12 mb-4" />
        <p className="font-semibold">Nenhuma tarefa nesta categoria</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map(task => {
        // This is a type guard to check if it's a new Task object
        const isNewTask = 'origin' in task;
        
        const handleClick = () => {
            if (isNewTask) {
                onTaskSelect(task);
            } else {
                router.push(task.link);
            }
        };

        let StatusIcon, statusColor, statusLabel, createdAt;

        if (isNewTask) {
            const statusInfo = getStatusInfo(task.status);
            StatusIcon = statusInfo.icon;
            statusColor = statusInfo.color;
            statusLabel = statusInfo.label;
            createdAt = task.createdAt;
        } else {
            // Legacy task handling
            StatusIcon = getLegacyIcon(task.type);
            statusColor = 'text-orange-500';
            statusLabel = 'Pendente';
            createdAt = new Date().toISOString(); // Placeholder as legacy tasks don't have a consistent createdAt
        }

        const submission = isNewTask ? submissions.find(s => s.id === task.origin.submissionId) : null;

        return (
          <div
            key={task.id}
            className="border rounded-lg p-4 flex items-start gap-4 cursor-pointer hover:bg-muted/50"
            onClick={handleClick}
          >
            <StatusIcon className={`h-6 w-6 mt-1 shrink-0 ${statusColor}`} />
            <div className="flex-grow">
              <p className="font-semibold">{task.title}</p>
              <div className="text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:gap-4">
                  {isNewTask ? (
                      <>
                        <span>Criada em: {format(parseISO(createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</span>
                        {submission && 
                            <span className="flex items-center gap-1">
                                <FileText className="h-3 w-3"/> Origem: {submission.templateName}
                            </span>
                        }
                      </>
                  ) : (
                    <span>{task.description}</span>
                  )}
              </div>
            </div>
            <Badge variant="outline">{isNewTask ? statusLabel : task.type}</Badge>
          </div>
        )
      })}
    </div>
  );
}
