"use client"

import { BackButton } from "@/components/navigation/back-button"

/** Voltar ao nível acima, para o painel escuro do `PageHero` (substitui a trilha do `PageHeader`). */
export function HeroBackButton({ fallbackHref, parentLabel }: { fallbackHref: string; parentLabel: string }) {
  return (
    <BackButton
      fallbackHref={fallbackHref}
      label={parentLabel}
      ariaLabel={`Voltar para ${parentLabel}`}
      variant="ghost"
      className="h-9 rounded-ds-btn border border-white/[.14] px-3 text-[13px] font-bold text-ds-on-dark hover:bg-white/[.06] hover:text-ds-on-dark"
    />
  )
}
