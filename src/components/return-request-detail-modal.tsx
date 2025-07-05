
"use client"

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ReturnRequest, returnRequestStatuses, type ReturnRequestChecklistItem } from '@/types';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { Calendar as CalendarIcon, Check, ChevronsRight, Send, XCircle } from 'lucide-react';
import { useReturnRequests } from '@/hooks/use-return-requests';
import { Textarea } from './ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { cn } from '@/lib/utils';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';

interface ReturnRequestDetailModalProps {
  request: ReturnRequest | null;
  onOpenChange: (open: boolean) => void;
}

const CHECKLIST_CONFIG: { [key: string]: { texto: string }[] } = {
    aberta: [
        { texto: "Conferir dados do insumo (nome, código)" },
        { texto: "Validar lote e quantidade" },
        { texto: "Definir tipo: devolução ou bonificação" },
        { texto: "Anexar evidência (foto/vídeo) opcional" },
        { texto: "Checar geração automática do número de controle" },
    ],
    aguardando_comunicacao: [
        { texto: "Enviar notificação ao representante (e-mail/WhatsApp)" },
        { texto: "Registrar data e hora do contato" },
        { texto: "Anexar protocolo de atendimento" },
        { texto: "Inserir previsão de retorno (data) e marcar como confirmado" },
    ],
    em_andamento: [
        { texto: "Receber resposta do representante" },
        { texto: "Registrar data prevista de coleta" },
    ],
    finalizado_sucesso: [
        { texto: "Preencher detalhes do resultado" },
        { texto: "Atualizar estoque (repor/bonificar)" },
        { texto: "Gerar nota de crédito/débito, se aplicável" },
        { texto: "Notificar solicitante sobre conclusão" },
        { texto: "Arquivar comprovantes eletrônicos" },
    ],
    finalizado_erro: [
        { texto: "Preencher detalhes do resultado e motivo do insucesso" },
        { texto: "Sugerir ação corretiva ou reabertura de chamado" },
        { texto: "Encerrar protocolo no sistema" },
    ],
};


