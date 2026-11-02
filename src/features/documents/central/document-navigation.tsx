"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

export function DocumentNavigation({ active }: { active: "archive" | "work" | "history" | "generator" }) {
  const { permissions, isDefaultAdmin } = useAuth();
  const canGenerate = hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin)
    && hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin);
  const links = [
    { id: "archive", name: "Acervo", href: "/dashboard/documents" },
    ...(canGenerate || hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin) ? [{ id: "generator", name: "Gerador de documentos", href: "/dashboard/documents/generator" }] : []),
    { id: "work", name: "Fluxos e pendências", href: "/dashboard/documents/generated" },
    { id: "history", name: "Histórico", href: "/dashboard/documents/history" },
  ];
  return <nav aria-label="Documentos" className="flex flex-wrap gap-1 text-xs">
    {links.map((link) => <Link key={link.id} href={link.href} aria-current={active === link.id ? "page" : undefined} className={`rounded-md px-3 py-2 ${active === link.id ? "bg-teal-50 font-bold text-teal-800" : "hover:bg-slate-50"}`}>{link.name}</Link>)}
    {canGenerate && active !== "generator" && <Link href="/dashboard/documents/generator" className="rounded-md px-3 py-2 font-semibold text-teal-800 hover:bg-teal-50">Criar documento</Link>}
  </nav>;
}
