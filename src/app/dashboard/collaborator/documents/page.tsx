"use client";

import { OwnDocumentsPage } from "@/features/hr/documents/own-documents-page";
import { useAuth } from "@/hooks/use-auth";

export default function MyDocumentsPage() {
  const { permissions } = useAuth();
  const canView = permissions.dashboard.collaborator ?? permissions.dashboard.view;
  if (!canView) return <p className="p-6 text-muted-foreground">Sem permissão para acessar o Painel do colaborador.</p>;
  return <OwnDocumentsPage />;
}
