"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type CashControlNavigationProps = {
  active: "closures" | "deposits";
  crumbs?: Array<{ label: string; href?: string }>;
};

export function CashControlNavigation({ active, crumbs = [] }: CashControlNavigationProps) {
  const { permissions } = useAuth();

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href="/dashboard/financial/cash-closures"
        className={cn(
          "inline-flex h-9 items-center rounded-xl px-4 text-[13px] font-bold transition-colors",
          active === "closures"
            ? "bg-pink-600 text-white shadow-[0_6px_14px_-7px_rgba(219,39,119,.85)] hover:bg-pink-700"
            : "border border-stone-200 bg-white text-zinc-500 hover:border-pink-300 hover:text-pink-700",
        )}
      >
        Fechamento do caixa
      </Link>
      {permissions.financial?.cashDeposits?.view && <Link
        href="/dashboard/financial/cash-deposits"
        className={cn(
          "inline-flex h-9 items-center rounded-xl px-4 text-[13px] font-bold transition-colors",
          active === "deposits"
            ? "bg-pink-600 text-white shadow-[0_6px_14px_-7px_rgba(219,39,119,.85)] hover:bg-pink-700"
            : "border border-stone-200 bg-white text-zinc-500 hover:border-pink-300 hover:text-pink-700",
        )}
      >
        Depósitos
      </Link>}
    </div>

    {crumbs.length > 0 && <nav aria-label="Navegação do controle de caixa" className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
      {crumbs.map((crumb, index) => <div key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
        {crumb.href
          ? <Link href={crumb.href} className="text-zinc-400 transition-colors hover:text-pink-600">{crumb.label}</Link>
          : <span className="text-zinc-800">{crumb.label}</span>}
        {index < crumbs.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-stone-300" />}
      </div>)}
    </nav>}
  </div>;
}
