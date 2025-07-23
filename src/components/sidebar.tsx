

"use client"

import React, { useRef, useState, useMemo, useEffect } from 'react';
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardList, ClipboardCheck, Shell, Users, ChevronsLeft, ChevronsRight, ListPlus, Settings, LifeBuoy, DollarSign, ListTodo, AreaChart, Search, Truck, BarChart2, ShieldAlert, ListOrdered, Repeat, UserCog, Briefcase, ShieldCheck as AuditIcon } from 'lucide-react'
import { Button } from "./ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "./ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion"
import { useSidebar } from '@/hooks/use-sidebar-state';
import { Input } from './ui/input';
import { ThemeToggle } from './theme-toggle';


interface SidebarProps {
    isCollapsed: boolean;
    setIsCollapsed: (isCollapsed: boolean) => void;
}

interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    group: string;
    show?: boolean;
    notificationCount?: number;
    subItems?: Omit<NavItem, 'group' | 'subItems' | 'notificationCount'>[];
}

export function Sidebar({ isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter();
  const { permissions, loading, user } = useAuth()
  const { legacyTasks } = useAllTasks();
  const { lastVisited, setLastVisited, prefetch, clearPrefetch } = useSidebar();
  const navRef = useRef<HTMLElement>(null);
  const [isScrolling, setIsScrolling] = React.useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);
  const [openSubAccordionItems, setOpenSubAccordionItems] = useState<string[]>([]);

  React.useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const handleScroll = () => {
        setIsScrolling(nav.scrollTop > 0);
    };

    nav.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
        nav.removeEventListener('scroll', handleScroll);
    };
}, []);

  const canManageUsers = !loading && permissions.users && (permissions.users.add || permissions.users.edit || permissions.users.delete);
  const canViewForms = !loading && permissions.forms && (permissions.forms.fill || permissions.forms.manage || permissions.forms.viewHistory);
  const canManageStock = !loading && (permissions.lots.add || permissions.lots.edit || permissions.lots.move || permissions.lots.delete || permissions.lots.viewMovementHistory || permissions.purchasing.suggest || permissions.purchasing.approve || permissions.stockCount.perform || permissions.audit.start);
  const canManageTeam = !loading && permissions.team && (permissions.team.manage || permissions.team.view);
  const canUseHelp = !loading && permissions.help.view;
  const isMasterUser = user?.username === 'Tiago Brasil';
  const canRegister = isMasterUser || permissions.products.add || permissions.products.edit;
  const canSimulatePricing = !loading && permissions.pricing.simulate;
  const canViewTasks = !loading && permissions.tasks.view;
  const canAudit = !loading && permissions.audit.start;

  const navItems: NavItem[] = useMemo(() => [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'main', show: true },
    { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, group: 'operacao', notificationCount: legacyTasks.length, show: canViewTasks },
    { href: '/dashboard/forms', label: 'Formulários e Processos', icon: ClipboardList, group: 'operacao', show: canViewForms },
    { 
        href: '/dashboard/stock', 
        label: 'Gestão de estoque', 
        icon: ClipboardCheck, 
        group: 'operacao', 
        show: canManageStock,
        subItems: [
            { href: '/dashboard/stock/inventory-control', label: 'Controle de estoque', icon: ClipboardCheck, show: true },
            { href: '/dashboard/stock/count', label: 'Contagem de estoque', icon: ListOrdered, show: true },
            { href: '/dashboard/stock/audit', label: 'Auditoria', icon: AuditIcon, show: permissions.audit.start },
            { href: '/dashboard/stock/analysis', label: 'Análise de estoque', icon: BarChart2, show: true },
            { href: '/dashboard/stock/purchasing', label: 'Compras', icon: DollarSign, show: true },
            { href: '/dashboard/stock/returns', label: 'Avarias', icon: ShieldAlert, show: true },
            { href: '/dashboard/conversions', label: 'Conversão de medidas', icon: Repeat, show: true },
        ]
    },
    { href: '/dashboard/team', label: 'Gestão de equipe', icon: Users, group: 'operacao', show: canManageTeam },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, group: 'admin', show: canRegister },
    { href: '/dashboard/pricing', label: 'Custo e preço', icon: DollarSign, group: 'admin', show: canSimulatePricing },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, group: 'admin', show: canManageUsers },
    { href: '/dashboard/help', label: 'Ajuda', icon: LifeBuoy, group: 'suporte', show: canUseHelp },
  ], [legacyTasks.length, canViewTasks, canViewForms, canManageStock, canManageTeam, canRegister, canSimulatePricing, canManageUsers, canUseHelp, permissions.audit.start, canAudit]);
  
  const filteredNavItems = useMemo(() => {
    if (!searchTerm) return navItems.filter(item => item.show !== false);

    const lowerCaseSearch = searchTerm.toLowerCase();

    return navItems.map(item => {
        if (item.show === false) return null;

        const mainLabelMatch = item.label.toLowerCase().includes(lowerCaseSearch);
        
        const filteredSubItems = item.subItems?.filter(sub => sub.show !== false);
        const matchingSubItems = filteredSubItems?.filter(sub => sub.label.toLowerCase().includes(lowerCaseSearch));

        if (mainLabelMatch || (matchingSubItems && matchingSubItems.length > 0)) {
            return {
                ...item,
                subItems: mainLabelMatch ? filteredSubItems : matchingSubItems
            };
        }
        return null;
    }).filter((item): item is NavItem => item !== null);

  }, [navItems, searchTerm]);

  const navGroups = useMemo(() => ({
    main: { items: filteredNavItems.filter(i => i.group === 'main') },
    operacao: { label: 'Operação', icon: Briefcase, items: filteredNavItems.filter(i => i.group === 'operacao') },
    admin: { label: 'Administração', icon: UserCog, items: filteredNavItems.filter(i => i.group === 'admin') },
    suporte: { label: 'Ajuda', icon: LifeBuoy, items: filteredNavItems.filter(i => i.group === 'suporte') },
  }), [filteredNavItems]);
  
  const activeGroup = useMemo(() => {
    const activeItem = navItems.find(item => pathname.startsWith(item.href) && item.href !== '/dashboard');
    return activeItem ? activeItem.group : null;
  }, [pathname, navItems]);

  const activeSubAccordion = useMemo(() => {
    const activeItem = navItems.find(item => item.subItems?.some(sub => pathname.startsWith(sub.href)));
    return activeItem ? activeItem.href : null;
  }, [pathname, navItems]);

  useEffect(() => {
    if (searchTerm) {
        const groupsWithResults = Object.keys(navGroups).filter(key => navGroups[key as keyof typeof navGroups].items.length > 0);
        setOpenAccordionItems(groupsWithResults);

        const subAccordionsWithResults = filteredNavItems
            .filter(item => item.subItems && item.subItems.length < (navItems.find(i => i.href === item.href)?.subItems?.length || 0))
            .map(item => item.href);
        setOpenSubAccordionItems(prev => [...new Set([...prev, ...subAccordionsWithResults])]);

    } else {
        setOpenAccordionItems(activeGroup ? [activeGroup] : []);
        setOpenSubAccordionItems(activeSubAccordion ? [activeSubAccordion] : []);
    }
  }, [searchTerm, navGroups, activeGroup, activeSubAccordion, filteredNavItems, navItems]);


  const renderLink = (item: Pick<NavItem, 'href'|'label'|'icon'>, isSubItem = false) => (
     <Link
        href={item.href}
        onClick={() => setLastVisited(item.href)}
        onMouseEnter={() => prefetch(item.href)}
        onMouseLeave={clearPrefetch}
        data-active={pathname.startsWith(item.href)}
        data-last-visited={lastVisited === item.href}
        className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-9 relative",
            isCollapsed ? "justify-center" : "justify-start",
            pathname.startsWith(item.href) && !isSubItem && "bg-secondary text-secondary-foreground",
            pathname === item.href && isSubItem && "bg-muted text-foreground",
            isSubItem && "pl-8 text-sm h-8"
        )}
    >
        {isSubItem && <div className={cn("absolute left-4 top-0 h-full w-[2px] rounded-r transition-colors", pathname.startsWith(item.href) ? "bg-primary" : "bg-border/70 group-hover:bg-border")} />}
        <item.icon className={cn("shrink-0", isSubItem ? "h-4 w-4" : "h-5 w-5")} />
        {!isCollapsed && <span className={cn("whitespace-nowrap flex-grow transition-opacity duration-150", isCollapsed && "opacity-0")}>{item.label}</span>}
        <span className="sr-only">{item.label}</span>
    </Link>
  )
  
  const renderNavItem = (item: NavItem) => {
    const hasSubItems = !isCollapsed && item.subItems && item.subItems.length > 0;
    
    if (hasSubItems) {
        return (
            <Accordion type="single" collapsible value={openSubAccordionItems.includes(item.href) ? item.href : undefined} onValueChange={(value) => setOpenSubAccordionItems(value ? [value] : [])}>
                <AccordionItem value={item.href} className="border-none">
                     <AccordionTrigger className="p-0 hover:no-underline rounded-lg [&>svg]:ml-2 [&>svg]:mr-2 group flex items-center gap-3 px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-9 relative data-[state=open]:bg-secondary/50">
                        <div className="flex items-center gap-3 flex-grow">
                            <item.icon className="h-5 w-5 shrink-0" />
                            <span className="whitespace-nowrap flex-grow text-left">{item.label}</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-1 pl-4">
                        <ul className="space-y-1">
                            {item.subItems!.filter(sub => sub.show !== false).map(subItem => (
                                <li key={subItem.href}>{renderLink(subItem, true)}</li>
                            ))}
                        </ul>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        )
    }
    
    return (
        <TooltipProvider delayDuration={0}>
        <Tooltip>
            <TooltipTrigger asChild>
                {renderLink(item)}
            </TooltipTrigger>
            {isCollapsed && (
            <TooltipContent side="right">
                {item.label}
                {item.notificationCount && item.notificationCount > 0 && ` (${item.notificationCount})`}
            </TooltipContent>
            )}
        </Tooltip>
        </TooltipProvider>
    );
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

       {!isCollapsed && (
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Buscar no menu..."
                className="w-full rounded-lg bg-muted pl-8 h-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        )}

       <nav ref={navRef} className={cn("flex-1 overflow-y-auto px-2 py-4 relative", isScrolling && 'shadow-[inset_0_5px_5px_-5px_rgba(0,0,0,0.1)] dark:shadow-[inset_0_5px_5px_-5px_rgba(0,0,0,0.3)]')}>
        <ul>
            {navGroups.main.items.map(item => (
                <li key={item.href}>{renderNavItem(item)}</li>
            ))}
        </ul>

        {isCollapsed ? (
            <ul className="space-y-1 mt-2 border-t pt-2">
                {filteredNavItems.filter(i => i.group !== 'main').map(item => (
                    <li key={item.href}>{renderNavItem(item)}</li>
                ))}
            </ul>
        ) : (
            <Accordion type="multiple" value={openAccordionItems} onValueChange={setOpenAccordionItems} className="w-full">
                {Object.entries(navGroups).map(([key, group]) => {
                    if (key === 'main' || group.items.length === 0) return null;
                    const GroupIcon = group.icon;

                    return (
                        <AccordionItem value={key} key={key} className="border-none">
                            <AccordionTrigger className="p-3 text-base text-muted-foreground hover:no-underline hover:text-foreground data-[state=open]:bg-secondary/20">
                                <div className="flex items-center gap-3">
                                  <GroupIcon className="h-5 w-5" />
                                  <span>{group.label}</span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pb-1">
                                <ul className="space-y-1">
                                    {group.items.map(item => (
                                        <li key={item.href}>{renderNavItem(item)}</li>
                                    ))}
                                </ul>
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>
        )}
      </nav>
      
      <div className="mt-auto p-4 border-t flex flex-col gap-3">
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
