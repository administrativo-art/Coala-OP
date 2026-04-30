"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  onDetected: (barcode: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [nativeSupported, setNativeSupported] = useState(true);

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  useEffect(() => {
    if (manualMode) return;
    if (typeof window === 'undefined') return;

    const hasBarcodeDetector = 'BarcodeDetector' in window;
    if (!hasBarcodeDetector) {
      setNativeSupported(false);
      setManualMode(true);
      return;
    }

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
        });

        const scan = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            if (!cancelled) rafRef.current = requestAnimationFrame(scan);
            return;
          }
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const results: Array<{ rawValue: string }> = await detector.detect(videoRef.current);
            if (results.length > 0) {
              stopStream();
              onDetected(results[0].rawValue);
              return;
            }
          } catch { /* ignore per-frame errors */ }
          if (!cancelled) rafRef.current = requestAnimationFrame(scan);
        };

        rafRef.current = requestAnimationFrame(scan);
      } catch {
        if (!cancelled) {
          setCameraError('Câmera indisponível. Use a entrada manual.');
          setManualMode(true);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [manualMode, onDetected, stopStream]);

  const submitManual = () => {
    const v = manualValue.trim();
    if (!v) return;
    onDetected(v);
    setManualValue('');
  };

  return (
    <div className="rounded-lg border bg-card p-3 shadow-md space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-2">
          <Camera className="h-4 w-4" />
          Leitor de código de barras
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={manualMode ? 'Usar câmera' : 'Entrada manual'}
            onClick={() => setManualMode((v) => !v)}
          >
            <Keyboard className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {cameraError && (
        <p className="text-xs text-destructive">{cameraError}</p>
      )}

      {!manualMode && nativeSupported ? (
        <video
          ref={videoRef}
          className="w-full rounded aspect-video bg-black object-cover"
          muted
          playsInline
        />
      ) : (
        <div className="space-y-2">
          {!nativeSupported && (
            <p className="text-xs text-muted-foreground">
              Scanner não suportado neste navegador. Digite o código manualmente.
            </p>
          )}
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Código de barras..."
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitManual(); }
              }}
            />
            <Button type="button" size="sm" onClick={submitManual} disabled={!manualValue.trim()}>
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
