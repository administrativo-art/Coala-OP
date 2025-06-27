
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { Home, Boxes, ClipboardList, ClipboardCheck, Users } from 'lucide-react'
import { Button } from "./ui/button"

export function Sidebar() {
  const pathname = usePathname()
  const { permissions } = useAuth()
  const canManageUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/dashboard/inventory', label: 'Conversão de Inventário', icon: Boxes },
    { href: '/dashboard/predefined', label: 'Conversão Predefinida', icon: ClipboardList },
    { href: '/dashboard/expiry', label: 'Controle de Validade', icon: ClipboardCheck },
    ...(canManageUsers ? [{ href: '/dashboard/users', label: 'Gerenciar Usuários', icon: Users }] : [])
  ];

  return (
    <div className="hidden border-r bg-muted md:block">
      <div className="flex h-full max-h-screen flex-col gap-2">
        <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/dashboard" className="font-semibold font-logo">
            <div className="inline-block">
                <div className="text-left text-xl text-foreground">coala</div>
                <div className="text-left text-lg text-accent -mt-2 pl-3">shakes</div>
            </div>
          </Link>
        </div>
        <div className="flex-1">
          <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
            {navItems.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                  pathname === item.href && "bg-background text-primary"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-auto p-4">
            <Button
                variant="secondary"
                className="h-8 w-8 rounded-full bg-card font-bold"
            >
                N
            </Button>
        </div>
      </div>
    </div>
  )
}
