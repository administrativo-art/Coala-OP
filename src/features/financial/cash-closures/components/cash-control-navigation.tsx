import { ChevronRight } from "lucide-react";

import { BackButton } from "@/components/navigation/back-button";

type CashControlNavigationProps = {
  crumbs: Array<{ label: string; href?: string }>;
};

/** Trilha de retorno do controle de caixa; o título da tela fica no `PageHero` logo abaixo. */
export function CashControlNavigation({ crumbs }: CashControlNavigationProps) {
  const parent = crumbs.at(-2);

  return <nav data-ui="page-breadcrumb" aria-label="Trilha de navegação" className="flex min-w-0 items-center gap-2 font-ds">
    <BackButton
      fallbackHref={parent?.href ?? "/dashboard/financial/cash-closures"}
      ariaLabel={`Voltar para ${parent?.label ?? "Fechamento de caixa"}`}
      iconOnly
      variant="ghost"
      className="h-8 w-8 shrink-0 rounded-ds-sm border border-ds-border bg-ds-surface p-0 text-ds-ink-muted hover:bg-ds-muted hover:text-ds-accent-ink"
      iconClassName="h-4 w-4"
    />
    {crumbs.map((crumb, index) => <span key={`${crumb.label}:${index}`} className="flex min-w-0 items-center gap-2 text-xs font-bold">
      {index > 0 ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ds-ink-faint" /> : null}
      <span className={index === crumbs.length - 1 ? "truncate text-ds-ink" : "shrink-0 text-ds-ink-faint"}>{crumb.label}</span>
    </span>)}
  </nav>;
}
