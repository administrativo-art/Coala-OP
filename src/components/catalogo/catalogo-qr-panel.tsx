"use client";

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { PanelField } from '@/components/patterns/side-panel';
import { BIO_SITE_URL } from '@/lib/public-bio';
import { ExternalLink, Link2, Package, Printer, QrCode, ScanBarcode, Tags } from 'lucide-react';

const CATALOG_URL = 'https://op.coalashakes.com/catalogo';

type QrTarget = {
  id: string;
  kicker: string;
  title: string;
  hint: string;
  url: string;
  alt: string;
  /** Texto impresso acima do QR na folha. */
  printTitle: string;
  openLabel: string;
  /** Cor dos módulos do QR (somente o desenho, não a interface). */
  dark: string;
  fileName: string;
};

const QR_TARGETS: QrTarget[] = [
  {
    id: 'catalog',
    kicker: 'QR code do catálogo',
    title: 'Fichas técnicas',
    hint: 'Para balcão, cozinha e atendimento. Exige login.',
    url: CATALOG_URL,
    alt: 'QR code do catálogo de fichas técnicas',
    printTitle: 'Fichas técnicas',
    openLabel: 'Abrir catálogo',
    dark: '#1a1a2e',
    fileName: 'coala-catalogo-qr.png',
  },
  {
    id: 'bio',
    kicker: 'QR code da bio',
    title: 'Link na bio',
    hint: 'Para mesas, vitrines e embalagens. Página pública, sem login.',
    url: BIO_SITE_URL,
    alt: 'QR code da página pública Coala Shakes',
    printTitle: 'Coala Shakes · Link na bio',
    openLabel: 'Abrir página',
    dark: '#173768',
    fileName: 'coala-shakes-bio-qr.png',
  },
];

const QR_FEATURES = [
  {
    title: 'Catálogo de fichas técnicas',
    description: 'QR interno para consulta do modo de montagem e ficha técnica no celular, com login obrigatório.',
    icon: QrCode,
  },
  {
    title: 'Página da bio',
    description: 'QR público que abre o Link na bio, editado na Programação do Instagram.',
    icon: Link2,
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

function QrCard({ target }: { target: QrTarget }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(target.url, {
      width: 400,
      margin: 2,
      color: { dark: target.dark, light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => setError('Não foi possível gerar o QR code. Atualize a página e tente novamente.'));
  }, [target.url, target.dark]);

  const handlePrint = () => {
    setError(null);
    const printWindow = window.open('', '_blank');
    if (!printWindow || !dataUrl) {
      setError('O navegador bloqueou a janela de impressão. Libere pop-ups para este site e tente de novo.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR code — ${target.title}</title>
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
            <p class="title">${target.printTitle}</p>
            <img src="${dataUrl}" alt="QR code" />
          </div>
          <script>window.onload = () => { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <section className="space-y-5 self-start rounded-ds-card-lg border border-ds-border bg-ds-warm p-6">
      <header>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">{target.kicker}</p>
        <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em]">{target.title}</h2>
        <p className="mt-1 text-[13px] text-ds-ink-muted">{target.hint}</p>
      </header>

      <div className="flex justify-center">
        {dataUrl ? (
          <div className="rounded-ds-card border border-ds-border bg-white p-3 shadow-ds-lift">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt={target.alt} width={200} height={200} />
          </div>
        ) : (
          <div role="status" aria-label="Gerando QR code" className="h-[226px] w-[226px] animate-pulse rounded-ds-card border border-ds-border bg-ds-muted" />
        )}
      </div>

      <PanelField label="Destino">
        <span className="break-all font-ds-mono text-xs">{target.url}</span>
      </PanelField>

      {error ? (
        <p role="alert" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3.5 py-[11px] text-[12.5px] leading-normal text-ds-alert-ink">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="primary-page" size="md" onClick={handlePrint} disabled={!dataUrl}>
          <Printer aria-hidden="true" className="mr-1.5 h-4 w-4" />
          Imprimir QR code
        </Button>
        <Button variant="ds-secondary" size="md" asChild>
          <a href={target.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden="true" className="mr-1.5 h-4 w-4" />
            {target.openLabel}
          </a>
        </Button>
        <Button variant="ds-secondary" size="md" asChild className="col-span-2">
          <a href={dataUrl ?? undefined} download={target.fileName} aria-disabled={!dataUrl}>Baixar QR code (PNG)</a>
        </Button>
      </div>
    </section>
  );
}

export function CatalogoQRPanel() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(300px,400px)_minmax(300px,400px)_minmax(0,1fr)]">
      {QR_TARGETS.map((target) => <QrCard key={target.id} target={target} />)}

      <section className="rounded-ds-card-lg border border-ds-border bg-ds-warm">
        <header className="border-b border-ds-divider px-6 py-4">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Em uso no sistema</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em]">QR codes, etiquetas e scanner</h2>
          <p className="mt-1 text-[13px] text-ds-ink-muted">
            Funcionalidades que já usam QR code, código de barras ou leitura por scanner.
          </p>
        </header>
        <ul className="m-0 list-none p-0">
          {QR_FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.title} className="flex items-start gap-3.5 border-b border-ds-divider px-6 py-4 last:border-b-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ds-btn bg-ds-accent-soft text-ds-accent-ink">
                  <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold">{feature.title}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-ds-ink-muted">{feature.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
