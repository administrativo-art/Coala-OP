
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[background-color,box-shadow,transform,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:shadow-none active:scale-[0.985] disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-md active:shadow-sm",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm hover:shadow-md",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm hover:shadow-md",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm hover:shadow-md",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Guia de design (docs/design/botoes.md). Não animam escala.
        "primary-page": "bg-ds-accent font-extrabold text-white shadow-ds-cta hover:bg-ds-accent-hover active:scale-100",
        "primary-modal": "bg-ds-dark font-extrabold text-white hover:bg-ds-dark-hover active:scale-100",
        "ds-secondary": "border border-ds-border-input bg-ds-surface font-bold text-ds-ink hover:bg-ds-muted active:scale-100",
        "ds-ghost": "font-bold text-ds-ink-muted hover:bg-ds-page hover:text-ds-ink active:scale-100",
        "ds-link": "font-bold text-ds-accent-ink hover:text-ds-accent-ink-hover hover:underline active:scale-100",
        "danger-link": "font-bold text-ds-danger hover:underline active:scale-100",
        danger: "bg-ds-danger font-extrabold text-white hover:brightness-90 active:scale-100",
        "on-dark-secondary": "border border-white/[.14] font-bold text-ds-on-dark hover:bg-white/[.06] active:scale-100",
        "on-dark-icon": "bg-white/[.08] text-ds-on-dark-2 hover:bg-white/[.14] active:scale-100",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        xl: "h-12 rounded-ds-btn-lg px-[22px] text-sm",
        md: "h-[42px] rounded-ds-btn px-4 text-[13px]",
        xs: "h-8 rounded-ds-sm px-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Troca o rótulo por `loadingLabel`, fica cinza e bloqueia clique duplo. */
  loading?: boolean
  loadingLabel?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingLabel = "Salvando…", children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          loading && "cursor-not-allowed disabled:opacity-100 bg-ds-disabled text-white shadow-none hover:bg-ds-disabled"
        )}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && !asChild ? loadingLabel : children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
