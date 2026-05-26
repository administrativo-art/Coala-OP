import type { Metadata } from 'next';
import { RolesConfigPage } from '@/features/rh/components/RolesConfigPage';

export const metadata: Metadata = {
  title: 'Funções RH | Coala RH',
};

export default function RolesConfigRoute() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Funções de Acesso RH</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Visualize quem tem acesso ao módulo RH e com qual nível de permissão
        </p>
      </div>
      <RolesConfigPage />
    </div>
  );
}
