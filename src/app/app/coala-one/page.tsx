import type { Metadata } from 'next';

import { CoalaOneAppInstall } from '@/components/coala-one-app-install';

export const metadata: Metadata = { title: 'Coala One · Instalar no celular' };

/** Página de instalação do aplicativo Coala One. Exige login; o arquivo em `public/app/` é público por endereço direto. */
export default function CoalaOneAppPage() {
  return <CoalaOneAppInstall />;
}
