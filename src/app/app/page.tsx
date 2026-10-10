import type { Metadata } from 'next';

import { SignageAppInstall } from '@/components/signage/signage-app-install';

export const metadata: Metadata = { title: 'Coala · Aplicativos' };

/** Página dos aplicativos do Coala (Signage APP e Mobile APP). Exige login; o pacote do monitor Samsung continua público. */
export default function SignageAppPage() {
  return <SignageAppInstall />;
}
