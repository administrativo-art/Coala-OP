import type { Metadata } from 'next';
import { MyProfilePage } from '@/features/rh/components/MyProfilePage';

export const metadata: Metadata = {
  title: 'Meu Perfil | Coala RH',
};

export default function MeRoute() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="text-sm text-gray-500 mt-0.5">Visualize e atualize seus dados cadastrais</p>
      </div>
      <MyProfilePage />
    </div>
  );
}
