export type WidgetDensity = "compact" | "medium" | "wide";

/** Densidade escolhida pela largura real do cartão, para valer em qualquer breakpoint. */
export function densityFromWidth(width: number): WidgetDensity {
  if (width < 400) return "compact";
  if (width < 820) return "medium";
  return "wide";
}
