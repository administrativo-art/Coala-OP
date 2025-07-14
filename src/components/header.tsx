"use client"

import Link from "next/link"
import { Menu, LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, ClipboardCheck, Users, ListPlus } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { UserProfile } from "./user-profile"


export function Header() {
    const { permissions, loading, user } = useAuth()

    const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
    const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);
    
    const canManageLots = !loading && (permissions.lots.add || permissions.lots.edit || permissions.lots.move || permissions.lots.delete || permissions.lots.viewMovementHistory);
    const canAnalyzeStock = !loading && (permissions.stockAnalysis.upload || permissions.stockAnalysis.configure || permissions.stockAnalysis.viewHistory || permissions.consumptionAnalysis.upload || permissions.consumptionAnalysis.viewHistory);
    const canManageStock = canManageLots || canAnalyzeStock;
    const canManageTeam = !loading && permissions.team && (permissions.team.manage || permissions.team.view);
    const isMasterUser = user?.username === 'Tiago Brasil';
    const canRegister = isMasterUser || permissions.products.add || permissions.products.edit;

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
        { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, show: canRegister },
        { href: '/dashboard/forms', label: 'Formulários', icon: ClipboardList, show: canViewForms },
        { href: '/dashboard/stock', label: 'Gestão de Estoque', icon: ClipboardCheck, show: canManageStock },
        { href: '/dashboard/team', label: 'Gestão de Equipe', icon: Users, show: canManageTeam },
        { href: '/dashboard/conversions', label: 'Conversão de Medidas', icon: Repeat, show: true },
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
                <SheetHeader>
                    <SheetTitle className="sr-only">Menu de Navegação</SheetTitle>
                </SheetHeader>
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
        <UserProfile />
    </header>
  )
}
