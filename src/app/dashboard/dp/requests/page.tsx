"use client";

import { HrRequestsPage } from "@/features/hr/requests/hr-requests-page";
import { useAuth } from "@/hooks/use-auth";

export default function DpRequestsPage() {
  const { permissions, isDefaultAdmin } = useAuth();
  if (!isDefaultAdmin && permissions.dp?.requests?.view !== true) {
    return <p className="p-6 text-muted-foreground">Sem permissão para acessar Solicitações.</p>;
  }
  return <HrRequestsPage />;
}
