"use client";

import { CatalogoView } from '@/components/catalogo/catalogo-view';
import { useAuth } from '@/hooks/use-auth';
import { canViewTechnicalSheets } from '@/lib/commercial-permissions';

export default function CommercialPage() {
  const { permissions } = useAuth();
  const canAccessDashboard = permissions.dashboard?.view || permissions.dashboard?.collaborator;

  if (!canAccessDashboard || !canViewTechnicalSheets(permissions)) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar as fichas técnicas.</p>;
  }

  return <CatalogoView embedded />;
}
