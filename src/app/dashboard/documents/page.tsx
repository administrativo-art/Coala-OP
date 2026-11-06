"use client";

import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasCompanyArchiveTab, useCompanyArchiveAccess } from "@/features/documents/central/archive-explorer";
import { CompanyArchive } from "@/features/documents/central/company-archive";
import { CollaboratorArchive } from "@/features/documents/central/collaborator-archive";

/**
 * Acervo abre direto na aba Empresa (pastas da empresa). Quem não vê nenhuma pasta da
 * empresa abre na aba Colaborador, que mostra só a própria pasta quando não há permissão para mais.
 */
export default function DocumentsPage() {
  const { loading } = useAuth();
  const access = useCompanyArchiveAccess();
  if (loading) return <div role="status" className="grid min-h-64 place-items-center"><Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-ds-ink-muted" /><span className="sr-only">Carregando Acervo</span></div>;
  return hasCompanyArchiveTab(access) ? <CompanyArchive /> : <CollaboratorArchive />;
}
