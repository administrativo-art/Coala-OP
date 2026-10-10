"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { COALA_ONE_APP_INSTALLER } from '@/lib/coala-one-app';

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
 * Instalador do aplicativo Coala One para celulares e tablets Android, atrás de login.
 * O que cada pessoa pode fazer no aplicativo vem do perfil dela, na lista "Coala One · APP".
 */
export function CoalaOneAppInstall() {
  const router = useRouter();
  const { isAuthenticated, loading } = useAuth();
  const { packagePath, version, sizeLabel } = COALA_ONE_APP_INSTALLER;

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace('/login?next=%2Fapp%2Fcoala-one');
  }, [isAuthenticated, loading, router]);

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
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Coala One</p>
        <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.02em] text-ds-ink">Instalar no celular</h1>
        <p className="mt-2 max-w-[640px] text-[14px] text-ds-ink-muted">
          O aplicativo usa o mesmo e-mail e a mesma senha do Coala One. As funções que aparecem para cada pessoa dependem do perfil de permissões dela, na lista “Coala One · APP”.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <section className="flex flex-col rounded-ds-card border border-ds-border bg-ds-surface p-6">
            <h2 className="text-[17px] font-extrabold text-ds-ink">Android</h2>
            <p className="mt-1 text-[13px] text-ds-ink-muted">Celulares e tablets com Android 7 ou superior.</p>
            <Steps
              items={[
                'Abra esta página no navegador do próprio aparelho e toque em Baixar.',
                'Abra o arquivo baixado e permita a instalação de apps desta fonte.',
                'Abra o Coala One e entre com o seu e-mail e a sua senha.',
              ]}
            />
            <div className="mt-auto pt-6">
              {packagePath ? (
                <Button asChild variant="ds-secondary" size="md">
                  <a href={packagePath} download>
                    <Download aria-hidden="true" className="h-4 w-4" />
                    Baixar para Android
                  </a>
                </Button>
              ) : (
                <Button type="button" variant="ds-secondary" size="md" disabled>
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Baixar para Android
                </Button>
              )}
              <p className="mt-2 text-xs text-ds-ink-muted">
                {packagePath ? `Versão ${version}${sizeLabel ? ` · ${sizeLabel}` : ''}. Para atualizar, baixe e instale por cima; não é preciso desinstalar.` : 'O instalador para Android ainda não está disponível.'}
              </p>
            </div>
          </section>

          <section className="flex flex-col rounded-ds-card border border-ds-border bg-ds-surface p-6">
            <h2 className="text-[17px] font-extrabold text-ds-ink">O que o aplicativo faz</h2>
            <p className="mt-1 text-[13px] text-ds-ink-muted">Cada função só aparece para quem tem a permissão correspondente.</p>
            <Steps
              items={[
                'Compra local: envia a nota de uma sangria ou de uma compra paga pela empresa.',
                'Contagem de estoque e Recebimento da reposição na unidade.',
                'Metas e Escala das unidades em que a pessoa está lotada.',
              ]}
            />
            <p className="mt-auto pt-6 text-xs text-ds-ink-muted">iPhone ainda não é atendido: o aplicativo existe apenas para Android.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
