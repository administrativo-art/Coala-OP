import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statusPillVariants = cva(
  "inline-flex h-[21px] items-center whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-bold",
  {
    variants: {
      variant: {
        ok: "bg-ds-ok-bg text-ds-ok",
        warn: "bg-ds-warn-bg text-ds-warn",
        danger: "bg-ds-danger-bg text-ds-danger",
        neutral: "bg-ds-neutral-bg text-ds-neutral",
        info: "bg-ds-info-bg text-ds-info",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
)

export type StatusPillVariant = NonNullable<VariantProps<typeof statusPillVariants>["variant"]>

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {}

/** Status somente leitura (docs/design/status.md). */
function StatusPill({ className, variant, ...props }: StatusPillProps) {
  return <span data-ui="status-pill" className={cn(statusPillVariants({ variant }), className)} {...props} />
}

/** Validade → variante: <0 danger, 0..limite warn, acima ok, sem data neutral. */
function expiryStatusVariant(days: number | null | undefined, urgentThreshold = 7): StatusPillVariant {
  if (days == null) return "neutral"
  if (days < 0) return "danger"
  if (days <= urgentThreshold) return "warn"
  return "ok"
}

export { StatusPill, statusPillVariants, expiryStatusVariant }
