
"use client"

import Link from "next/link"
import { Menu, LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, BarChart3, CreditCard } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"


export function Header() {
    const { permissions, loading, user } = useAuth()

    const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
    const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);
    const canAnalyzeStock = !loading && permissions.stockAnalysis && (permissions.stockAnalysis.upload || permissions.stockAnalysis.configure);
    const isMasterUser = user?.username === 'master';

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
        { href: '/dashboard/import', label: 'Análise de Estoque', icon: BarChart3, show: canAnalyzeStock },
        { href: '/dashboard/forms', label: 'Formulários', icon: ClipboardList, show: canViewForms },
        { href: '/dashboard/conversions', label: 'Conversão de Medidas', icon: Repeat, show: true },
        { href: '/dashboard/expiry', label: 'Controle de validade', icon: CheckSquare, show: true },
        { href: '/dashboard/users', label: 'Gerenciar usuários', icon: UserCog, show: canManageUsers },
    ]

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
        <Sheet>
            <SheetTrigger asChild>
                <Button
                variant="outline"
                size="icon"
                className="shrink-0 md:hidden"
                >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col dark bg-background text-foreground">
                <nav className="grid gap-2 text-lg font-medium">
                    <Link href="/dashboard" className="font-logo select-none mb-4">
                        <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
                        <div className="text-left text-xl font-bold text-accent -mt-[0.4em] pl-[0.5em]">shakes</div>
                    </Link>
                    {navItems.map(item => item.show && (
                    <SheetTrigger asChild key={item.href}>
                        <Link
                            href={item.href}
                            className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"
                        >
                            <item.icon className="h-5 w-5" />
                            {item.label}
                        </Link>
                    </SheetTrigger>
                    ))}
                </nav>
            </SheetContent>
        </Sheet>
        <div className="w-full flex-1">
            <p className="hidden md:block font-logo text-2xl font-bold text-primary">
              Oi, humano. Acredite em você!
            </p>
        </div>
    </header>
  )
}
