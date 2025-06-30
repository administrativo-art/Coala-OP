"use client"

import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner, Html5QrcodeError, Html5QrcodeResult, Html5QrcodeScannerState } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from "@/hooks/use-toast"

type BarcodeScannerModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onScanSuccess: (decodedText: string) => void;
};

const QRCODE_REGION_ID = "barcode-scanner-region";

export function BarcodeScannerModal({ open, onOpenChange, onScanSuccess }: BarcodeScannerModalProps) {
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (!open) {
            // If the modal is closed, ensure the scanner is cleared.
            if (scannerRef.current && scannerRef.current.getState() === Html5QrcodeScannerState.SCANNING) {
                scannerRef.current.clear().catch(err => console.error("Failed to clear scanner on close", err));
                scannerRef.current = null;
            }
            return;
        }

        // --- Scanner initialization logic ---
        const initializeScanner = () => {
            // Prevent re-initialization
            if (scannerRef.current) {
                return;
            }

            const onScanSuccessCallback = (decodedText: string, decodedResult: Html5QrcodeResult) => {
                onScanSuccess(decodedText);
            };

            const onScanFailureCallback = (error: Html5QrcodeError) => {
                // This callback is called frequently, so we typically ignore errors here.
            };

            // Ensure the container element is in the DOM
            const container = document.getElementById(QRCODE_REGION_ID);
            if (!container) {
                console.error(`Scanner container #${QRCODE_REGION_ID} not found.`);
                return;
            }
            
            try {
                const newScanner = new Html5QrcodeScanner(
                    QRCODE_REGION_ID,
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 250 },
                        rememberLastUsedCamera: true,
                        supportedScanTypes: [], // This forces file-based scanning to be hidden
                    },
                    /* verbose= */ false 
                );
                
                newScanner.render(onScanSuccessCallback, onScanFailureCallback);
                scannerRef.current = newScanner;

            } catch (error) {
                console.error('Error initializing scanner:', error);
                toast({
                    variant: 'destructive',
                    title: 'Erro de Câmera',
                    description: 'Não foi possível iniciar o leitor. Verifique as permissões da câmera em seu navegador e atualize a página.',
                });
            }
        };

        // A short timeout ensures the modal's animation is complete and the
        // container div is ready in the DOM before we try to initialize the scanner.
        const timerId = setTimeout(initializeScanner, 300);

        return () => {
            clearTimeout(timerId);
             if (scannerRef.current && scannerRef.current.getState() === Html5QrcodeScannerState.SCANNING) {
                scannerRef.current.clear().catch(error => {
                    console.error("Failed to clear scanner on cleanup.", error);
                });
                scannerRef.current = null;
            }
        };

    }, [open, onScanSuccess, toast]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Escanear código de barras</DialogTitle>
                    <DialogDescription>
                        Aponte a câmera para o código de barras do produto.
                    </DialogDescription>
                </DialogHeader>
                {/* The div needs a min-height to be visible before the scanner initializes */}
                <div className="py-4 min-h-[300px]">
                    <div id={QRCODE_REGION_ID} className="w-full" />
                </div>
            </DialogContent>
        </Dialog>
    );
}
