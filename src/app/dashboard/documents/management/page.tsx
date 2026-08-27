"use client";

import Link from "next/link";
import { ChevronRight, FilePlus2, FileStack } from "lucide-react";

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
    tone: "bg-violet-50 text-violet-700",
    permission: "templates.view" as FormalizationAction,
  },
  {
    title: "Gerador de documentos",
    description: "Gere documentos avulsos usando somente modelos publicados para geração direta.",
    href: "/dashboard/documents/generator",
    icon: FilePlus2,
    tone: "bg-emerald-50 text-emerald-700",
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
      <header>
        <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
          Documentos
        </p>
        <h1 className="text-xl font-black text-slate-950">Gestão de documentos</h1>
        <p className="text-xs text-slate-500">
          Administração dos modelos e geração avulsa de documentos.
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map(({ title, description, href, icon: Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className="group flex min-h-36 items-start gap-3 rounded-lg border bg-white p-4 shadow-sm transition hover:border-teal-200 hover:shadow-md"
          >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${tone}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-slate-900">{title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
            </span>
            <ChevronRight className="mt-3 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-700" />
          </Link>
        ))}
      </div>
    </div>
  );
}
