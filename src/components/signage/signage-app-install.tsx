"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useAuthenticatedApi } from '@/hooks/use-authenticated-api';
import { COALA_APP_DOWNLOAD_CHUNK_BYTES, COALA_APP_INSTALLERS, planDownloadRanges } from '@/lib/signage';

type Platform = 'signage' | 'mobile';

/**
 * Baixa o instalador em partes e devolve o arquivo inteiro. A primeira parte informa o tamanho
 * total (`Content-Range`); qualquer parte incompleta interrompe o download com erro.
 */
async function downloadInParts(packagePath: string, onProgress: (percent: number) => void) {
  const fetchPart = async (start: number, end: number) => {
    const response = await fetch(packagePath, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store' });
    if (response.status !== 206) throw new Error('O servidor não entregou o instalador em partes.');
    return response;
  };
  const first = await fetchPart(0, COALA_APP_DOWNLOAD_CHUNK_BYTES - 1);
  const total = Number(/\/(\d+)$/.exec(first.headers.get('Content-Range') ?? '')?.[1]);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Não foi possível ler o tamanho do instalador.');
  const ranges = planDownloadRanges(total);
  const parts: ArrayBuffer[] = [];
  let received = 0;
  for (const [index, range] of ranges.entries()) {
    const part = await (index === 0 ? first : await fetchPart(range.start, range.end)).arrayBuffer();
    if (part.byteLength !== range.end - range.start + 1) throw new Error('O download foi interrompido. Tente de novo.');
    parts.push(part);
    received += part.byteLength;
    onProgress(Math.round((received / total) * 100));
  }
  return new Blob(parts, { type: first.headers.get('Content-Type') ?? 'application/octet-stream' });
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-4 space-y-2.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-[13.5px] leading-snug text-ds-ink-2">
          <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ds-muted text-[11px] font-extrabold text-ds-ink-muted">{index + 1}</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Aplicativos do Coala, atrás de login: a abertura da página e cada download ficam registrados
 * com o usuário. São dois produtos diferentes: o Coala Signage APP, que vai nas telas, e o
 * Coala Mobile APP, para smartphones e tablets Android. O monitor Samsung não faz login, então
 * o pacote do Signage segue público no endereço do URL Launcher.
 */
export function SignageAppInstall() {
  const router = useRouter();
  const request = useAuthenticatedApi();
  const { isAuthenticated, loading } = useAuth();
  const [downloading, setDownloading] = useState<Platform | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viewLogged = useRef(false);
  const { signage, mobile } = COALA_APP_INSTALLERS;
  const launcherUrl = typeof window !== 'undefined' ? `${window.location.origin}${signage.launcherPath}` : signage.launcherPath;

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login?next=%2Fapp');
  }, [isAuthenticated, loading, router]);

  useEffect(() => {
    if (loading || !isAuthenticated || viewLogged.current) return;
    viewLogged.current = true;
    // O registro de acesso não pode impedir ninguém de ver a página.
    void request('/api/signage/app/downloads', { method: 'POST', json: { platform: 'page', event: 'view' } }).catch(() => undefined);
  }, [isAuthenticated, loading, request]);

  async function handleDownload(platform: Platform, packagePath: string) {
    try {
      setDownloading(platform);
      setError(null);
      // Sem o registro o download não começa: é ele que diz quem baixou.
      await request('/api/signage/app/downloads', { method: 'POST', json: { platform, event: 'download' }, fallbackError: 'Não foi possível registrar o download.' });
      setProgress(0);
      const url = URL.createObjectURL(await downloadInParts(packagePath, setProgress));
      const link = document.createElement('a');
      link.href = url;
      link.download = packagePath.split('/').pop() ?? '';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // O navegador ainda está gravando o arquivo quando o clique retorna.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível baixar o instalador.');
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  }

  if (loading || !isAuthenticated) {
    return (
      <main className="min-h-screen bg-ds-page px-4 py-10 font-ds sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[960px] space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full rounded-ds-card" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ds-page px-4 py-10 font-ds sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[960px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Coala</p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ds-ink">Aplicativos</h1>
        <p className="mt-2 max-w-[640px] text-[14px] text-ds-ink-muted">
          São dois aplicativos diferentes: um vai nas telas das unidades, o outro no celular ou tablet. Os downloads ficam registrados com o seu usuário.
        </p>
        {error && <p role="alert" className="mt-4 text-[13px] font-semibold text-ds-danger">{error}</p>}

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <section className="flex flex-col rounded-ds-card border border-ds-border bg-ds-surface p-6">
            <h2 className="text-[17px] font-extrabold text-ds-ink">Coala Signage APP</h2>
            <p className="mt-1 text-[13px] text-ds-ink-muted">Para as telas das unidades: monitores profissionais Samsung (linha QM e similares).</p>
            <Steps
              items={[
                'No monitor, abra o menu e entre em URL Launcher.',
                <>
                  Informe o endereço de instalação:
                  <span className="mt-1 block break-all font-ds-mono text-[12.5px] font-bold text-ds-ink">{launcherUrl}</span>
                </>,
                'O monitor baixa e abre o app sozinho, sem login, e mostra um QR code.',
                'No aplicativo Coala One, abra Signage, toque em “Adicionar tela” e leia o QR code do monitor.',
              ]}
            />
            <div className="mt-auto pt-6">
              <Button type="button" variant="ds-secondary" size="md" loading={downloading === 'signage'} loadingLabel={progress === null ? 'Registrando…' : `Baixando… ${progress}%`} disabled={downloading !== null} onClick={() => void handleDownload('signage', signage.packagePath)}>
                <Download aria-hidden="true" className="h-4 w-4" />
                Baixar Coala Signage APP
              </Button>
              <p className="mt-2 text-xs text-ds-ink-muted">O arquivo .wgt só é necessário para instalar por pendrive.</p>
            </div>
          </section>

          <section className="flex flex-col rounded-ds-card border border-ds-border bg-ds-surface p-6">
            <h2 className="text-[17px] font-extrabold text-ds-ink">Coala Mobile APP</h2>
            <p className="mt-1 text-[13px] text-ds-ink-muted">Para smartphones e tablets Android.</p>
            <Steps
              items={[
                'Abra esta página no navegador do aparelho e baixe o instalador.',
                'Abra o arquivo baixado e permita a instalação de apps desta fonte.',
                'Abra o Coala One no aparelho e entre com o seu usuário do sistema.',
              ]}
            />
            <div className="mt-auto pt-6">
              <Button
                type="button"
                variant="ds-secondary"
                size="md"
                loading={downloading === 'mobile'}
                loadingLabel={progress === null ? 'Registrando…' : `Baixando… ${progress}%`}
                disabled={!mobile.packagePath || downloading !== null}
                onClick={() => { if (mobile.packagePath) void handleDownload('mobile', mobile.packagePath); }}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Baixar Coala Mobile APP
              </Button>
              {!mobile.packagePath && <p className="mt-2 text-xs text-ds-ink-muted">O instalador do Coala Mobile ainda não está disponível.</p>}
            </div>
          </section>
        </div>

      </div>
    </main>
  );
}
