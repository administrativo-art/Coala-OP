"use client";

import { Building2, FilePlus2, FileStack, Users } from "lucide-react";
import { DocumentDestinationCard } from "@/components/documents/document-destination-card";
import { PageHero } from "@/components/patterns/page-hero";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission, type FormalizationAction } from "@/lib/hr-formalization-permissions";

const destinations = [
  {
    title: "Gestão de documentos",
    description: "Acesse separadamente os modelos e o gerador de documentos avulsos.",
    href: "/dashboard/documents/management",
    icon: FileStack,
    permissions: [
      "templates.view",
      "documents.generate",
    ] as FormalizationAction[],
  },
  {
    title: "Documentos da empresa",
    description: "Contratos, licenças, certidões e arquivos institucionais.",
    href: "/dashboard/documents/company",
    icon: Building2,
    permissions: ["companyDocuments.view"] as FormalizationAction[],
  },
  {
    title: "Documentos dos colaboradores",
    description: "Pastas individuais, validações e histórico funcional.",
    href: "/dashboard/documents/collaborators",
    icon: Users,
    permissions: ["documents.view"] as FormalizationAction[],
  },
  {
    title: "Central de documentos",
    description: "Fila, conferência, auditoria e trilha de assinatura dos documentos.",
    href: "/dashboard/documents/generated",
    icon: FilePlus2,
    permissions: ["documents.view"] as FormalizationAction[],
  },
];

export default function DocumentsPage() {
  const { permissions } = useAuth();
  const visibleDestinations = destinations.filter(({ permissions: required }) =>
    required.some((permission) =>
      hasFormalizationPermission(permissions, permission)
    )
  );
  return (
    <div className="space-y-4">
      <PageHero kicker="Gestão documental" title="Documentos" subtitle="Modelos, arquivos da empresa, pastas dos colaboradores e a central de assinatura." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {visibleDestinations.map(({ title, description, href, icon }) => (
          <DocumentDestinationCard key={href} title={title} description={description} href={href} icon={icon} />
        ))}
      </div>
    </div>
  );
}
