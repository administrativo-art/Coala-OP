import type { Metadata } from 'next';
import { SyncPanel } from '@/features/rh/components/SyncPanel';

export const metadata: Metadata = {
  title: 'Sincronização Bizneo | Coala RH',
};

export default function SyncRoute() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Sincronização</h1>
        <p className="text-sm text-gray-500 mt-0.5">Status e controle da integração com Bizneo HR</p>
      </div>
      <SyncPanel />
    </div>
  );
}
