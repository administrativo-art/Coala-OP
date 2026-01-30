"use client";

import { useState, useRef, useEffect } from 'react';
import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { type RepositionActivity, type SignatureData } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Send, Camera, Upload, Trash2, ArrowRight, Warehouse } from 'lucide-react';
import { PhotoCaptureModal } from './photo-capture-modal';
import Image from 'next/image';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { ScrollArea } from './ui/scroll-area';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { Badge } from './ui/badge';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';

interface DispatchModalProps {
  activity: RepositionActivity;
  onOpenChange: (open: boolean) => void;
}

export function DispatchModal({ activity, onOpenChange }: DispatchModalProps) {
    const { updateRepositionActivity } = useReposition();
    const { user } = useAuth();
    const { lots } = useExpiryProducts();
    const { toast } = useToast();
    
    const [isLoading, setIsLoading] = useState(false);
    const [transporterName, setTransporterName] = useState('');
    const [physicalCopyUrl, setPhysicalCopyUrl] = useState<string | null>(null);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (activity) {
            setTransporterName(activity.transportSignature?.signedBy || '');
            setPhysicalCopyUrl(activity.transportSignature?.physicalCopyUrl || null);
        }
    }, [activity]);
    
    const handleConfirmDispatch = async () => {
        if (!user) return;
        setIsLoading(true);

        let finalPhysicalCopyUrl = physicalCopyUrl;

        if (physicalCopyUrl && physicalCopyUrl.startsWith('data:')) {
            const storageRef = ref(storage, `dispatch_documents/${activity.id}/${new Date().getTime()}.jpg`);
            try {
                // uploadString is efficient for data URLs
                const snapshot = await uploadString(storageRef, physicalCopyUrl, 'data_url');
                finalPhysicalCopyUrl = await getDownloadURL(snapshot.ref);
            } catch (error) {
                console.error("Error uploading dispatch document:", error);
                toast({
                    variant: 'destructive',
                    title: 'Erro de Upload',
                    description: 'Não foi possível salvar o documento anexado. Tente novamente.',
                });
                setIsLoading(false);
                return;
            }
        }

        const signatureData: SignatureData = {
            signedBy: transporterName,
            signedAt: new Date().toISOString(),
            physicalCopyUrl: finalPhysicalCopyUrl || undefined,
        };

        await updateRepositionActivity(activity.id, {
            status: 'Aguardando recebimento',
            transportSignature: transporterName ? signatureData : {},
        });

        setIsLoading(false);
        onOpenChange(false);
    }
    
    const handlePhotoCaptured = (dataUrl: string) => {
        setPhysicalCopyUrl(dataUrl);
        setIsPhotoModalOpen(false);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPhysicalCopyUrl(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };
    
    return (
        <>
        <Dialog open={true} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Gerenciar despacho de reposição</DialogTitle>
                     <div className="flex items-center justify-center gap-2 pt-4">
                        <Badge variant="destructive" className="flex gap-2 items-center text-base py-1 px-4">
                            <Warehouse className="h-4 w-4" />
                            SAÍDA: {activity.kioskOriginName}
                        </Badge>
                        <ArrowRight className="h-5 w-5 text-muted-foreground" />
                        <Badge variant="secondary" className="flex gap-2 items-center text-base py-1 px-4 bg-green-600 hover:bg-green-700 text-white">
                            <Warehouse className="h-4 w-4" />
                            ENTRADA: {activity.kioskDestinationName}
                        </Badge>
                    </div>
                </DialogHeader>
                <div className="py-4 space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold">Conferência dos itens</h3>
                        <p className="text-sm text-muted-foreground mb-2">Revise os itens e as quantidades que serão transportados.</p>
                        <ScrollArea className="max-h-48">
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
                    </div>
                    
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">Dados do Transporte (Opcional)</h3>
                        <div>
                            <Label htmlFor="transporter-name">Nome do transportador</Label>
                            <Input 
                                id="transporter-name" 
                                value={transporterName} 
                                onChange={(e) => setTransporterName(e.target.value)}
                                placeholder="Digite o nome completo"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Anexar documento de despacho</Label>
                            {physicalCopyUrl ? (
                                <div className="relative w-40 h-40">
                                    <Image src={physicalCopyUrl} alt="Documento Anexado" layout="fill" className="rounded-md object-cover" />
                                    <Button type="button" variant="destructive" size="icon" className="absolute -top-2 -right-2 h-7 w-7 rounded-full" onClick={() => setPhysicalCopyUrl(null)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <Button type="button" variant="outline" onClick={() => setIsPhotoModalOpen(true)}>
                                        <Camera className="mr-2 h-4 w-4" /> Tirar Foto
                                    </Button>
                                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                        <Upload className="mr-2 h-4 w-4" /> Anexar Arquivo
                                    </Button>
                                    <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <DialogFooter className="pt-4 border-t">
                     <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleConfirmDispatch} disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Send className="mr-2 h-4 w-4" />}
                        {isLoading ? "Confirmando..." : "Confirmar e Despachar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {isPhotoModalOpen && (
             <PhotoCaptureModal
                open={isPhotoModalOpen}
                onOpenChange={setIsPhotoModalOpen}
                onPhotoCaptured={handlePhotoCaptured}
            />
        )}
        </>
    );
}
