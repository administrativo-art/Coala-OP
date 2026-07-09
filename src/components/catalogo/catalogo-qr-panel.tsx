"use client";

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { ExternalLink, Package, Printer, QrCode, ScanBarcode, Tags } from 'lucide-react';

const CATALOG_URL = 'https://op.coalashakes.com/catalogo';

const QR_FEATURES = [
  {
    title: 'Catálogo de fichas técnicas',
    description: 'QR público para consulta do modo de montagem e ficha técnica no celular.',
    icon: QrCode,
  },
  {
    title: 'Etiquetas patrimoniais',
    description: 'Código PAT com barras CODE-128 para placas físicas de patrimônio.',
    icon: Tags,
  },
  {
    title: 'Lotes e estoque',
    description: 'Etiquetas de lote com QR para rastreio operacional de estoque.',
    icon: Package,
  },
  {
    title: 'Leitura por scanner',
    description: 'Leitores de código de barras usados em produtos, compras e busca global.',
    icon: ScanBarcode,
  },
];

export function CatalogoQRPanel() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

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
          <title>QR code — Catálogo de mercadorias</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: white; }
            .card { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 40px; border: 2px solid #e5e7eb; border-radius: 16px; max-width: 360px; }
            .title { font-size: 18px; font-weight: 700; color: #1a1a2e; text-align: center; }
            img { width: 260px; height: 260px; }
          </style>
        </head>
        <body>
          <div class="card">
            <p class="title">Fichas técnicas</p>
            <img src="${dataUrl}" alt="QR code" />
          </div>
          <script>window.onload = () => { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_minmax(360px,1fr)]">
      <div className="rounded-xl border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Catálogo de fichas técnicas</p>
            <p className="text-xs text-muted-foreground">QR para balcão, cozinha e atendimento</p>
          </div>
        </div>

        <div className="flex justify-center">
          {dataUrl ? (
            <div className="rounded-xl overflow-hidden border p-3 bg-white shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl} alt="QR code do catálogo" width={180} height={180} />
            </div>
          ) : (
            <div
              className="rounded-xl border bg-muted animate-pulse"
              style={{ width: 180 + 24, height: 180 + 24 }}
            />
          )}
        </div>

        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Destino</p>
          <p className="mt-1 break-all text-xs text-foreground">{CATALOG_URL}</p>
        </div>

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

      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4">
          <p className="text-sm font-semibold">Funcionalidades com QR e códigos</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Itens do sistema que já usam QR code, código de barras ou scanner operacional.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {QR_FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">{feature.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
