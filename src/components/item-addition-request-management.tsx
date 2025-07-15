
"use client";

import { useState } from 'react';
import { useItemAddition } from '@/hooks/use-item-addition';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Check, Inbox, X } from 'lucide-react';

export function ItemAdditionRequestManagement() {
  const { requests, loading, updateRequestStatus } = useItemAddition();
  const [activeTab, setActiveTab] = useState<'pending' | 'completed' | 'rejected'>('pending');

  const filteredRequests = requests.filter(r => r.status === activeTab);

  const handleUpdateStatus = (id: string, status: 'completed' | 'rejected') => {
    updateRequestStatus(id, status);
  };
  
  if (loading) {
    return <Skeleton className="h-96 w-full" />;
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gerenciar Solicitações de Cadastro</CardTitle>
        <CardDescription>
          Revise as solicitações de novos insumos enviadas pelos colaboradores.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-4">
          <Button variant={activeTab === 'pending' ? 'default' : 'outline'} onClick={() => setActiveTab('pending')}>
            Pendentes
          </Button>
          <Button variant={activeTab === 'completed' ? 'default' : 'outline'} onClick={() => setActiveTab('completed')}>
            Concluídas
          </Button>
          <Button variant={activeTab === 'rejected' ? 'default' : 'outline'} onClick={() => setActiveTab('rejected')}>
            Rejeitadas
          </Button>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
             <Inbox className="h-12 w-12 mx-auto mb-4" />
             <p className="font-semibold">Nenhuma solicitação encontrada</p>
             <p className="text-sm">Não há solicitações com o status "{activeTab}".</p>
          </div>
        ) : (
          <Accordion type="multiple" className="w-full space-y-3">
            {filteredRequests.map(req => (
              <AccordionItem key={req.id} value={req.id} className="border rounded-lg">
                <AccordionTrigger className="p-4 hover:no-underline">
                  <div className="flex justify-between items-center w-full">
                    <div>
                        <p className="font-semibold">{req.productName} {req.brand && `(${req.brand})`}</p>
                        <p className="text-sm text-muted-foreground">
                            Solicitado por {req.requestedBy.username} em {req.kioskName}
                        </p>
                    </div>
                    <Badge variant={req.status === 'pending' ? 'secondary' : (req.status === 'completed' ? 'default' : 'destructive')}>{req.status}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 pt-0">
                   <div className="space-y-2 text-sm">
                        <p><strong>Data da Solicitação:</strong> {format(new Date(req.createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                        {req.notes && <p><strong>Observações:</strong> {req.notes}</p>}
                        {req.reviewedAt && req.reviewedBy && (
                            <p><strong>Revisado por:</strong> {req.reviewedBy.username} em {format(new Date(req.reviewedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                        )}
                   </div>
                   {req.status === 'pending' && (
                       <div className="flex gap-2 mt-4 border-t pt-4">
                           <Button size="sm" onClick={() => handleUpdateStatus(req.id, 'completed')}>
                                <Check className="mr-2 h-4 w-4" /> Marcar como Concluído
                           </Button>
                           <Button size="sm" variant="destructive" onClick={() => handleUpdateStatus(req.id, 'rejected')}>
                                <X className="mr-2 h-4 w-4" /> Rejeitar
                           </Button>
                       </div>
                   )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
