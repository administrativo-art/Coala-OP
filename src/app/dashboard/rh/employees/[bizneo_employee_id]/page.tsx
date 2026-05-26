import type { Metadata } from 'next';
import { ProfilePage } from '@/features/rh/components/ProfilePage';

export const metadata: Metadata = {
  title: 'Perfil do Colaborador | Coala RH',
};

export default async function EmployeeProfileRoute({
  params,
}: {
  params: Promise<{ bizneo_employee_id: string }>;
}) {
  const { bizneo_employee_id } = await params;
  return <ProfilePage bizneoEmployeeId={bizneo_employee_id} />;
}
