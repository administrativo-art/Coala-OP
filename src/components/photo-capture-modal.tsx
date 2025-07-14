
"use client"

import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Camera, CameraOff, Loader2 } from 'lucide-react';

type PhotoCaptureModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPhotoCaptured: (dataUrl: string) => void;
};

export function PhotoCaptureModal({ open, onOpenChange, onPhotoCaptured }: PhotoCaptureModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [permissionState, setPermissionState] = useState<'loading' | 'granted' | 'denied'>('loading');

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    }, []);

    const startCamera = useCallback(async () => {
        stopCamera();
        setPermissionState('loading');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setPermissionState('granted');
        } catch (error) {
            console.error('Error accessing rear camera:', error);
            try {
                 const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                 streamRef.current = stream;
                 if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                 }
                 setPermissionState('granted');
            } catch (fallbackError) {
                console.error('Error accessing fallback camera:', fallbackError);
                setPermissionState('denied');
            }
        }
    }, [stopCamera]);

    useEffect(() => {
        if (open) {
            startCamera();
        } else {
            stopCamera();
        }
        return () => stopCamera();
    }, [open, startCamera, stopCamera]);

    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            
            const MAX_WIDTH = 512;
            const MAX_HEIGHT = 512;
            let width = video.videoWidth;
            let height = video.videoHeight;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height = Math.round(height * (MAX_WIDTH / width));
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width = Math.round(width * (MAX_HEIGHT / height));
                    height = maxHeight;
                }
            }
            
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            if (context) {
                context.drawImage(video, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                onPhotoCaptured(dataUrl);
                onOpenChange(false);
            }
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Tirar foto do insumo</DialogTitle>
                    <DialogDescription>
                        Posicione o insumo na câmera e capture a imagem.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 min-h-[350px]">
                    <div className="w-full aspect-video rounded-md bg-muted overflow-hidden relative">
                        <video
                        ref={videoRef}
                        className="w-full h-full object-cover"
                        autoPlay
                        playsInline
                        muted
                        />

                        {permissionState === 'loading' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                            <Loader2 className="h-8 w-8 animate-spin mb-4 text-muted-foreground" />
                            <p className="text-muted-foreground">Acessando a câmera...</p>
                        </div>
                        )}
                    </div>

                    {permissionState === 'denied' && (
                        <Alert variant="destructive" className="mt-4">
                        <CameraOff className="h-4 w-4" />
                        <AlertTitle>Acesso à câmera negado</AlertTitle>
                        <AlertDescription>
                            Para tirar fotos, você precisa permitir o acesso à câmera nas
                            configurações do seu navegador.
                        </AlertDescription>
                        </Alert>
                    )}

                    <canvas ref={canvasRef} className="hidden" />
                </div>
                 <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleCapture} disabled={permissionState !== 'granted'}>
                        <Camera className="mr-2" /> Capturar foto
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
