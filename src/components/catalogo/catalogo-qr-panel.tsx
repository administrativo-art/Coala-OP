"use client";

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Printer, QrCode, ExternalLink } from 'lucide-react';

const CATALOG_URL = 'https://op.coalashakes.com/catalogo';

export function CatalogoQRPanel() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    QRCode.toDataURL(CATALOG_URL, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    }).then(setDataUrl);
  }, []);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow || !dataUrl) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR Code — Catálogo de Mercadorias</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: white; }
            .card { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 40px; border: 2px solid #e5e7eb; border-radius: 16px; max-width: 360px; }
            .title { font-size: 18px; font-weight: 700; color: #1a1a2e; text-align: center; }
            .subtitle { font-size: 13px; color: #6b7280; text-align: center; line-height: 1.5; }
            img { width: 240px; height: 240px; }
            .url { font-size: 11px; color: #9ca3af; word-break: break-all; text-align: center; }
          </style>
        </head>
        <body>
          <div class="card">
            <p class="title">Cardápio de Mercadorias</p>
            <img src="${dataUrl}" alt="QR Code" />
            <p class="subtitle">Escaneie para consultar o modo de montagem e ficha técnica</p>
            <p class="url">${CATALOG_URL}</p>
          </div>
          <script>window.onload = () => { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="rounded-xl border bg-card p-6 space-y-5 max-w-sm">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold">QR Code do Catálogo</p>
          <p className="text-xs text-muted-foreground">Imprima e cole no balcão ou cozinha</p>
        </div>
      </div>

      {/* QR Code */}
      <div className="flex justify-center">
        {dataUrl ? (
          <div className="rounded-xl overflow-hidden border p-3 bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt="QR Code catálogo" width={180} height={180} />
          </div>
        ) : (
          <div
            className="rounded-xl border bg-muted animate-pulse"
            style={{ width: 180 + 24, height: 180 + 24 }}
          />
        )}
      </div>

      {/* URL */}
      <p className="text-xs text-center text-muted-foreground break-all">{CATALOG_URL}</p>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={handlePrint}
          disabled={!dataUrl}
        >
          <Printer className="h-3.5 w-3.5" />
          Imprimir
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          asChild
        >
          <a href={CATALOG_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir
          </a>
        </Button>
      </div>
    </div>
  );
}
