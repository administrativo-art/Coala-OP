

"use client"

import Link from "next/link"
import { Menu, LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, ClipboardCheck, Users, ListPlus, Settings, ShoppingCart, LifeBuoy, DollarSign, ListTodo, AreaChart, Camera } from "lucide-react"
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
import { ThemeToggle } from "./theme-toggle"
import { type LegacyTask, NotificationCenter } from "./notification-center"
import { GlobalBarcodeScanner } from "./global-barcode-scanner"


export function Header({ tasks }: { tasks: LegacyTask[] }) {
    const { permissions, loading, user } = useAuth()

    const canManageUsers = !loading && permissions.settings.view;
    const canManageStock = !loading && permissions.stock.view;
    const canManageTeam = !loading && permissions.team.view;
    const canUseHelp = !loading && permissions.help.view;
    const isMasterUser = user?.username === 'Tiago Brasil';
    const canRegister = !loading && permissions.registration.view;
    const canSimulatePricing = !loading && permissions.pricing.view;
    const canViewTasks = !loading && permissions.tasks.view;


    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
        { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, show: canViewTasks },
        { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, show: canRegister },
        { href: '/dashboard/stock', label: 'Gestão de estoque', icon: ClipboardCheck, show: canManageStock },
        { href: '/dashboard/team', label: 'Gestão de equipe', icon: Users, show: canManageTeam },
        { href: '/dashboard/settings', label: 'Configurações', icon: Settings, show: canManageUsers },
        { href: '/dashboard/help', label: 'Ajuda', icon: LifeBuoy, show: canUseHelp },
        { href: '/dashboard/pricing', label: 'Custo e preço', icon: DollarSign, show: canSimulatePricing },
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
                <span className="sr-only">Menu de navegação</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col dark bg-background text-foreground">
                <SheetHeader>
                    <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
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
        </div>
        <div className="flex items-center gap-2">
          <GlobalBarcodeScanner />
          <NotificationCenter tasks={tasks} />
          <ThemeToggle />
          <UserProfile />
        </div>
    </header>
  )
}
