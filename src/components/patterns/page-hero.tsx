import * as React from "react"

import { ControlPanel } from "@/components/patterns/control-panel"
import { cn } from "@/lib/utils"

export interface PageHeroProps {
  /** Seção ou área da tela, em maiúsculas pequenas acima do título. */
  kicker: string
  title: string
  subtitle?: React.ReactNode
  /** Ações à direita do título (a principal usa `primary-page`). */
  actions?: React.ReactNode
  /** Indicadores e filtros em chips, numa linha abaixo do título. */
  chips?: React.ReactNode
  /** Busca e demais controles do painel. */
  children?: React.ReactNode
  className?: string
}

/**
 * Cabeçalho das telas de lista: o título mora dentro do painel escuro, junto da ação principal e dos filtros
 * (docs/design/cabecalho-e-etapas.md). Telas da Programação do Instagram usam `PulseHero`, que acrescenta a faixa fina.
 */
export function PageHero({ kicker, title, subtitle, actions, chips, children, className }: PageHeroProps) {
  return (
    <ControlPanel className={cn("flex flex-col gap-4 px-[26px] pb-5 pt-5", className)}>
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{kicker}</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-ds-on-dark">{title}</h1>
        {subtitle ? <span className="text-[13px] text-ds-on-dark-sub">{subtitle}</span> : null}
        {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {chips ? <div className="flex flex-wrap items-center gap-2">{chips}</div> : null}
      {children}
    </ControlPanel>
  )
}
