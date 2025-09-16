
"use client"

import React, { useRef, useState, useMemo, useEffect } from 'react';
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardCheck, Shell, Users, ChevronsLeft, ChevronsRight, ListPlus, Settings, LifeBuoy, DollarSign, ListTodo, AreaChart, Search, Truck, BarChart2, ShieldAlert, ListOrdered, Repeat, UserCog, Briefcase, ShieldCheck as AuditIcon, BookOpen, FileText, MinusCircle } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion"
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';

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

  const canManageUsers = !loading && permissions.settings.view;
  const canManageTeam = !loading && permissions.team.view;
  const canUseHelp = !loading && permissions.help.view;
  const isMasterUser = user?.username === 'Tiago Brasil';
  const canRegister = !loading && permissions.registration.view;
  const canSimulatePricing = !loading && permissions.pricing.view;
  const canViewTasks = !loading && permissions.tasks.view;
  const canAudit = !loading && permissions.stock.audit.start;
  const canManageStock = !loading && (
    permissions.stock.inventoryControl.view ||
    permissions.stock.stockCount.view ||
    permissions.stock.audit.view ||
    permissions.stock.analysis.view ||
    permissions.stock.purchasing.view ||
    permissions.stock.returns.view ||
    permissions.stock.conversions.view
  );

  const navItems: NavItem[] = useMemo(() => [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'main', show: true },
    { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, group: 'operacao', notificationCount: legacyTasks.length, show: canViewTasks },
    { 
        href: '/dashboard/stock', 
        label: 'Gestão de estoque', 
        icon: ClipboardCheck, 
        group: 'operacao', 
        show: canManageStock,
        subItems: [
            { href: '/dashboard/stock/inventory-control', label: 'Controle de estoque', icon: ClipboardCheck, show: permissions.stock.inventoryControl.view },
            { href: '/dashboard/stock/count', label: 'Contagem de estoque', icon: ListOrdered, show: permissions.stock.stockCount.view },
            { href: '/dashboard/stock/audit', label: 'Auditoria', icon: AuditIcon, show: permissions.stock.audit.view },
            { href: '/dashboard/stock/analysis', label: 'Análise de estoque', icon: BarChart2, show: permissions.stock.analysis.view },
            { href: '/dashboard/stock/purchasing', label: 'Compras', icon: DollarSign, show: permissions.stock.purchasing.view },
            { href: '/dashboard/stock/returns', label: 'Avarias', icon: ShieldAlert, show: permissions.stock.returns.view },
            { href: '/dashboard/conversions', label: 'Conversão de medidas', icon: Repeat, show: permissions.stock.conversions.view },
        ]
    },
    { href: '/dashboard/team', label: 'Gestão de equipe', icon: Users, group: 'operacao', show: canManageTeam },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, group: 'admin', show: canRegister },
    { href: '/dashboard/pricing', label: 'Custo e preço', icon: DollarSign, group: 'admin', show: canSimulatePricing },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, group: 'admin', show: canManageUsers },
    { href: '/dashboard/help', label: 'Ajuda', icon: BookOpen, group: 'suporte', show: canUseHelp },
  ], [legacyTasks.length, canViewTasks, canManageStock, canManageTeam, canRegister, canSimulatePricing, canManageUsers, canUseHelp, permissions]);
  
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
    suporte: { label: 'Suporte', icon: LifeBuoy, items: filteredNavItems.filter(i => i.group === 'suporte') },
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
      
      <div className="p-2 border-t">
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "justify-between")}>
          <div className={cn("flex items-center gap-2", isCollapsed && "hidden")}>
             <ThemeToggle />
             <span className="text-xs text-muted-foreground">v1.0.0</span>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setIsCollapsed(!isCollapsed)}>
            {isCollapsed ? <ChevronsRight /> : <ChevronsLeft />}
            <span className="sr-only">{isCollapsed ? "Expandir" : "Recolher"}</span>
          </Button>
        </div>
        {isCollapsed && <ThemeToggle />}
      </div>
    </div>
  )
}
