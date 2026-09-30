import { PageHeader } from "@/components/layout/page-header";

type CashControlNavigationProps = {
  crumbs: Array<{ label: string; href?: string }>;
};

export function CashControlNavigation({ crumbs }: CashControlNavigationProps) {
  const current = crumbs.at(-1)!;
  const parent = crumbs.at(-2);

  return <PageHeader
    title={current.label}
    back={{
      fallbackHref: parent?.href ?? "/dashboard/financial/cash-closures",
      parentLabel: parent?.label ?? "Fechamento de caixa",
    }}
  />;
}
