"use client";

import Link from "next/link";
import { ChevronDown, FilePlus2, LayoutTemplate, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

/**
 * Duas funcionalidades diferentes, dois botões:
 * - Gerar documento: o gerador monta documentos do sistema a partir dos dados (modelos oficiais).
 * - Criar documento: o editor; a pessoa escolhe partir de um modelo publicado ou começar em branco.
 */
export function DocumentCreateLink() {
  const {permissions, isDefaultAdmin} = useAuth();
  const canGenerate = hasFormalizationPermission(permissions, "documents.generate", isDefaultAdmin);
  const canUseGenerator = canGenerate && hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin);
  if (!canGenerate) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canUseGenerator && <Button asChild variant="ds-secondary" size="sm"><Link href="/dashboard/documents/generator"><Wand2 aria-hidden="true" className="mr-1.5 h-4 w-4" />Gerar documento</Link></Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ds-secondary" size="sm"><FilePlus2 aria-hidden="true" className="mr-1.5 h-4 w-4" />Criar documento<ChevronDown aria-hidden="true" className="ml-1.5 h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem asChild>
            <Link href="/dashboard/documents/editor/templates" className="flex items-start gap-2.5">
              <LayoutTemplate aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span><span className="block text-[13px] font-semibold">Usar modelo</span><span className="block text-[11.5px] text-ds-ink-muted">Começa a partir de um modelo publicado</span></span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/documents/editor" className="flex items-start gap-2.5">
              <FilePlus2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span><span className="block text-[13px] font-semibold">Novo documento</span><span className="block text-[11.5px] text-ds-ink-muted">Começa em branco no editor</span></span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
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
