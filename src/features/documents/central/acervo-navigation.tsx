"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

export function AcervoNavigation() {
  const pathname = usePathname();
  const { permissions } = useAuth();
  const folders = [
    { label: "Acervo", href: "/dashboard/documents", allowed: true },
    { label: "Empresa", href: "/dashboard/documents/company", allowed: hasFormalizationPermission(permissions, "companyDocuments.view") },
    { label: "Colaboradores", href: "/dashboard/documents/collaborators", allowed: hasFormalizationPermission(permissions, "documents.view") },
    { label: "Financeiro", href: "/dashboard/documents/financial", allowed: Boolean(permissions.financial?.view && permissions.financial?.inbox?.view) },
  ];
  return <nav aria-label="Pastas do Acervo" className="mb-4 flex flex-wrap gap-2 rounded-xl border bg-ds-warm p-3">{folders.filter((folder) => folder.allowed).map((folder) => <Link key={folder.href} href={folder.href} aria-current={pathname === folder.href ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm font-semibold ${pathname === folder.href ? "bg-ds-muted text-ds-ink" : "text-ds-ink-muted"}`}>{folder.label}</Link>)}</nav>;
}
