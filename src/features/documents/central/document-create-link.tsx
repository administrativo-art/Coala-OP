"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

export function DocumentCreateLink() {
  const {permissions, isDefaultAdmin} = useAuth();
  if (!hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin) ||
      !hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin)) return null;
  return <Link href="/dashboard/documents/generator" className="rounded-md px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50">Criar documento</Link>;
}

export function DocumentModelsLink() {
  const {permissions, isDefaultAdmin} = useAuth();
  if (!hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin)) return null;
  return (
    <Button asChild variant="ds-secondary" size="sm" className="h-11 rounded-ds-btn px-3.5 text-[13px] sm:h-9">
      <Link href="/dashboard/documents/generator/models">Criar e gerenciar modelos</Link>
    </Button>
  );
}
