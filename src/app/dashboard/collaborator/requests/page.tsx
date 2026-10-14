"use client";

import { CollaboratorRequestsPage } from "@/features/hr/requests/collaborator-requests-page";
import { useAuth } from "@/hooks/use-auth";

export default function MyRequestsPage() {
  const { permissions } = useAuth();
  const canView = permissions.dashboard.collaborator ?? permissions.dashboard.view;
  if (!canView) return <p className="p-6 text-muted-foreground">Sem permissão para acessar o Painel do colaborador.</p>;
  return <CollaboratorRequestsPage />;
}
