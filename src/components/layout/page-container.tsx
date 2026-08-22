import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PageContainerVariant = "compact" | "default" | "wide" | "fluid";

export const PAGE_CONTAINER_WIDTH_CLASS: Record<PageContainerVariant, string> = {
  compact: "max-w-[1220px]",
  default: "max-w-[1440px]",
  wide: "max-w-[1600px]",
  fluid: "max-w-none",
};

type PageContainerProps<TElement extends ElementType = "div"> = {
  as?: TElement;
  children: ReactNode;
  className?: string;
  variant?: PageContainerVariant;
} & Omit<ComponentPropsWithoutRef<TElement>, "as" | "children" | "className">;

export function PageContainer<TElement extends ElementType = "div">({
  as,
  children,
  className,
  variant = "default",
  ...props
}: PageContainerProps<TElement>) {
  const Component = as ?? "div";

  return (
    <Component
      className={cn("mx-auto w-full min-w-0", PAGE_CONTAINER_WIDTH_CLASS[variant], className)}
      {...props}
    >
      {children}
    </Component>
  );
}
