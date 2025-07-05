"use client"

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type ReturnRequest, returnRequestStatuses, type ReturnRequestChecklistItem, type ReturnRequestStatus } from '@/types';
import { format, parseISO, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { Calendar as CalendarIcon, Check, User, CalendarCheck, ChevronsRight, Send, XCircle, MessageSquareText, Copy, Video, Archive, Save } from 'lucide-react';
import { useReturnRequests } from '@/hooks/use-return-requests';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { Input } from './ui/input';

interface ReturnRequestDetailModalProps {
  request: ReturnRequest | null;
  onOpenChange: (open: boolean) => void;
}

const CHECKLIST_CONFIG: { [key: string]: { texto: string }[] } = {
    em_andamento: [
        { texto: "Filmar o produto para enviar" },
        { texto: "Comunicação ao representante" },
        { texto: "Registrar data e hora do contato" },
    ],
    finalizado_sucesso: [
        { texto: "Preencher “Detalhes do resultado”" },
        { texto: "Atualizar estoque (repor / bonificar), se houver" },
        { texto: "Gerar nota de crédito/débito, se houver" },
        { texto: "Arquivar protocolo no sistema" },
    ],
    finalizado_erro: [
        { texto: "Preencher “Detalhes do resultado” e motivo do insucesso" },
        { texto: "Sugerir ação corretiva ou reabertura de chamado" },
        { texto: "Arquivar protocolo no sistema" },
    ],
};


export function ReturnRequestDetailModal({ request, onOpenChange }: ReturnRequestDetailModalProps) {
  const { updateReturnRequest } = useReturnRequests();
  const { toast } = useToast();
  const [resultDetails, setResultDetails] = useState('');
  const [checklist, setChecklist] = useState<ReturnRequestChecklistItem[]>([]);
  const [contactDate, setContactDate] = useState<Date | undefined>();
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isVideosModalOpen, setIsVideosModalOpen] = useState(false);

  useEffect(() => {
    if (request) {
        const effectiveStatus = returnRequestStatuses[request.status] ? request.status : 'em_andamento';
        const savedChecklist = request.checklist?.[effectiveStatus];
        if (savedChecklist && savedChecklist.length > 0) {
            setChecklist(savedChecklist);
        } else {
            const items = (CHECKLIST_CONFIG[effectiveStatus] || []).map(item => ({ ...item, feito: false }));
            setChecklist(items);
        }
        setResultDetails(request.detalhesResultado || '');
        setContactDate(request.dataContatoRepresentante ? parseISO(request.dataContatoRepresentante) : undefined);
    }
  }, [request]);

  useEffect(() => {
      const handleRequestUpdate = (event: Event) => {
          const customEvent = event as CustomEvent;
          if (request && customEvent.detail.id === request.id) {
              const updatedRequest = customEvent.detail;
              const newStatus = updatedRequest.status;
              const newChecklist = (CHECKLIST_CONFIG[newStatus] || []).map(item => ({...item, feito: false}));
              setChecklist(newChecklist);
          }
      };

      window.addEventListener('requestUpdate', handleRequestUpdate);
      return () => {
          window.removeEventListener('requestUpdate', handleRequestUpdate);
      };
  }, [request]);

  if (!request) return null;

  const effectiveStatus = returnRequestStatuses[request.status] ? request.status : 'em_andamento';
  const currentStatusInfo = returnRequestStatuses[effectiveStatus] || { label: 'Desconhecido', color: 'bg-gray-400'};
  let isOverdue = false;
  if (request.status === 'em_andamento' && request.dataPrevisaoRetorno) {
      isOverdue = differenceInDays(new Date(), parseISO(request.dataPrevisaoRetorno)) > 0;
  }


  const handleChecklistChange = (index: number, checked: boolean) => {
    setChecklist(current => {
        const newChecklist = [...current];
        newChecklist[index].feito = checked;
        return newChecklist;
    });
  };
  
  const getUpdatePayload = (): Partial<ReturnRequest> => {
      const payload: Partial<ReturnRequest> = {
        checklist: {
            ...request.checklist,
            [effectiveStatus]: checklist,
        },
        detalhesResultado: resultDetails,
        dataContatoRepresentante: contactDate?.toISOString(),
      };
      
      Object.keys(payload).forEach(keyStr => {
        const key = keyStr as keyof typeof payload;
        if ((payload as any)[key] === undefined) {
          delete (payload as any)[key];
        }
      });
      
      return payload;
  };
  
  const handleSaveChanges = () => {
      if (!request) return;
      updateReturnRequest(request.id, getUpdatePayload());
      toast({ title: "Alterações salvas com sucesso!" });
  }

  const handleStatusChange = (newStatus: ReturnRequest['status']) => {
    if(!request) return;
    
    let updatePayload: Partial<ReturnRequest> = {
        ...getUpdatePayload(),
        status: newStatus,
    };
    
    if (newStatus === 'finalizado_sucesso' || newStatus === 'finalizado_erro') {
        updatePayload.dataConclusao = new Date().toISOString();
    }
    
    const updatedRequest = { ...request, ...updatePayload };
    
    // Dispatch event to update parent state implicitly
    const event = new CustomEvent('requestUpdate', { detail: updatedRequest });
    window.dispatchEvent(event);

    updateReturnRequest(request.id, updatePayload);
  };
  
  const handleArchive = () => {
    if (!request) return;
    updateReturnRequest(request.id, { ...getUpdatePayload(), isArchived: true });
    onOpenChange(false);
  };

  const isFinalized = request.status === 'finalizado_sucesso' || request.status === 'finalizado_erro';

  const communicationTemplate = `Prezado(a) [Nome do representante],
Tudo bem?

Identificamos que o produto ${request.insumoNome}, lote ${request.lote}, apresenta ${request.motivo}.

Para dar sequência, solicitamos que seja realizada uma análise do produto e, em seguida, informe qual dos procedimentos abaixo deverá ser adotado:
- Troca do produto por item sem defeito
- Devolução 
- Bonificação em substituição ao item afetado

Por gentileza, confirme a conclusão da análise e nos retorne o mais breve possível com a opção escolhida, bem como o prazo e as instruções para coleta/envio.

• Data de solicitação: ${format(parseISO(request.createdAt), "dd/MM/yyyy", { locale: ptBR })}
• Quantidade: ${request.quantidade} unidades

Atenciosamente,
CT Sorvetes LTDA`;

  const handleCopyTemplate = () => {
    navigator.clipboard.writeText(communicationTemplate).then(() => {
      toast({ title: 'Modelo copiado!', description: 'O texto está na sua área de transferência.' });
      setIsTemplateModalOpen(false);
    });
  };

  const handleContactTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = e.target.value;
    const [hours, minutes] = time.split(':').map(Number);
    
    setContactDate(prevDate => {
        if (!prevDate) {
            const newDateWithTime = new Date();
            newDateWithTime.setHours(hours, minutes, 0, 0);
            return newDateWithTime;
        }
        
        if (isNaN(hours) || isNaN(minutes)) return prevDate;

        const newDate = new Date(prevDate);
        newDate.setHours(hours, minutes);
        return newDate;
    });
  };

  return (
    <>
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
               <Badge className={cn("text-white", isOverdue ? 'bg-red-700' : currentStatusInfo.color)}>
                  {isOverdue ? `${currentStatusInfo.label} | Atrasado` : currentStatusInfo.label}
              </Badge>
            </div>
             <div className="text-xs text-muted-foreground pt-2 space-y-1">
                {request.createdBy && (
                    <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        <span>Aberto por: <strong>{request.createdBy.username}</strong> em {format(parseISO(request.createdAt), "dd/MM/yyyy", { locale: ptBR })}</span>
                    </div>
                )}
                {request.dataPrevisaoRetorno && (
                    <div className="flex items-center gap-2">
                        <CalendarIcon className="h-3 w-3" />
                        <span>Previsão de Conclusão: <strong>{format(parseISO(request.dataPrevisaoRetorno), "dd/MM/yyyy", { locale: ptBR })}</strong></span>
                    </div>
                )}
                {isFinalized && request.dataConclusao && (
                    <div className="flex items-center gap-2">
                        <CalendarCheck className="h-3 w-3" />
                        <span>Concluído em: <strong>{format(parseISO(request.dataConclusao), "dd/MM/yyyy", { locale: ptBR })}</strong></span>
                    </div>
                )}
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-6">
              <div className="space-y-6 py-4">
                  {request.motivo && (
                      <div className="p-4 border rounded-lg">
                          <h3 className="font-semibold text-lg mb-2">Motivo do Chamado</h3>
                          <p className="text-sm whitespace-pre-wrap">{request.motivo}</p>
                      </div>
                  )}
                  <div className="p-4 border rounded-lg bg-muted/30">
                      <h3 className="font-semibold text-lg mb-4">Checklist</h3>
                      
                      <div className="space-y-3">
                        {checklist.map((item, index) => {
                           const isCommunicationItem = item.texto === "Comunicação ao representante";
                           const isFilmingItem = item.texto === "Filmar o produto para enviar";
                           const isContactDateItem = item.texto === "Registrar data e hora do contato";

                           return (
                                <div key={index}>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox 
                                            id={`chk-${index}`} 
                                            checked={item.feito}
                                            onCheckedChange={(checked) => handleChecklistChange(index, !!checked)}
                                        />
                                        <Label htmlFor={`chk-${index}`} className="text-sm font-normal leading-snug">
                                            {item.texto}
                                        </Label>
                                        {isCommunicationItem && (
                                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-primary" onClick={() => setIsTemplateModalOpen(true)}><MessageSquareText className="h-4 w-4" /></Button>
                                        )}
                                        {isFilmingItem && (
                                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-primary" onClick={() => setIsVideosModalOpen(true)}><Video className="h-4 w-4" /></Button>
                                        )}
                                    </div>
                                    {isContactDateItem && (
                                        <div className="pl-6 pt-2">
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                <Button variant={"outline"} size="sm" className={cn("w-[240px] justify-start text-left font-normal", !contactDate && "text-muted-foreground")}>
                                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                                    {contactDate ? format(contactDate, "dd/MM/yyyy 'às' HH:mm") : <span>Selecionar data e hora</span>}
                                                </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0">
                                                    <Calendar mode="single" selected={contactDate} onSelect={setContactDate} initialFocus />
                                                    <div className="p-2 border-t"><Input type="time" value={contactDate ? format(contactDate, 'HH:mm') : ''} onChange={handleContactTimeChange} /></div>
                                                </PopoverContent>
                                            </Popover>
                                        </div>
                                    )}
                                </div>
                           )
                        })}
                      </div>

                        {effectiveStatus === 'em_andamento' && (
                            <div className="mt-4 pt-4 border-t space-y-4">
                                <Textarea placeholder="Detalhes do resultado (obrigatório para finalizar)" value={resultDetails} onChange={(e) => setResultDetails(e.target.value)} />
                                <div className="flex gap-2 flex-wrap">
                                    <Button variant="default" className="bg-green-600 hover:bg-green-700" onClick={() => handleStatusChange('finalizado_sucesso')} disabled={!resultDetails}><Check className="mr-2"/>Finalizar com Sucesso</Button>
                                    <Button variant="destructive" onClick={() => handleStatusChange('finalizado_erro')} disabled={!resultDetails}><XCircle className="mr-2"/>Finalizar sem Sucesso</Button>
                                </div>
                            </div>
                        )}
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
                                              Chamado criado na situação <span className="font-bold">{returnRequestStatuses[item.statusNovo]?.label || 'Desconhecido'}</span>
                                          </p>
                                      ) : (
                                          <p className="font-medium">
                                              Situação alterada de <span className="font-bold">{returnRequestStatuses[item.statusAnterior as ReturnRequestStatus]?.label || 'Desconhecido'}</span> para <span className="font-bold">{returnRequestStatuses[item.statusNovo]?.label || 'Desconhecido'}</span>
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

          <DialogFooter className="pt-4 border-t flex-wrap justify-end gap-2">
            {isFinalized ? (
                 <Button variant="outline" onClick={handleArchive}>
                    <Archive className="mr-2 h-4 w-4" />
                    Arquivar
                </Button>
            ) : (
                <Button variant="secondary" onClick={handleSaveChanges}>
                    <Save className="mr-2 h-4 w-4" />
                    Salvar Alterações
                </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isTemplateModalOpen} onOpenChange={setIsTemplateModalOpen}>
        <DialogContent className="max-w-2xl">
            <DialogHeader>
                <DialogTitle>Modelo de Comunicação</DialogTitle>
                <DialogDescription>
                    Use este modelo como base para comunicar o representante. Clique no botão para copiar o texto.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4">
                <Textarea
                    readOnly
                    value={communicationTemplate}
                    className="h-80 font-mono text-xs bg-muted/50"
                />
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsTemplateModalOpen(false)}>Fechar</Button>
                <Button type="button" onClick={handleCopyTemplate}>
                    <Copy className="mr-2 h-4 w-4" /> Copiar Texto
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isVideosModalOpen} onOpenChange={setIsVideosModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Vídeos de Instrução</DialogTitle>
                <DialogDescription>
                    Consulte os vídeos abaixo para entender como filmar corretamente o produto.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-2">
                <a 
                    href="https://drive.google.com/file/d/1uzOEGlPrgCmENQXtLY8IYz2qKR-56NLp/view?usp=share_link"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-medium"
                >
                    Cascão e casquinha
                </a>
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsVideosModalOpen(false)}>Fechar</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  </>
  );
}
