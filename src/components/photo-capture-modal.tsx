
"use client"

import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Camera, CameraOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
    const { toast } = useToast();

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
                toast({
                    variant: 'destructive',
                    title: 'Acesso à câmera negado',
                    description: 'Por favor, permita o acesso à câmera nas configurações do seu navegador.',
                });
            }
        }
    }, [stopCamera, toast]);

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
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (context) {
                context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
                const dataUrl = canvas.toDataURL('image/jpeg');
                onPhotoCaptured(dataUrl);
                onOpenChange(false);
            }
        }
    };
    
    const renderContent = () => {
        switch (permissionState) {
            case 'loading':
                return (
                    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin mb-4" />
                        <p>Acessando a câmera...</p>
                    </div>
                );
            case 'denied':
                 return (
                    <Alert variant="destructive">
                        <CameraOff className="h-4 w-4" />
                        <AlertTitle>Acesso à câmera negado</AlertTitle>
                        <AlertDescription>
                            Para tirar fotos, você precisa permitir o acesso à câmera nas configurações do seu navegador.
                        </AlertDescription>
                    </Alert>
                );
            case 'granted':
                return <video ref={videoRef} className="w-full aspect-video rounded-md bg-muted" autoPlay playsInline muted />;
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
                    {renderContent()}
                    <canvas ref={canvasRef} className="hidden" />
                </div>
                 <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleCapture} disabled={permissionState !== 'granted'}>
                        <Camera className="mr-2" /> Capturar Foto
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
