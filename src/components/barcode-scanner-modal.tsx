
"use client"

import { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeError, Html5QrcodeResult, Html5QrcodeScannerState } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

type BarcodeScannerModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onScanSuccess: (decodedText: string) => void;
};

const QRCODE_REGION_ID = "barcode-scanner-region";

export function BarcodeScannerModal({ open, onOpenChange, onScanSuccess }: BarcodeScannerModalProps) {
    const [hasPermission, setHasPermission] = useState(true);
    const { toast } = useToast();
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        const timerId = setTimeout(() => {
            if (scannerRef.current) {
                return;
            }

            const onScanSuccessCallback = (decodedText: string, decodedResult: Html5QrcodeResult) => {
                onScanSuccess(decodedText);
            };

            const onScanFailureCallback = (error: Html5QrcodeError) => {
                // Ignore non-fatal errors (e.g., QR code not found in a frame)
            };
            
            try {
                const newScanner = new Html5QrcodeScanner(
                    QRCODE_REGION_ID,
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 250 },
                        rememberLastUsedCamera: true,
                    },
                    false 
                );
                
                newScanner.render(onScanSuccessCallback, onScanFailureCallback);
                scannerRef.current = newScanner;

            } catch (error) {
                console.error('Error constructing or rendering scanner:', error);
                setHasPermission(false);
                toast({
                    variant: 'destructive',
                    title: 'Erro de Câmera',
                    description: 'Não foi possível iniciar o leitor. Verifique as permissões da câmera.',
                });
            }
        }, 200);

        return () => {
            clearTimeout(timerId);
            if (scannerRef.current) {
                if (scannerRef.current.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
                    scannerRef.current.clear().catch(error => {
                        console.error("Failed to clear scanner on cleanup.", error);
                    });
                }
                scannerRef.current = null;
            }
        };
    }, [open, onScanSuccess, toast]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Escanear Código de Barras</DialogTitle>
                    <DialogDescription>
                        Aponte a câmera para o código de barras do produto.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <div id={QRCODE_REGION_ID} className="w-full" />
                    {!hasPermission && (
                        <Alert variant="destructive" className="mt-4">
                            <AlertTitle>Acesso à Câmera Negado</AlertTitle>
                            <AlertDescription>
                                Por favor, habilite o acesso à câmera nas configurações do seu navegador para usar esta funcionalidade.
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
