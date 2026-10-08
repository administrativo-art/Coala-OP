
"use client"

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScanner, type Html5QrcodeResult, Html5QrcodeScannerState } from 'html5-qrcode';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type BarcodeScannerModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onScanSuccess: (decodedText: string) => void;
};

const QRCODE_REGION_ID = "barcode-scanner-region";

export function BarcodeScannerModal({ open, onOpenChange, onScanSuccess }: BarcodeScannerModalProps) {
    const scannerRef = useRef<Html5QrcodeScanner | null>(null);
    const [permissionState, setPermissionState] = useState<'loading' | 'granted' | 'denied'>('loading');
    const [manualCode, setManualCode] = useState('');

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
            setManualCode('');

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

        const onScanFailureCallback = (error: any) => {
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

    const submitManualCode = () => {
        const code = manualCode.replace(/\s+/g, '');
        if (code) onScanSuccess(code);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                hideClose
                flush
                className="flex h-[min(620px,calc(100dvh-1rem))] w-[calc(100vw-1rem)] max-w-[420px] flex-col gap-0 overflow-hidden rounded-[26px] border-0 bg-[#15151c] text-[#f3f2ee] shadow-[0_30px_80px_rgba(0,0,0,.4)] sm:w-[calc(100vw-2rem)] sm:rounded-[26px]"
            >
                <DialogTitle className="sr-only">Escanear código de barras</DialogTitle>
                <DialogDescription className="sr-only">Aponte a câmera para o código de barras do produto.</DialogDescription>
                <div className="flex items-center justify-between px-[22px] pb-3.5 pt-5">
                    <span className="flex flex-col gap-1">
                        <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">Câmera</span>
                        <span className="text-[17px] font-extrabold">Escanear código de barras</span>
                    </span>
                    <button type="button" onClick={() => onOpenChange(false)} aria-label="Fechar" className="h-[34px] w-[34px] rounded-[10px] border border-white/15 text-base text-[#c8c7d0] hover:bg-white/10">×</button>
                </div>
                <div className="relative mx-4 flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-[20px] bg-[#0c0c11] [&_a]:text-[#f08bb1] [&_button]:rounded-lg [&_button]:border [&_button]:border-white/20 [&_button]:bg-white/10 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-xs [&_button]:text-white [&_select]:rounded-lg [&_select]:bg-white/10 [&_select]:p-1.5 [&_select]:text-xs [&_select]:text-white">
                    {permissionState === 'loading' && <span className="text-[13px] text-[#a3a2ad]">Solicitando permissão da câmera…</span>}
                    {permissionState === 'denied' && (
                        <div role="alert" className="m-5 flex flex-col gap-1.5 rounded-[14px] border border-[#fb7185]/30 bg-[#fb7185]/10 p-4">
                            <b className="text-sm text-[#fecdd6]">Acesso à câmera negado</b>
                            <span className="text-[12.5px] leading-normal text-[#e7c6cd]">Libere a câmera nas configurações do navegador ou digite o código abaixo.</span>
                        </div>
                    )}
                    {permissionState === 'granted' && <div id={QRCODE_REGION_ID} className="w-full" />}
                </div>
                <div className="flex gap-2 p-4">
                    <input
                        value={manualCode}
                        onChange={(event) => setManualCode(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitManualCode(); } }}
                        placeholder="Ou digite o código"
                        inputMode="numeric"
                        className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[.07] px-3.5 text-sm text-white outline-none placeholder:text-[#8e8d99] focus:border-[#f08bb1]"
                    />
                    <button type="button" onClick={submitManualCode} disabled={!manualCode.trim()} className="h-11 whitespace-nowrap rounded-xl bg-[#e0457f] px-4 text-[13.5px] font-extrabold text-white hover:bg-[#c93a6f] disabled:opacity-50">Buscar</button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
