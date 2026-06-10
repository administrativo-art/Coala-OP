"use client";

import { CollaboratorDashboardPanel } from "@/components/collaborator-dashboard-panel";
import { useAuth } from "@/hooks/use-auth";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GlassCard } from "@/components/ui/glass-card";

export default function CollaboratorDashboardPage() {
  const { permissions } = useAuth();
  const canView = permissions.dashboard.collaborator ?? permissions.dashboard.view;

  if (!canView) {
    return (
      <div className="flex h-full items-center justify-center">
        <GlassCard className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Você não tem permissão para visualizar o painel do colaborador.
            </CardDescription>
          </CardHeader>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <CollaboratorDashboardPanel />
    </div>
  );
}
