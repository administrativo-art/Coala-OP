"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { SidePanel } from "@/components/patterns/side-panel";
import { cn } from "@/lib/utils";

export type DreSourceIssue = {
  id: string;
  tone: "danger" | "warning";
  title: string;
  body: ReactNode;
  /** Impede considerar a DRE fechada e bloqueia a exportação. */
  blocksExport?: boolean;
};

/** Botão do painel escuro que reúne as pendências da DRE num só lugar. */
export function DreSourcesTrigger({ issues, onOpen }: { issues: DreSourceIssue[]; onOpen: () => void }) {
  if (issues.length === 0) return null;
  const danger = issues.some((issue) => issue.tone === "danger");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold ring-1 ring-inset transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
        danger ? "bg-ds-on-dark-danger/15 text-ds-on-dark-danger ring-ds-on-dark-danger/40" : "bg-ds-warn/15 text-ds-warn ring-ds-warn/40",
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      Conferir fontes · {issues.length}
    </button>
  );
}

export function DreSourcesPanel({ open, onOpenChange, issues }: { open: boolean; onOpenChange: (open: boolean) => void; issues: DreSourceIssue[] }) {
  const blocking = issues.filter((issue) => issue.blocksExport).length;
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      kicker="DRE"
      title="Conferir fontes"
      subtitle={issues.length === 0
        ? "Nenhuma pendência nas fontes deste filtro."
        : `${issues.length} ${issues.length === 1 ? "pendência" : "pendências"}${blocking ? ` · ${blocking} ${blocking === 1 ? "bloqueia" : "bloqueiam"} a exportação` : ""}`}
    >
      <div className="flex flex-col gap-3">
        {issues.map((issue) => (
          <section
            key={issue.id}
            className={cn(
              "rounded-ds-md border p-3.5 text-[13px]",
              issue.tone === "danger" ? "border-ds-confirm-border bg-ds-danger-bg" : "border-ds-alert-border bg-ds-alert-bg",
            )}
          >
            <h3 className={cn("font-extrabold", issue.tone === "danger" ? "text-ds-confirm-ink" : "text-ds-alert-ink")}>{issue.title}</h3>
            <div className="mt-1.5 space-y-1.5 leading-relaxed text-ds-ink-2">{issue.body}</div>
          </section>
        ))}
      </div>
    </SidePanel>
  );
}
