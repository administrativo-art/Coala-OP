import type { Metadata } from 'next';
import { FieldConfigPage } from '@/features/rh/components/FieldConfigPage';

export const metadata: Metadata = {
  title: 'Configuração de Campos | Coala RH',
};

export default function FieldsConfigRoute() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campos do Perfil</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Visão geral do field_map — visibilidade, tipo e permissões de edição por campo
        </p>
      </div>
      <FieldConfigPage />
    </div>
  );
}