export function ReturnRequestDetailModal({ request, onOpenChange }: ReturnRequestDetailModalProps) {
  const { updateReturnRequest } = useReturnRequests();
  const [resultDetails, setResultDetails] = useState('');
  const [returnDate, setReturnDate] = useState<Date | undefined>();
  const [checklist, setChecklist] = useState<ReturnRequestChecklistItem[]>([]);

  useEffect(() => {
    if (request) {
        const savedChecklist = request.checklist?.[request.status];
        if (savedChecklist && savedChecklist.length > 0) {
            setChecklist(savedChecklist);
        } else {
            const items = (CHECKLIST_CONFIG[request.status] || []).map(item => ({ ...item, feito: false }));
            setChecklist(items);
        }
        setResultDetails(request.detalhesResultado || '');
        setReturnDate(request.dataPrevisaoRetorno ? parseISO(request.dataPrevisaoRetorno) : undefined);
    }
  }, [request]);

  if (!request) return null;

  const currentStatusInfo = returnRequestStatuses[request.status];

  const handleChecklistChange = (index: number, checked: boolean) => {
    setChecklist(current => {
        const newChecklist = [...current];
        newChecklist[index].feito = checked;
        return newChecklist;
    });
  };

  const handleStatusChange = (newStatus: ReturnRequest['status']) => {
    let updatePayload: Partial<ReturnRequest> = {
        status: newStatus,
        checklist: {
            ...request.checklist,
            [request.status]: checklist,
        }
    };

    if (newStatus === 'aguardando_comunicacao' && returnDate) {
        updatePayload.dataPrevisaoRetorno = returnDate.toISOString();
    }
    if ((newStatus === 'finalizado_sucesso' || newStatus === 'finalizado_erro') && resultDetails) {
        updatePayload.detalhesResultado = resultDetails;
    }
    updateReturnRequest(request.id, updatePayload);
  };

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle>Chamado: {request.numero}</DialogTitle>
              <DialogDescription>
                <span className="capitalize">{request.tipo}</span> de {request.insumoNome} (Lote: {request.lote})
              </DialogDescription>
            </div>
            <Badge className={cn("text-white", currentStatusInfo.color)}>{currentStatusInfo.label}</Badge>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-6">
            <div className="space-y-6 py-4">
                <div className="p-4 border rounded-lg bg-muted/30">
                    <h3 className="font-semibold text-lg mb-4">Ações e Checklist</h3>
                    
                    {checklist.map((item, index) => (
                        <div key={index} className="flex items-center space-x-2 mb-2">
                           <Checkbox 
                                id={`chk-${index}`} 
                                checked={item.feito}
                                onCheckedChange={(checked) => handleChecklistChange(index, !!checked)}
                           />
                           <Label htmlFor={`chk-${index}`} className="text-sm font-normal leading-snug">{item.texto}</Label>
                        </div>
                    ))}

                    <div className="mt-4 pt-4 border-t space-y-4">
                        {request.status === 'aguardando_comunicacao' && (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-[280px] justify-start text-left font-normal", !returnDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {returnDate ? format(returnDate, "PPP", { locale: ptBR }) : <span>Previsão de retorno</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={returnDate} onSelect={setReturnDate} initialFocus locale={ptBR} /></PopoverContent>
                            </Popover>
                        )}
                        {(request.status === 'em_andamento' || request.status === 'aguardando_comunicacao') && (
                             <Textarea placeholder="Detalhes do resultado (obrigatório para finalizar)" value={resultDetails} onChange={(e) => setResultDetails(e.target.value)} />
                        )}

                        <div className="flex gap-2 flex-wrap">
                            {request.status === 'aberta' && <Button onClick={() => handleStatusChange('aguardando_comunicacao')}><Send className="mr-2"/>Comunicar Representante</Button>}
                            {request.status === 'aguardando_comunicacao' && <Button onClick={() => handleStatusChange('em_andamento')}><ChevronsRight className="mr-2"/>Iniciar Processo</Button>}
                            {request.status === 'em_andamento' && <Button variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => handleStatusChange('finalizado_sucesso')} disabled={!resultDetails}><Check className="mr-2"/>Finalizar com Sucesso</Button>}
                            {(request.status === 'em_andamento' || request.status === 'aguardando_comunicacao') && <Button variant="destructive" onClick={() => handleStatusChange('finalizado_erro')} disabled={!resultDetails}><XCircle className="mr-2"/>Finalizar sem Sucesso</Button>}
                        </div>
                    </div>
                </div>

                <div className="p-4 border rounded-lg">
                    <h3 className="font-semibold text-lg mb-2">Histórico de Situação</h3>
                    <div className="space-y-4">
                        {request.historico.map((item, index) => (
                            <div key={index} className="flex items-start gap-4">
                                <div className="flex flex-col items-center">
                                    <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Check size={16}/></div>
                                    {index < request.historico.length - 1 && <div className="w-px h-8 bg-border"></div>}
                                </div>
                                <div>
                                    {item.detalhes === "Chamado criado." ? (
                                        <p className="font-medium">
                                            Chamado criado na situação <span className="font-bold">{returnRequestStatuses[item.statusNovo].label}</span>
                                        </p>
                                    ) : (
                                        <p className="font-medium">
                                            Situação alterada de <span className="font-bold">{returnRequestStatuses[item.statusAnterior].label}</span> para <span className="font-bold">{returnRequestStatuses[item.statusNovo].label}</span>
                                        </p>
                                    )}
                                    <p className="text-sm text-muted-foreground">
                                        por {item.changedBy.username} em {format(parseISO(item.changedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                    </p>
                                    {item.detalhes && item.detalhes !== "Chamado criado." && <p className="text-sm mt-1 p-2 bg-muted rounded-md">{item.detalhes}</p>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
