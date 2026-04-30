
"use client"

import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type Task, type TaskHistoryItem, type TaskOrigin, type ReturnRequestStatus } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { History, User, Check, X, Send, UserCheck, MessageSquare, AlertTriangle, ListTodo, FileText, Calendar as CalendarIcon, CheckCircle2, ShoppingCart, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTasks } from '@/hooks/use-tasks';
import { Textarea } from './ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useBaseProducts } from '@/hooks/use-base-products';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useProfiles } from '@/hooks/use-profiles';
import { useRouter } from 'next/navigation';

interface TaskDetailModalProps {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
}

const getStatusInfo = (status: Task['status']) => {
    switch (status) {
        case 'pending':
        case 'reopened':
            return { label: 'Pendente', color: 'bg-orange-500 text-white' };
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

function TaskOriginDetails({ origin }: { origin: TaskOrigin }) {
    const { baseProducts } = useBaseProducts();
    
    if (origin.kind !== 'legacy' || origin.type !== 'consumption-projection') {
        return null;
    }

    const baseProduct = baseProducts.find(bp => bp.id === origin.id);
    const productName = baseProduct?.name || 'Insumo não encontrado';
    
    // Find the suggestion from the origin's details.
    // The details field should contain the necessary info.
    const purchaseSuggestion = (origin as any).details?.suggestedOrderQty;
    const dueDate = (origin as any).details?.orderDate;

    return (
        <div className="p-3 border rounded-lg bg-blue-500/5">
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-2 text-blue-700 dark:text-blue-300">
                <ShoppingCart className="h-4 w-4" /> Detalhes da Tarefa de Compra
            </h4>
            <div className="space-y-1 text-sm">
                <p><strong>Origem:</strong> Projeção de Consumo</p>
                <p><strong>Insumo:</strong> {productName}</p>
                {purchaseSuggestion !== undefined && <p><strong>Sugestão de Compra:</strong> {purchaseSuggestion}</p>}
                {dueDate && <p><strong>Prazo do Pedido:</strong> {format(parseISO(dueDate), 'dd/MM/yyyy')}</p>}
            </div>
        </div>
    );
}

export function TaskDetailModal({ task, onOpenChange }: TaskDetailModalProps) {
  const router = useRouter();
  const { user, users } = useAuth();
  const { profiles } = useProfiles();
  const { updateTask, deleteTask } = useTasks();
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
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
    } else if (status === 'pending' || status === 'reopened' || status === 'in_progress') {
        if (assigneeType === 'user' && assigneeId === user.id) return true;
        if (assigneeType === 'profile' && user.profileId === assigneeId) return true;
    }
    return false;
  }, [task, user, users, profiles]);

  const originLink = useMemo(() => {
    if (!task) return null;
    if (task.origin.kind === 'form_trigger') {
      return `/dashboard/forms/${task.origin.execution_id}/view`;
    }
    if (task.origin.kind === 'purchase_receipt') {
      return '/dashboard/purchasing/receipts';
    }
    return task.legacyLink ?? null;
  }, [task]);

  if (!task || !profiles) return null;

  const { label: statusLabel, color: statusColor } = getStatusInfo(task.status);
  
  const addHistoryItem = (action: TaskHistoryItem['action'], details?: string): TaskHistoryItem => ({
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
      }

      await updateTask(task.id, updatePayload);
      handleClose();
  };

  const handleApprove = async () => {
      const now = new Date().toISOString();
      const newHistory = [...task.history, addHistoryItem('approved')];

      await updateTask(task.id, { status: 'completed', history: newHistory, completedAt: now, updatedAt: now });
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
  
  const handleDeleteConfirm = async () => {
    if (task) {
      await deleteTask(task.id);
      setIsDeleteConfirmOpen(false);
      handleClose();
    }
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
                    <p className="text-sm mt-1 whitespace-pre-wrap">{task.description}</p>
                </div>
              }
              
              <TaskOriginDetails origin={task.origin} />
              
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

        <DialogFooter className="pt-4 border-t flex justify-between w-full">
          <Button variant="destructive" onClick={() => setIsDeleteConfirmOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" /> Excluir Tarefa
          </Button>
          {isMyTurn ? (
            <div className="space-y-2">
              {task.status === 'awaiting_approval' ? (
                <div className="flex justify-end gap-2">
                  <div className="flex-grow"><Textarea placeholder="Justificativa (obrigatório para rejeitar)" value={rejectionNotes} onChange={(e) => setRejectionNotes(e.target.value)} /></div>
                  <Button variant="destructive" onClick={handleReject} disabled={!rejectionNotes}><X className="mr-2"/> Rejeitar</Button>
                  <Button variant="default" className="bg-green-600 hover:bg-green-700" onClick={handleApprove}><Check className="mr-2"/> Aprovar</Button>
                </div>
              ) : task.origin.kind !== 'manual' && task.origin.kind !== 'legacy' ? (
                <Button variant="outline" onClick={() => originLink && router.push(originLink)}>
                  <FileText className="mr-2" />
                  Abrir origem
                </Button>
              ) : (
                <Button onClick={handleMarkAsComplete}>
                  <Send className="mr-2" />
                  {task.requiresApproval ? 'Enviar para aprovação' : 'Marcar como concluída'}
                </Button>
              )}
            </div>
          ) : (
             <Button variant="outline" onClick={handleClose}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DeleteConfirmationDialog
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
        onConfirm={handleDeleteConfirm}
        itemName={`a tarefa "${task?.title}"`}
        description="Esta ação é permanente e não pode ser desfeita."
      />
    </>
  );
}
