"use client";

import Link from "next/link";
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
  return <Link href="/dashboard/documents/generator/models" className="inline-block rounded-md border bg-white px-3 py-2 text-sm font-semibold text-teal-800">Criar e gerenciar modelos</Link>;
}
