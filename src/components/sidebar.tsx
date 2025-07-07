
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, ClipboardCheck, Shell, Users } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export function Sidebar() {
  const pathname = usePathname()
  const { permissions, loading, user } = useAuth()

  const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
  const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);

  const canManageLots = !loading && (permissions.lots.add || permissions.lots.edit || permissions.lots.move || permissions.lots.delete || permissions.lots.viewMovementHistory);
  const canAnalyzeStock = !loading && (permissions.stockAnalysis.upload || permissions.stockAnalysis.configure || permissions.stockAnalysis.viewHistory || permissions.consumptionAnalysis.upload || permissions.consumptionAnalysis.viewHistory);
  const canManageStock = canManageLots || canAnalyzeStock;
  const canManageTeam = !loading && permissions.team && (permissions.team.manage || permissions.team.view);
  const isMasterUser = user?.username === 'Tiago Brasil';


  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { href: '/dashboard/stock', label: 'Gestão de Estoque', icon: ClipboardCheck, show: canManageStock },
    { href: '/dashboard/forms', label: 'Formulários', icon: ClipboardList, show: canViewForms },
    { href: '/dashboard/team', label: 'Gestão de Equipe', icon: Users, show: canManageTeam },
    { href: '/dashboard/conversions', label: 'Conversão de Medidas', icon: Repeat, show: true },
    { href: '/dashboard/users', label: 'Gerenciar usuários', icon: UserCog, show: canManageUsers },
  ];

  return (
    <div className="group hidden border-r bg-background text-foreground md:block dark transition-all duration-300 ease-in-out w-[72px] hover:w-[280px]">
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex h-14 shrink-0 items-center justify-center border-b px-4 lg:h-[60px]">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            <Shell className="h-6 w-6 group-hover:hidden" />
            <div className="font-logo select-none hidden group-hover:block">
              <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
              <div className="text-left text-xl font-bold text-accent -mt-1.5 pl-2.5 leading-none">shakes</div>
            </div>
             <span className="sr-only">Coala Shakes</span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TooltipProvider delayDuration={0}>
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4 py-4">
              {navItems.map(item => item.show && (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary-foreground h-9 justify-center group-hover:justify-start",
                        pathname === item.href && "bg-secondary text-secondary-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="hidden group-hover:inline whitespace-nowrap">{item.label}</span>
                    </Link>
                  </TooltipTrigger>
                  <div className="group-hover:hidden">
                    <TooltipContent side="right" sideOffset={5}>{item.label}</TooltipContent>
                  </div>
                </Tooltip>
              ))}
            </nav>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
