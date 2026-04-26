"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ClipboardList } from "lucide-react";

const navItems = [
  {
    label: "Templates de checklist",
    href: "/dashboard/operations/settings/checklist-templates",
    icon: ClipboardList,
  },
];

export default function OperationsSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações — Operacional</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerencie os dados base do módulo operacional.
        </p>
      </div>
      <nav className="flex gap-1 border-b pb-0">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
