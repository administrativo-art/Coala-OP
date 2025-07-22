"use client"

import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Task, type TaskHistoryItem } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { History, User, Check, X, Send, UserCheck, MessageSquare, AlertTriangle, ListTodo, FileText, Calendar as CalendarIcon, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTasks } from '@/hooks/use-tasks';
import { useForm as useSubmissionHook } from '@/hooks/use-form';
import { Textarea } from './ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ViewSubmissionModal } from './view-submission-modal';

interface TaskDetailModalProps {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}

const getStatusInfo = (status: Task['status']) => {
    switch (status) {
        case 'pending':
            return { label: 'Pendente', color: 'bg-orange-500 text-white' };
        case 'reopened':
            return { label: 'Reaberta', color: 'bg-orange-600 text-white' };
        case 'in_progress':
            return { label: 'Em progresso', color: 'bg-blue-500 text-white' };
        case 'awaiting_approval':
            return { label: 'Aguardando aprovação', color: 'bg-purple-500 text-white' };
        case 'completed':
            return { label: 'Concluída', color: 'bg-green-600 text-white' };
        case 'rejected':
            return { label: 'Rejeitada', color: 'bg-red-600 text-white' };
        default:
            return { label: 'Desconhecido', color: 'bg-gray-400 text-white' };
    }
}

