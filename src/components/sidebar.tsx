
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ArrowLeftRight, Repeat, CheckSquare, UserCog, ClipboardList, BarChart3 } from 'lucide-react'
import { UserProfile } from "./user-profile"

export function Sidebar() {
  const pathname = usePathname()
  const { permissions, loading } = useAuth()

  const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
  const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);
  const canAnalyzeStock = !loading && permissions.stockAnalysis && (permissions.stockAnalysis.upload || permissions.stockAnalysis.configure);

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/dashboard/import', label: 'Análise de Estoque', icon: BarChart3, show: canAnalyzeStock },
    { href: '/dashboard/forms', label: 'Formulários', icon: ClipboardList, show: canViewForms },
    { href: '/dashboard/inventory', label: 'Conversão de inventário', icon: ArrowLeftRight, show: true },
    { href: '/dashboard/predefined', label: 'Conversão predefinida', icon: Repeat, show: true },
    { href: '/dashboard/expiry', label: 'Controle de validade', icon: CheckSquare, show: true },
    { href: '/dashboard/users', label: 'Gerenciar usuários', icon: UserCog, show: canManageUsers }
  ];

  return (
    <div className="hidden border-r bg-background text-foreground md:block dark">
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex h-14 items-center justify-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/dashboard" className="font-logo select-none">
            <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
            <div className="text-left text-xl font-bold text-accent -mt-1.5 pl-2.5 leading-none">shakes</div>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4 py-4">
            {navItems.map(item => item.show && (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary",
                  pathname === item.href && "bg-muted text-primary"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-auto border-t p-4">
            <UserProfile />
        </div>
      </div>
    </div>
  )
}
