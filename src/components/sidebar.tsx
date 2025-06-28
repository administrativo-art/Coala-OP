"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, BarChart3, Shell, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface SidebarProps {
  isCollapsed: boolean
  setIsCollapsed: (isCollapsed: boolean) => void
}

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname()
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
  ];

  return (
    <div className="hidden border-r bg-background text-foreground md:block dark transition-all duration-300">
      <div className="flex h-full max-h-screen flex-col">
        <div className="flex h-14 items-center justify-center border-b px-4 lg:h-[60px] lg:px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
            {isCollapsed ? (
                <Shell className="h-6 w-6" />
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
          <TooltipProvider delayDuration={0}>
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4 py-4">
              {navItems.map(item => item.show && (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary",
                        pathname === item.href && "bg-muted text-primary",
                        isCollapsed && "h-9 w-9 justify-center"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className={cn(isCollapsed && "sr-only")}>{item.label}</span>
                    </Link>
                  </TooltipTrigger>
                  {isCollapsed && (
                    <TooltipContent side="right" sideOffset={5}>{item.label}</TooltipContent>
                  )}
                </Tooltip>
              ))}
            </nav>
          </TooltipProvider>
        </div>
        
        <div className="mt-auto border-t p-4 flex justify-center">
          <Button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            size="icon"
            variant="outline"
          >
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            <span className="sr-only">Toggle sidebar</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
