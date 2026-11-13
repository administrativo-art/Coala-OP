'use client';

import { GuiaMetas } from '@/components/goals/guide/GuiaMetas';
import { PageHeader } from '@/components/layout/page-header';
import { PermissionGuard } from '@/components/permission-guard';
import { useAuth } from '@/hooks/use-auth';

export default function GoalsGuidePage() {
  const { permissions } = useAuth();
  return (
    <PermissionGuard allowed={Boolean(permissions.goals?.view || permissions.dashboard.collaborator || permissions.dashboard.view)}>
    <div className="w-full space-y-4 pb-12">
      <PageHeader title="Entenda a meta" back={{ fallbackHref: '/dashboard/goals', parentLabel: 'Metas de vendas' }} />
      <p className="rounded-ds-card border border-ds-divider bg-ds-accent-soft px-4 py-3 text-sm text-ds-ink">
        Exemplo interativo para entender a conta. Os valores reais dependem da meta da sua unidade,
        da competência e dos dias da escala publicada. Esta simulação não altera a meta nem o pagamento.
      </p>
      <GuiaMetas />
    </div>
    </PermissionGuard>
  );
}
