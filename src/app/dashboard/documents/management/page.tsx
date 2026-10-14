"use client";

import { FilePlus2, FileStack } from "lucide-react";

import { DocumentDestinationCard } from "@/components/documents/document-destination-card";
import { PageHero } from "@/components/patterns/page-hero";
import { useAuth } from "@/hooks/use-auth";
import {
  hasFormalizationPermission,
  type FormalizationAction,
} from "@/lib/hr-formalization-permissions";

const accesses = [
  {
    title: "Modelos de documentos",
    description: "Cadastre, prepare, revise e publique os modelos que podem ser usados pelo sistema.",
    href: "/dashboard/documents/templates",
    icon: FileStack,
    permission: "templates.view" as FormalizationAction,
  },
  {
    title: "Gerador de documentos",
    description: "Gere documentos avulsos usando somente modelos publicados para geração direta.",
    href: "/dashboard/documents/generator",
    icon: FilePlus2,
    permission: "documents.generate" as FormalizationAction,
  },
];

export default function DocumentManagementPage() {
  const { permissions } = useAuth();
  const visible = accesses.filter(({ permission }) =>
    hasFormalizationPermission(permissions, permission)
  );

  return (
    <div className="space-y-4">
      <PageHero kicker="Documentos" title="Gestão de documentos" subtitle="Administração dos modelos e geração avulsa de documentos." />
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map(({ title, description, href, icon }) => (
          <DocumentDestinationCard key={href} title={title} description={description} href={href} icon={icon} />
        ))}
      </div>
    </div>
  );
}
