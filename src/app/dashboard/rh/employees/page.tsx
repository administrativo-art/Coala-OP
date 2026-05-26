import type { Metadata } from 'next';
import { EmployeeListPage } from '@/features/rh/components/EmployeeListPage';

export const metadata: Metadata = {
  title: 'Colaboradores | Coala RH',
};

export default function EmployeesRoute() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Colaboradores</h1>
          <p className="text-sm text-gray-500 mt-0.5">Perfis e dados da equipe Coala Shakes</p>
        </div>
      </div>
      <EmployeeListPage />
    </div>
  );
}