export function TaskDetailModal({ task, onOpenChange }: TaskDetailModalProps) {
  const { user, users, profiles } = useAuth();
  const { updateTask } = useTasks();
  const { submissions, updateSubmission } = useSubmissionHook();
  const [rejectionNotes, setRejectionNotes] = useState('');
  const { toast } = useToast();

  const handleClose = () => {
    setRejectionNotes('');
    onOpenChange(false);
  }
  
  const getAssigneeName = (type: 'user' | 'profile', id: string) => {
    if (type === 'user') return users.find(u => u.id === id)?.username || 'Usuário desconhecido';
    return profiles.find(p => p.id === id)?.name || 'Perfil desconhecido';
  };

  const isMyTurn = useMemo(() => {
    if (!task || !user) return false;
    const { status, assigneeType, assigneeId, approverType, approverId } = task;

    if (status === 'awaiting_approval') {
        if (approverType === 'user' && approverId === user.id) return true;
        if (approverType === 'profile' && user.profileId === approverId) return true;
    } else {
        if (assigneeType === 'user' && assigneeId === user.id) return true;
        if (assigneeType === 'profile' && user.profileId === assigneeId) return true;
    }
    return false;
  }, [task, user, users, profiles]);

  const submission = useMemo(() => {
      if (!task) return null;
      return submissions.find(s => s.id === task.origin.submissionId);
  }, [task, submissions]);

  const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);

  if (!task) return null;

  const { label: statusLabel, color: statusColor } = getStatusInfo(task.status);
  
  const addHistoryItem = (action: string, details?: string): TaskHistoryItem => ({
      timestamp: new Date().toISOString(),
      author: { id: user!.id, name: user!.username },
      action,
      details,
  });
  
  const handleMarkAsComplete = async () => {
      const now = new Date().toISOString();
      const newHistory = [...task.history, addHistoryItem('completed')];
      const newStatus = task.requiresApproval ? 'awaiting_approval' : 'completed';
      
      const updatePayload: Partial<Task> = { status: newStatus, history: newHistory, updatedAt: now };
      if (newStatus === 'completed') {
        updatePayload.completedAt = now;
        await updateSubmission(task.origin.submissionId, { status: 'completed' });
      }

      await updateTask(task.id, updatePayload);
      handleClose();
  };

  const handleApprove = async () => {
      const now = new Date().toISOString();
      const newHistory = [...task.history, addHistoryItem('approved')];
      await updateTask(task.id, { status: 'completed', history: newHistory, completedAt: now, updatedAt: now });
      await updateSubmission(task.origin.submissionId, { status: 'completed' });
      handleClose();
  };
  
  const handleReject = async () => {
      if (!rejectionNotes) {
          toast({ variant: 'destructive', title: 'Justificativa obrigatória' });
          return;
      }
      const now = new Date().toISOString();
      const newHistory = [...task.history, addHistoryItem('rejected', rejectionNotes)];
      await updateTask(task.id, { status: 'reopened', history: newHistory, completedAt: undefined, updatedAt: now });
      handleClose();
  };
  
  return (
    <>
    <Dialog open={!!task} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="flex items-center gap-2"><ListTodo/> {task.title}</DialogTitle>
              <DialogDescription>
                  <p>Última atualização: {format(parseISO(task.updatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
              </DialogDescription>
            </div>
            <Badge className={statusColor}>{statusLabel}</Badge>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto pr-4 -mr-4">
          <div className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 border rounded-lg space-y-1">
                      <h4 className="text-sm font-semibold flex items-center gap-2"><User /> Atribuído para</h4>
                      <p>{getAssigneeName(task.assigneeType, task.assigneeId)}</p>
                  </div>
                  <div className="p-3 border rounded-lg space-y-1">
                      <h4 className="text-sm font-semibold flex items-center gap-2"><UserCheck /> Aprovador</h4>
                      <p>{task.requiresApproval ? getAssigneeName(task.approverType!, task.approverId!) : 'Não requer aprovação'}</p>
                  </div>
              </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 border rounded-lg space-y-1">
                      <h4 className="text-sm font-semibold flex items-center gap-2"><CalendarIcon /> Prazo de conclusão</h4>
                      <p>{task.dueDate ? format(parseISO(task.dueDate), 'dd/MM/yyyy') : 'Não definido'}</p>
                  </div>
                  {task.completedAt &&
                    <div className="p-3 border rounded-lg space-y-1">
                        <h4 className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 /> Data de conclusão</h4>
                        <p>{format(parseISO(task.completedAt), "dd/MM/yyyy 'às' HH:mm")}</p>
                    </div>
                  }
              </div>

              {task.description && 
                <div className="p-3 border rounded-lg">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><MessageSquare /> Descrição</h4>
                    <p className="text-sm mt-1">{task.description}</p>
                </div>
              }
              
              {submission &&
                <div className="p-3 border rounded-lg flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-semibold flex items-center gap-2"><FileText /> Origem do formulário</h4>
                        <p className="text-sm mt-1 text-muted-foreground">{submission.templateName}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setIsSubmissionModalOpen(true)}>Visualizar resposta</Button>
                </div>
              }

              <div>
                  <h3 className="font-semibold text-lg flex items-center gap-2 mb-2"><History /> Histórico</h3>
                  <div className="space-y-4 p-3 border rounded-lg max-h-60 overflow-y-auto">
                    {task.history.map((item, index) => (
                        <div key={index} className="flex gap-4">
                            <div className="flex flex-col items-center">
                                <div className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                                    <User size={14} />
                                </div>
                                {index < task.history.length - 1 && <div className="w-px flex-1 bg-border"></div>}
                            </div>
                            <div>
                                <p className="text-sm">
                                    <span className="font-semibold">{item.author.name}</span>
                                    <span className="text-muted-foreground"> {item.action} a tarefa</span>
                                </p>
                                <p className="text-xs text-muted-foreground">{format(parseISO(item.timestamp), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}</p>
                                {item.details && <p className="text-sm mt-1 p-2 bg-muted rounded-md italic">"{item.details}"</p>}
                            </div>
                        </div>
                    ))}
                  </div>
              </div>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t">
          {isMyTurn && (
            <div className="w-full">
              {task.status === 'awaiting_approval' ? (
                <div className="space-y-2">
                  <Textarea placeholder="Justificativa (obrigatório para rejeitar)" value={rejectionNotes} onChange={(e) => setRejectionNotes(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button variant="destructive" onClick={handleReject} disabled={!rejectionNotes}><X className="mr-2"/> Rejeitar</Button>
                    <Button variant="default" className="bg-green-600 hover:bg-green-700" onClick={handleApprove}><Check className="mr-2"/> Aprovar</Button>
                  </div>
                </div>
              ) : (
                <Button onClick={handleMarkAsComplete}>
                  <Send className="mr-2" />
                  {task.requiresApproval ? 'Enviar para aprovação' : 'Marcar como concluída'}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {submission && isSubmissionModalOpen && <ViewSubmissionModal submission={submission} onOpenChange={(open) => !open && setIsSubmissionModalOpen(false)} />}
    </>
  );
}
