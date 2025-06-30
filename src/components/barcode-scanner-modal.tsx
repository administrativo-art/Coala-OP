"use client"

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScanner, type Html5QrcodeError, type Html5QrcodeResult, Html5QrcodeScannerState } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { CameraOff, Loader2 } from 'lucide-react';

type BarcodeScannerModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onScanSuccess: (decodedText: string) => void;
};

const QRCODE_REGION_ID = "barcode-scanner-region";

export function BarcodeScannerModal({ open, onOpenChange, onScanSuccess }: BarcodeScannerModalProps) {
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const [permissionState, setPermissionState] = useState<'loading' | 'granted' | 'denied'>('loading');

    // Function to gracefully stop the scanner
    const stopScanner = () => {
        if (scannerRef.current && scannerRef.current.getState() === Html5QrcodeScannerState.SCANNING) {
            scannerRef.current.clear().catch(err => {
                // This can sometimes fail if the component is unmounting, which is fine to ignore.
                console.error("Could not clear scanner:", err);
            });
            scannerRef.current = null;
        }
    };
    
    // This effect handles the entire lifecycle of the scanner based on the modal's `open` state.
    useEffect(() => {
        if (open) {
            setPermissionState('loading');
            
            // Check for camera permissions before trying to render the scanner
            Html5Qrcode.getCameras().then(cameras => {
                if (cameras && cameras.length) {
                    setPermissionState('granted');
                } else {
                    setPermissionState('denied');
                }
            }).catch(err => {
                console.error("Camera permission check failed:", err);
                setPermissionState('denied');
            });

        } else {
            stopScanner();
        }

        // Cleanup function to stop scanner on component unmount
        return () => {
            stopScanner();
        };
    }, [open]);

    // This effect initializes the scanner once permission is granted and the modal is open.
    useEffect(() => {
        if (permissionState !== 'granted' || !open) {
            return;
        }

        // Prevent re-initialization
        if (scannerRef.current) {
            return;
        }

        const onScanSuccessCallback = (decodedText: string, decodedResult: Html5QrcodeResult) => {
            onScanSuccess(decodedText);
        };

        const onScanFailureCallback = (error: Html5QrcodeError) => {
            // This is called frequently. We can ignore "errors" which are just non-scans.
        };

        // Ensure the container element is in the DOM
        const container = document.getElementById(QRCODE_REGION_ID);
        if (!container) {
            return;
        }
        
        // Initialize the scanner
        const newScanner = new Html5QrcodeScanner(
            QRCODE_REGION_ID,
            {
                fps: 10,
                qrbox: (viewfinderWidth, viewfinderHeight) => {
                    const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                    const qrboxSize = Math.floor(minEdge * 0.8);
                    return { width: qrboxSize, height: qrboxSize };
                },
                rememberLastUsedCamera: true,
                supportedScanTypes: [0], // 0 = SCAN_TYPE_CAMERA
            },
            /* verbose= */ false
        );
        
        newScanner.render(onScanSuccessCallback, onScanFailureCallback);
        scannerRef.current = newScanner;

    }, [permissionState, open, onScanSuccess]);

    const renderContent = () => {
        switch (permissionState) {
            case 'loading':
                return (
                    <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin mb-4" />
                        <p>Solicitando permissão da câmera...</p>
                    </div>
                );
            case 'denied':
                 return (
                    <Alert variant="destructive">
                        <CameraOff className="h-4 w-4" />
                        <AlertTitle>Acesso à câmera negado</AlertTitle>
                        <AlertDescription>
                            Para escanear códigos de barras, você precisa permitir o acesso à câmera nas configurações do seu navegador.
                        </AlertDescription>
                    </Alert>
                );
            case 'granted':
                // The scanner will be rendered into this div by the useEffect hook.
                return <div id={QRCODE_REGION_ID} className="w-full" />;
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Escanear código de barras</DialogTitle>
                    <DialogDescription>
                        Aponte a câmera para o código de barras do produto.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 min-h-[300px]">
                   {renderContent()}
                </div>
            </DialogContent>
        </Dialog>
    );
}
