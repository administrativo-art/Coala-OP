
"use client";

import { useState, useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { type RepositionActivity, type SignatureData } from '@/types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileText, Loader2, Send, Signature, Eraser } from 'lucide-react';
import { cn } from '@/lib/utils';


interface DispatchModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function DispatchModal({ activity, onOpenChange }: DispatchModalProps) {
    const { updateRepositionActivity } = useReposition();
    const { user } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [transporterName, setTransporterName] = useState('');
    const sigCanvas = useRef<SignatureCanvas>(null);

    const generateAndPrintPDF = () => {
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text("Documento de Transporte de Mercadoria", 14, 22);

        doc.setFontSize(11);
        doc.text(`Atividade ID: ${activity.id}`, 14, 32);
        doc.text(`Data de Emissão: ${format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}`, 14, 38);
        doc.text(`Origem: ${activity.kioskOriginName}`, 14, 44);
        doc.text(`Destino: ${activity.kioskDestinationName}`, 14, 50);

        const tableColumn = ["Produto", "Lote", "Quantidade"];
        const tableRows: any[][] = [];

        activity.items.forEach(item => {
            item.suggestedLots.forEach(lot => {
                tableRows.push([
                    lot.productName,
                    lot.lotId.slice(-8),
                    lot.quantityToMove
                ]);
            });
        });

        autoTable(doc, {
            startY: 60,
            head: [tableColumn],
            body: tableRows,
            theme: 'grid'
        });

        const finalY = (doc as any).lastAutoTable.finalY || 100;

        doc.setFontSize(10);
        const declarationText = "Declaro que conferi a mercadoria descrita neste documento e que a responsabilidade pelo transporte, até a entrega integral no destino, é minha a partir deste momento.";
        const splitText = doc.splitTextToSize(declarationText, 180);
        doc.text(splitText, 14, finalY + 15);
        
        doc.line(14, finalY + 40, 100, finalY + 40);
        doc.text("Assinatura do Transportador", 14, finalY + 45);

        doc.line(110, finalY + 40, 196, finalY + 40);
        doc.text("Nome do Transportador", 110, finalY + 45);

        doc.output('dataurlnewwindow');
    };
    
    const handleConfirmDispatch = async () => {
        if (!user || sigCanvas.current?.isEmpty() || !transporterName.trim()) {
            alert("Por favor, preencha o nome do transportador e a assinatura.");
            return;
        }

        setIsLoading(true);

        const signature: SignatureData = {
            dataUrl: sigCanvas.current.toDataURL('image/png'),
            signedBy: transporterName.trim(),
            signedAt: new Date().toISOString()
        };

        await updateRepositionActivity(activity.id, {
            status: 'Aguardando recebimento',
            transportSignature: signature,
        });
        setIsLoading(false);
        onOpenChange(false);
    }
    
    const clearSignature = () => {
        sigCanvas.current?.clear();
    };

    return (
        <Dialog open={true} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Gerenciar Despacho de Reposição</DialogTitle>
                    <DialogDescription>
                        Gere o documento de transporte, colete a assinatura do transportador e confirme o envio da mercadoria.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <Alert>
                        <AlertTitle className="flex items-center gap-2">
                           <FileText className="h-4 w-4" /> Passo 1: Gerar Documento
                        </AlertTitle>
                        <AlertDescription>
                            Clique no botão abaixo para gerar o Documento de Transporte para impressão.
                        </AlertDescription>
                         <Button variant="secondary" className="w-full mt-2" onClick={generateAndPrintPDF}>
                            Gerar e Imprimir Documento de Transporte
                        </Button>
                    </Alert>

                     <Alert>
                        <AlertTitle className="flex items-center gap-2">
                           <Signature className="h-4 w-4" /> Passo 2: Coletar Assinatura
                        </AlertTitle>
                        <AlertDescription>
                            Solicite que o transportador preencha o nome e assine no campo abaixo.
                        </AlertDescription>
                        <div className="mt-3 space-y-2">
                            <div>
                                <Label htmlFor="transporter-name">Nome do Transportador</Label>
                                <Input 
                                    id="transporter-name" 
                                    value={transporterName} 
                                    onChange={(e) => setTransporterName(e.target.value)}
                                    placeholder="Digite o nome completo"
                                />
                            </div>
                            <div>
                                <Label>Assinatura</Label>
                                <div className="rounded-md border bg-background">
                                    <SignatureCanvas 
                                        ref={sigCanvas}
                                        penColor='black'
                                        canvasProps={{ className: 'w-full h-[150px]' }} 
                                    />
                                </div>
                                <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs -mt-1">
                                    <Eraser className="mr-1 h-3 w-3" /> Limpar
                                </Button>
                            </div>
                        </div>
                    </Alert>

                    <Alert>
                        <AlertTitle className="flex items-center gap-2">
                            <Send className="h-4 w-4" /> Passo 3: Confirmar Despacho
                        </AlertTitle>
                        <AlertDescription>
                            Após a assinatura, clique para confirmar o despacho. O status da atividade será atualizado para "Aguardando recebimento".
                        </AlertDescription>
                    </Alert>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleConfirmDispatch} disabled={isLoading || !transporterName}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                        {isLoading ? "Confirmando..." : "Confirmar Despacho"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
