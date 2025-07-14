
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, ClipboardCheck, Shell, Users, ChevronsLeft, ChevronsRight, ListPlus } from 'lucide-react'
import { Button } from "./ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (isCollapsed: boolean) => void;
}

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname()
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
    { href: '/dashboard/stock', label: 'Gestão de estoque', icon: ClipboardCheck, show: canManageStock },
    { href: '/dashboard/team', label: 'Gestão de equipe', icon: Users, show: canManageTeam },
    { href: '/dashboard/conversions', label: 'Conversão de medidas', icon: Repeat, show: true },
    { href: '/dashboard/users', label: 'Gerenciar usuários', icon: UserCog, show: canManageUsers },
  ];

  return (
    <div className={cn("hidden border-r bg-background text-foreground md:block dark transition-[width] duration-300", isCollapsed ? "w-[80px]" : "w-[280px]")}>
      <div className="flex h-full max-h-screen flex-col">
        <div className={cn(
            "flex h-14 shrink-0 items-center justify-center border-b px-4 lg:h-[60px]",
        )}>
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            {isCollapsed ? (
                <Shell className="h-8 w-8 text-primary" />
            ) : (
                <div className="font-logo select-none">
                  <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
                  <div className="text-left text-xl font-bold text-accent -mt-1.5 pl-2.5 leading-none">shakes</div>
                </div>
            )}
             <span className="sr-only">Coala Shakes</span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TooltipProvider>
            <nav className={cn("grid items-start py-4", isCollapsed ? "px-2" : "px-4")}>
                {navItems.map(item => item.show && (
                  <Tooltip key={item.href} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary-foreground h-9",
                          isCollapsed ? "justify-center" : "justify-start",
                          pathname.startsWith(item.href) && item.href !== '/dashboard' && "bg-secondary text-secondary-foreground",
                          pathname === item.href && item.href === '/dashboard' && "bg-secondary text-secondary-foreground"
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                        <span className="sr-only">{item.label}</span>
                      </Link>
                    </TooltipTrigger>
                    {isCollapsed && (
                      <TooltipContent side="right">
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
            </nav>
          </TooltipProvider>
        </div>
        
        <div className="mt-auto p-4 border-t">
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button variant="ghost" className="w-full" onClick={() => setIsCollapsed(!isCollapsed)}>
                    {isCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
                    <span className="sr-only">{isCollapsed ? "Expandir" : "Recolher"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {isCollapsed ? "Expandir" : "Recolher"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
