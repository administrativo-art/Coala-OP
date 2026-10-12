import type { Metadata } from 'next';

import { SignageAppInstall } from '@/components/signage/signage-app-install';

export const metadata: Metadata = { title: 'Coala · Aplicativos' };

/** Página dos aplicativos Coala Signage e Coala Go. Exige login; o pacote do monitor Samsung continua público. */
export default function SignageAppPage() {
  return <SignageAppInstall />;
}
