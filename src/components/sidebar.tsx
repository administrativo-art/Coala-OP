
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ArrowLeftRight, Repeat, CheckSquare, UserCog, ClipboardList } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const { permissions, loading } = useAuth()

  const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
  const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/dashboard/forms', label: 'Formulários', icon: ClipboardList, show: canViewForms },
    { href: '/dashboard/inventory', label: 'Conversão de inventário', icon: ArrowLeftRight, show: true },
    { href: '/dashboard/predefined', label: 'Conversão predefinida', icon: Repeat, show: true },
    { href: '/dashboard/expiry', label: 'Controle de validade', icon: CheckSquare, show: true },
    { href: '/dashboard/users', label: 'Gerenciar usuários', icon: UserCog, show: canManageUsers }
  ];

  return (
    <div className="hidden border-r bg-background text-foreground md:block dark">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center justify-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/dashboard" className="font-logo text-2xl font-bold">
            <span className="text-primary-foreground">coala</span>
            <span className="text-accent">shakes</span>
          </Link>
        </div>
        <div className="flex-1">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            {navItems.map(item => item.show && (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary-foreground",
                  pathname === item.href && "bg-muted text-primary-foreground border border-primary"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
