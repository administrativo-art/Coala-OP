"use client"

import { useEffect, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeError, Html5QrcodeResult } from 'html5-qrcode';
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

    useEffect(() => {
        if (!open) {
            return;
        }

        let scanner: Html5QrcodeScanner | null = null;

        const onScanSuccessCallback = (decodedText: string, decodedResult: Html5QrcodeResult) => {
            if (scanner) {
                scanner.clear().catch(error => {
                    console.error("Failed to clear scanner.", error);
                });
            }
            onScanSuccess(decodedText);
        };

        const onScanFailureCallback = (error: Html5QrcodeError) => {
            // Ignore noises
        };

        try {
            scanner = new Html5QrcodeScanner(
                QRCODE_REGION_ID,
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    rememberLastUsedCamera: true,
                },
                false
            );
            scanner.render(onScanSuccessCallback, onScanFailureCallback);
            setHasPermission(true);
        } catch (error) {
            console.error('Error initializing scanner:', error);
            setHasPermission(false);
            toast({
              variant: 'destructive',
              title: 'Erro de Câmera',
              description: 'Não foi possível acessar a câmera. Verifique as permissões do seu navegador.',
            });
        }

        return () => {
            if (scanner && scanner.getState() !== 3) { // 3 is NOT_STARTED
                scanner.clear().catch(error => {
                    console.error("Failed to clear scanner on cleanup.", error);
                });
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
                    {hasPermission ? (
                        <div id={QRCODE_REGION_ID} className="w-full" />
                    ) : (
                        <Alert variant="destructive">
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
