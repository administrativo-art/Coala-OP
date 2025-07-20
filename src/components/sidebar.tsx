
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardList, ClipboardCheck, Shell, Users, ChevronsLeft, ChevronsRight, ListPlus, Settings, LifeBuoy, DollarSign, ListTodo } from 'lucide-react'
import { Button } from "./ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { UserProfile } from "./user-profile"
import { ThemeToggle } from "./theme-toggle"
import { Badge } from "./ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"

interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (isCollapsed: boolean) => void;
}

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname()
  const { permissions, loading, user } = useAuth()
  const { legacyTasks } = useAllTasks();

  const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
  const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);

  const canManageStock = !loading && (permissions.lots.add || permissions.lots.edit || permissions.lots.move || permissions.lots.delete || permissions.lots.viewMovementHistory || permissions.purchasing.suggest || permissions.purchasing.approve || permissions.stockCount.perform || permissions.stockCount.approve);
  const canManageTeam = !loading && permissions.team && (permissions.team.manage || permissions.team.view);
  const canUseHelp = !loading && permissions.help.view;
  const isMasterUser = user?.username === 'Tiago Brasil';
  const canRegister = isMasterUser || permissions.products.add || permissions.products.edit;
  const canSimulatePricing = !loading && permissions.pricing.simulate;
  const canViewTasks = !loading && permissions.tasks.view;
  const canViewReports = !loading && permissions.reports.view;

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'main' },
    { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, group: 'operacao', notificationCount: legacyTasks.length },
    { href: '/dashboard/forms', label: 'Formulários', icon: ClipboardList, group: 'operacao' },
    { href: '/dashboard/stock', label: 'Gestão de estoque', icon: ClipboardCheck, group: 'operacao' },
    { href: '/dashboard/team', label: 'Gestão de equipe', icon: Users, group: 'operacao' },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, group: 'admin' },
    { href: '/dashboard/pricing', label: 'Custo e preço', icon: DollarSign, group: 'admin' },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, group: 'admin' },
    { href: '/dashboard/help', label: 'Ajuda', icon: LifeBuoy, group: 'suporte' },
  ];
  
  const navGroups = {
    main: { items: navItems.filter(i => i.group === 'main') },
    operacao: { label: 'Operação', items: navItems.filter(i => i.group === 'operacao') },
    admin: { label: 'Administração', items: navItems.filter(i => i.group === 'admin') },
    suporte: { label: 'Suporte', items: navItems.filter(i => i.group === 'suporte') },
  };

  return (
    <div className={cn("hidden border-r bg-card text-foreground md:flex flex-col dark transition-[width] duration-300", isCollapsed ? "w-[80px]" : "w-[280px]")}>
      <div className="flex h-[60px] shrink-0 items-center justify-center border-b px-4">
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

      <nav className="flex-1 overflow-y-auto px-4 py-4">
        <ul className="space-y-1">
          {Object.entries(navGroups).map(([key, group]) => {
            const visibleItems = group.items.filter(item => {
                if (item.href === '/dashboard') return true;
                if (item.href === '/dashboard/tasks') return canViewTasks;
                if (item.href === '/dashboard/forms') return canViewForms;
                if (item.href === '/dashboard/stock') return canManageStock;
                if (item.href === '/dashboard/team') return canManageTeam;
                if (item.href === '/dashboard/registration') return canRegister;
                if (item.href === '/dashboard/pricing') return canSimulatePricing;
                if (item.href === '/dashboard/settings') return canManageUsers;
                if (item.href === '/dashboard/help') return canUseHelp;
                return false;
            });
            if(visibleItems.length === 0) return null;

            return (
              <li key={key} className="space-y-2">
                {group.label && !isCollapsed && (
                  <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
                )}
                <ul className="space-y-1">
                  {visibleItems.map(item => (
                    <li key={item.href}>
                       <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                href={item.href}
                                data-active={pathname === item.href}
                                className={cn(
                                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-9 relative",
                                  isCollapsed ? "justify-center" : "justify-start",
                                  pathname.startsWith(item.href) && item.href !== '/dashboard' && "bg-secondary text-secondary-foreground",
                                  pathname === item.href && item.href === '/dashboard' && "bg-secondary text-secondary-foreground"
                                )}
                              >
                                <div className={cn("absolute left-0 top-0 h-full w-[3px] rounded-r bg-primary opacity-0 transition-opacity", pathname === item.href && "opacity-100")} />
                                <item.icon className="h-5 w-5 shrink-0" />
                                {!isCollapsed && <span className="whitespace-nowrap flex-grow">{item.label}</span>}
                                {!isCollapsed && item.notificationCount && item.notificationCount > 0 && (
                                  <Badge variant="destructive" className="ml-auto">{item.notificationCount}</Badge>
                                )}
                                <span className="sr-only">{item.label}</span>
                              </Link>
                            </TooltipTrigger>
                            {isCollapsed && (
                              <TooltipContent side="right">
                                {item.label}
                                {item.notificationCount && item.notificationCount > 0 && ` (${item.notificationCount})`}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
      
      <div className="mt-auto p-4 border-t flex flex-col gap-3">
          <UserProfile />
          <div className="flex items-center justify-between">
            <ThemeToggle />
            {!isCollapsed && <span className="text-xs text-muted-foreground">v1.0.0</span>}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsCollapsed(!isCollapsed)}>
                {isCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
                <span className="sr-only">{isCollapsed ? "Expandir" : "Recolher"}</span>
            </Button>
          </div>
      </div>
    </div>
  )
}
