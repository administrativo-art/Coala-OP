"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { SidePanel } from "@/components/patterns/side-panel";
import { StatusPill } from "@/components/ui/status-pill";
import { fieldInputClass } from "@/components/patterns/field";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";
import { cn } from "@/lib/utils";

import { groupVariablesBySection } from "./editor-logic";

export function EditorFieldsPanel({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const sections = useMemo(() => groupVariablesBySection(DOCUMENT_VARIABLES, query), [query]);

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      kicker="Documento"
      title="Campos do sistema"
      subtitle="O valor real vem do cadastro do titular quando o documento for gerado."
      compact
    >
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-ink-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar campo do sistema"
          placeholder="Buscar campo ou seção"
          className={cn(fieldInputClass, "pl-9")}
        />
      </div>
      <p className="text-xs text-ds-ink-muted" aria-live="polite">
        {sections.length === 0
          ? "Nenhum campo encontrado."
          : `${sections.reduce((total, section) => total + section.items.length, 0)} campos`}
      </p>
      {sections.length === 0 ? (
        <p className="rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-4 text-[13px] text-ds-ink-muted">
          Nenhum campo corresponde à busca. Tente outra palavra ou limpe o campo de busca.
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.section} aria-label={section.section} className="space-y-1.5">
            <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{section.section}</h3>
            <ul className="space-y-1">
              {section.items.map((variable) => (
                <li key={variable.key}>
                  <button
                    type="button"
                    onClick={() => onInsert(variable.key)}
                    className="flex w-full items-center justify-between gap-2 rounded-ds-md border border-ds-border bg-ds-surface px-3 py-2 text-left text-[13px] font-semibold text-ds-ink hover:bg-ds-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-modal"
                    aria-label={`Inserir campo ${variable.label}${variable.sensitive ? " (dado sensível)" : ""}`}
                  >
                    <span className="min-w-0 break-words">{variable.label}</span>
                    {variable.sensitive ? <StatusPill variant="warn">Sensível</StatusPill> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </SidePanel>
  );
}
