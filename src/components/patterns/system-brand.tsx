"use client"

import { cn } from "@/lib/utils"

export interface SystemBrandProps {
  /** Barra recolhida: o logotipo encolhe e o nome some. */
  collapsed: boolean
  /** Palavra em destaque do nome do sistema (ex.: "One", "Pulse"). */
  accent: string
  /** `pulse`: batimento com brilho; `shimmer`: brilho que percorre a palavra, como "tudo conectado". */
  animation?: "pulse" | "shimmer"
  className?: string
}

/**
 * Marca do sistema no topo das barras laterais (docs/design/barra-lateral.md): o logotipo anima o tamanho
 * junto com a barra e, expandida, mostra "Coala + palavra" separada por um filete rosa.
 */
export function SystemBrand({ collapsed, accent, animation = "pulse", className }: SystemBrandProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div
        className="relative h-11 shrink-0 overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none"
        style={{ width: collapsed ? 60 : 96 }}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/instagram/coala-logo.png"
          alt=""
          className="absolute h-auto max-w-none transition-[width,left,top] duration-300 ease-out motion-reduce:transition-none"
          style={collapsed ? { width: 78, left: -9, top: -17 } : { width: 129, left: -17, top: -44 }}
        />
      </div>
      {!collapsed && (
        <span
          className={cn(
            "whitespace-nowrap border-l-2 border-ds-accent py-1.5 pl-3 text-[17px] font-extrabold leading-none tracking-[-0.01em] text-ds-on-dark",
            animation === "pulse" && "coala-pulse-name"
          )}
        >
          Coala <span className={animation === "shimmer" ? "coala-shimmer-word" : "text-ds-accent-kicker"}>{accent}</span>
        </span>
      )}
    </div>
  )
}
