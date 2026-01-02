
"use client";

import { useState, useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { type RepositionActivity, type SignatureData } from '@/types';
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
import { ScrollArea } from './ui/scroll-area';
import { useExpiryProducts } from '@/hooks/use-expiry-products';


interface DispatchModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function DispatchModal({ activity, onOpenChange }: DispatchModalProps) {
    const { updateRepositionActivity } = useReposition();
    const { user } = useAuth();
    const { products } = useProducts();
    const { lots } = useExpiryProducts();
    
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
    
    const handleConfirmDispatch = async () => {
        if (!user) return;
        setIsLoading(true);

        let signatureData: SignatureData = { signedBy: transporterName, signedAt: new Date().toISOString() };

        if (useDigitalSignature) {
            if (!signatureDataUrl) {
                 alert("Assinatura digital não encontrada. Por favor, volte e assine novamente.");
                 setIsLoading(false);
                 return;
            }
            signatureData.dataUrl = signatureDataUrl;
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
            <h3 className="text-lg font-semibold">Conferência dos itens</h3>
            <p className="text-sm text-muted-foreground">Revise os itens e as quantidades que serão transportados.</p>
            <ScrollArea className="max-h-60">
              <div className="rounded-md border p-2 bg-muted/50">
                  <Table>
                      <TableHeader>
                          <TableRow>
                              <TableHead>Produto</TableHead>
                              <TableHead>Lote</TableHead>
                              <TableHead>Disponível</TableHead>
                              <TableHead className="text-right">Qtd. a Mover</TableHead>
                          </TableRow>
                      </TableHeader>
                      <TableBody>
                          {activity.items.flatMap(item => item.suggestedLots.map(lot => {
                            const lotDetails = lots.find(l => l.id === lot.lotId);
                            const availableQty = lotDetails ? lotDetails.quantity : 0;
                            return (
                              <TableRow key={lot.lotId}>
                                  <TableCell className="font-medium">{lot.productName}</TableCell>
                                  <TableCell>{lot.lotNumber}</TableCell>
                                  <TableCell>{availableQty}</TableCell>
                                  <TableCell className="text-right font-bold">{lot.quantityToMove}</TableCell>
                              </TableRow>
                            )
                          }))}
                      </TableBody>
                  </Table>
              </div>
            </ScrollArea>
             <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                    <Label className="text-base">Assinatura digital</Label>
                    <p className="text-sm text-muted-foreground">Coletar a assinatura na tela?</p>
                </div>
                <Switch checked={useDigitalSignature} onCheckedChange={setUseDigitalSignature} />
            </div>
        </div>
    );
    
    const renderStep2 = () => (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold">{useDigitalSignature ? "Coleta de assinatura digital" : "Coleta de assinatura física"}</h3>
            <p className="text-sm text-muted-foreground">Solicite que o transportador preencha o nome e assine.</p>

             <div>
                <Label htmlFor="transporter-name">Nome do transportador</Label>
                <Input 
                    id="transporter-name" 
                    value={transporterName} 
                    onChange={(e) => setTransporterName(e.target.value)}
                    placeholder="Digite o nome completo"
                />
            </div>
            
            {useDigitalSignature ? (
                <div>
                    <Label>Assinatura digital</Label>
                    <div className="rounded-md border bg-white">
                        <SignatureCanvas 
                            ref={sigCanvas}
                            penColor='black'
                            canvasProps={{ className: 'w-full h-[150px]' }} 
                            onEnd={handleSignatureEnd}
                        />
                    </div>
                    <Button variant="ghost" size="sm" onClick={clearSignature} className="text-xs -mt-1 text-muted-foreground">
                        <Eraser className="mr-1 h-3 w-3" /> Limpar assinatura
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                     <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Função Indisponível</AlertTitle>
                        <AlertDescription>
                            A impressão de documentos para assinatura física foi descontinuada. Por favor, utilize a assinatura digital.
                        </AlertDescription>
                    </Alert>
                </div>
            )}
        </div>
    );

     const renderStep3 = () => (
        <div className="space-y-4 text-center">
            <Alert>
                <AlertTitle className="flex items-center gap-2"><Send /> Tudo pronto para o despacho!</AlertTitle>
                <AlertDescription>
                    Ao confirmar, a atividade de reposição será atualizada para "Aguardando recebimento".
                </AlertDescription>
            </Alert>
             <div className="p-4 rounded-md border bg-muted/50">
                <p><strong>Transportador:</strong> {transporterName || "Não informado"}</p>
                <p><strong>Método de assinatura:</strong> {useDigitalSignature ? "Digital" : "Física (Anexada)"}</p>
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
                    <DialogTitle>Gerenciar despacho de reposição</DialogTitle>
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
                                {isLoading ? "Confirmando..." : "Confirmar e Despachar"}
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
