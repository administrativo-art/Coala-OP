
"use client";

import { useState, useRef, useEffect } from 'react';
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
import { FileText, Loader2, Send, Signature, Eraser, Printer, Camera, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import { PhotoCaptureModal } from './photo-capture-modal';
import Image from 'next/image';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';


interface DispatchModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function DispatchModal({ activity, onOpenChange }: DispatchModalProps) {
    const { updateRepositionActivity } = useReposition();
    const { user } = useAuth();
    
    const [currentStep, setCurrentStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [transporterName, setTransporterName] = useState('');
    const [useDigitalSignature, setUseDigitalSignature] = useState(true);
    const [physicalCopyUrl, setPhysicalCopyUrl] = useState<string | null>(null);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const [isSignatureEmpty, setIsSignatureEmpty] = useState(true);
    const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

    const sigCanvas = useRef<SignatureCanvas>(null);
    
    useEffect(() => {
        if (sigCanvas.current) {
            setIsSignatureEmpty(sigCanvas.current.isEmpty());
        }
    }, [useDigitalSignature, currentStep]);

    const generatePDF = (signatureUrl?: string, name?: string) => {
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

        if (signatureUrl) {
            doc.addImage(signatureUrl, 'PNG', 14, finalY + 20, 60, 20);
        }

        doc.line(110, finalY + 40, 196, finalY + 40);
        doc.text("Nome do Transportador", 110, finalY + 45);
        
        if (name) {
            doc.text(name, 110, finalY + 35);
        }

        return doc;
    };
    
    const handleConfirmDispatch = async () => {
        if (!user) return;
        setIsLoading(true);

        let signatureData: SignatureData = { signedBy: transporterName, signedAt: new Date().toISOString() };
        let signatureUrlForPdf: string | undefined = undefined;

        if (useDigitalSignature) {
            if (!signatureDataUrl) {
                 alert("Assinatura digital não encontrada. Por favor, volte e assine novamente.");
                 setIsLoading(false);
                 return;
            }
            signatureUrlForPdf = signatureDataUrl;
            signatureData.dataUrl = signatureUrlForPdf;
        } else {
             if (!physicalCopyUrl) {
                alert("A foto do documento assinado é obrigatória.");
                setIsLoading(false);
                return;
            }
            signatureData.physicalCopyUrl = physicalCopyUrl;
        }

        await updateRepositionActivity(activity.id, {
            status: 'Aguardando recebimento',
            transportSignature: signatureData,
        });

        const doc = generatePDF(signatureUrlForPdf, transporterName);
        doc.save(`despacho_${activity.id.slice(0, 8)}.pdf`);

        setIsLoading(false);
        onOpenChange(false);
    }
    
    const handleSignatureEnd = () => {
        if (sigCanvas.current) {
            setIsSignatureEmpty(sigCanvas.current.isEmpty());
        }
    };
    
    const clearSignature = () => {
        sigCanvas.current?.clear();
        setIsSignatureEmpty(true);
    };

    const handleNextStep = () => {
        if (currentStep === 2 && useDigitalSignature && sigCanvas.current) {
            setSignatureDataUrl(sigCanvas.current.toDataURL('image/png'));
        }
        setCurrentStep(prev => prev + 1);
    };
    const handlePrevStep = () => setCurrentStep(prev => prev - 1);

    const renderStep1 = () => (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">Conferência dos Itens</h3>
            <p className="text-sm text-muted-foreground">Revise os itens e as quantidades que serão transportados.</p>
            <div className="max-h-60 overflow-y-auto rounded-md border p-2 bg-muted/50">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead>Lote</TableHead>
                            <TableHead className="text-right">Qtd.</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                         {activity.items.flatMap(item => item.suggestedLots.map(lot => (
                            <TableRow key={lot.lotId}>
                                <TableCell className="font-medium">{lot.productName}</TableCell>
                                <TableCell>{lot.lotId.slice(-8)}</TableCell>
                                <TableCell className="text-right font-bold">{lot.quantityToMove}</TableCell>
                            </TableRow>
                         )))}
                    </TableBody>
                </Table>
            </div>
             <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                    <Label className="text-base">Assinatura Digital</Label>
                    <p className="text-sm text-muted-foreground">Coletar a assinatura na tela?</p>
                </div>
                <Switch checked={useDigitalSignature} onCheckedChange={setUseDigitalSignature} />
            </div>
        </div>
    );
    
    const renderStep2 = () => (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">{useDigitalSignature ? "Coleta de Assinatura Digital" : "Coleta de Assinatura Física"}</h3>
            <p className="text-sm text-muted-foreground">Solicite que o transportador preencha o nome e assine.</p>

             <div>
                <Label htmlFor="transporter-name">Nome do Transportador</Label>
                <Input 
                    id="transporter-name" 
                    value={transporterName} 
                    onChange={(e) => setTransporterName(e.target.value)}
                    placeholder="Digite o nome completo"
                />
            </div>
            
            {useDigitalSignature ? (
                <div>
                    <Label>Assinatura Digital</Label>
                    <div className="rounded-md border bg-white">
                        <SignatureCanvas 
                            ref={sigCanvas}
                            penColor='black'
                            canvasProps={{ className: 'w-full h-[150px]' }} 
                            onEnd={handleSignatureEnd}
                        />
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs -mt-1 text-muted-foreground">
                        <Eraser className="mr-1 h-3 w-3" /> Limpar Assinatura
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    <Button variant="outline" className="w-full" onClick={() => generatePDF().output('dataurlnewwindow')}>
                        <Printer className="mr-2" />
                        Imprimir Documento para Assinatura
                    </Button>
                     <div className="rounded-md border p-4 text-center">
                        {physicalCopyUrl ? (
                            <div className="relative mx-auto w-48 h-64">
                                <Image src={physicalCopyUrl} alt="Documento assinado" layout="fill" objectFit="contain" />
                            </div>
                        ) : (
                             <p className="text-sm text-muted-foreground mb-2">Após assinar, anexe uma foto do documento.</p>
                        )}
                        <Button variant="secondary" onClick={() => setIsPhotoModalOpen(true)}>
                           <Camera className="mr-2" />
                           {physicalCopyUrl ? "Tirar outra foto" : "Anexar Foto"}
                       </Button>
                    </div>
                </div>
            )}
        </div>
    );

     const renderStep3 = () => (
        <div className="space-y-4 text-center">
            <Alert>
                <AlertTitle className="flex items-center gap-2"><Send /> Tudo pronto para o despacho!</AlertTitle>
                <AlertDescription>
                    Ao confirmar, a atividade de reposição será atualizada para "Aguardando recebimento" e um PDF do documento assinado será gerado para download.
                </AlertDescription>
            </Alert>
             <div className="p-4 rounded-md border bg-muted/50">
                <p><strong>Transportador:</strong> {transporterName || "Não informado"}</p>
                <p><strong>Método de Assinatura:</strong> {useDigitalSignature ? "Digital" : "Física (Anexada)"}</p>
            </div>
        </div>
    );

    const isNextDisabled = currentStep === 2 && (
        !transporterName ||
        (useDigitalSignature && isSignatureEmpty) ||
        (!useDigitalSignature && !physicalCopyUrl)
    );

    return (
        <>
        <Dialog open={true} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Gerenciar Despacho de Reposição</DialogTitle>
                    <DialogDescription>
                        Siga os passos para confirmar o envio da mercadoria de {activity.kioskOriginName} para {activity.kioskDestinationName}.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    {currentStep === 1 && renderStep1()}
                    {currentStep === 2 && renderStep2()}
                    {currentStep === 3 && renderStep3()}
                </div>
                <DialogFooter className="flex justify-between w-full">
                    <div>
                        {currentStep > 1 && (
                            <Button variant="outline" onClick={handlePrevStep} disabled={isLoading}>
                                <ArrowLeft className="mr-2" /> Voltar
                            </Button>
                        )}
                    </div>
                     <div className="flex gap-2">
                         <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                            Cancelar
                        </Button>
                        {currentStep < 3 ? (
                             <Button onClick={handleNextStep} disabled={isNextDisabled}>
                                Próximo <ArrowRight className="ml-2" />
                            </Button>
                        ) : (
                            <Button onClick={handleConfirmDispatch} disabled={isLoading}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                                {isLoading ? "Confirmando..." : "Confirmar e Gerar PDF"}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {isPhotoModalOpen && (
             <PhotoCaptureModal
                open={isPhotoModalOpen}
                onOpenChange={setIsPhotoModalOpen}
                onPhotoCaptured={setPhysicalCopyUrl}
            />
        )}
        </>
    );
}
