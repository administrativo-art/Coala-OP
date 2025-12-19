
"use client"

import React, { useRef, useState, useMemo, useEffect } from 'react';
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardCheck, Users, ListPlus, Settings, LifeBuoy, DollarSign, ListTodo, BarChart2, BookOpen, Repeat, BarChart3, ShoppingCart, ShieldAlert, ListOrdered, ShieldCheck as AuditIcon, } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion"
import { Input } from '@/components/ui/input';
import { SheetClose } from './ui/sheet';

interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    group: string;
    show?: boolean;
    notificationCount?: number;
    subItems?: Omit<NavItem, 'group' | 'subItems' | 'notificationCount'>[];
}

export function Sidebar() {
  const pathname = usePathname()
  const { permissions, loading } = useAuth()
  const { legacyTasks } = useAllTasks();
  const [searchTerm, setSearchTerm] = useState('');
  
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);

  const navItems: NavItem[] = useMemo(() => [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'main', show: permissions.dashboard.view },
    { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, group: 'main', notificationCount: legacyTasks.length, show: permissions.tasks.view },
    { 
      href: '/dashboard/stock', 
      label: 'Gestão de estoque', 
      icon: ClipboardCheck, 
      group: 'stock', 
      show: permissions.stock.view,
      subItems: [
        { href: '/dashboard/stock/inventory-control', label: 'Controle de estoque', icon: ClipboardCheck, show: permissions.stock.inventoryControl.view },
        { href: '/dashboard/stock/count', label: 'Contagem de estoque', icon: ListOrdered, show: permissions.stock.stockCount.view },
        { href: '/dashboard/stock/analysis', label: 'Análise de estoque', icon: BarChart3, show: permissions.stock.analysis.view },
        { href: '/dashboard/stock/purchasing', label: 'Gestão de compras', icon: ShoppingCart, show: permissions.stock.purchasing.view },
        { href: '/dashboard/stock/returns', label: 'Gestão de avarias', icon: ShieldAlert, show: permissions.stock.returns.view },
        { href: '/dashboard/conversions', label: 'Conversão de medidas', icon: Repeat, show: permissions.stock.conversions.view },
      ]
    },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, group: 'main', show: permissions.registration.view },
    { href: '/dashboard/pricing', label: 'Custo e preço', icon: DollarSign, group: 'main', show: permissions.pricing.view },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, group: 'main', show: permissions.settings.view },
    { href: '/dashboard/help', label: 'Ajuda', icon: BookOpen, group: 'main', show: permissions.help.view },
  ], [permissions, legacyTasks.length]);
  
  const filteredNavItems = useMemo(() => {
    if (!searchTerm) return navItems.filter(item => item.show);

    const lowerCaseSearch = searchTerm.toLowerCase();

    return navItems.reduce((acc, item) => {
      if (!item.show) return acc;

      const selfMatch = item.label.toLowerCase().includes(lowerCaseSearch);
      const subItemsMatch = item.subItems?.filter(sub => sub.show && sub.label.toLowerCase().includes(lowerCaseSearch));

      if (selfMatch || (subItemsMatch && subItemsMatch.length > 0)) {
        acc.push({
          ...item,
          subItems: subItemsMatch && subItemsMatch.length > 0 ? subItemsMatch : (selfMatch ? item.subItems : [])
        });
      }
      
      return acc;
    }, [] as NavItem[]);
  }, [navItems, searchTerm]);

  useEffect(() => {
    const activeItem = navItems.find(item => item.subItems && item.subItems.some(sub => pathname.startsWith(sub.href)));
    if (activeItem) {
        setOpenAccordionItems(prev => [...new Set([...prev, activeItem.href])]);
    }
  }, [pathname, navItems]);


  const renderLink = (item: Omit<NavItem, 'group' | 'subItems'>, isSubItem = false) => (
     <SheetClose asChild>
      <Link
          href={item.href}
          className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-10",
              isSubItem && "pl-11",
              pathname === item.href && "bg-secondary text-secondary-foreground",
          )}
      >
          <item.icon className="h-5 w-5" />
          <span className="whitespace-nowrap flex-grow transition-opacity duration-150">{item.label}</span>
          {item.notificationCount !== undefined && item.notificationCount > 0 && (
            <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                {item.notificationCount}
            </Badge>
          )}
      </Link>
     </SheetClose>
  )

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
           <div className="font-logo select-none">
              <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
              <div className="text-left text-xl font-bold text-accent -mt-1.5 pl-2.5 leading-none">shakes</div>
            </div>
           <span className="sr-only">Coala Shakes</span>
        </Link>
      </div>

       <div className="p-2">
        <div className="relative">
          <Input
            type="search"
            placeholder="Buscar no menu..."
            className="w-full rounded-lg bg-background pl-8 h-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>
        
       <nav className="flex-1 overflow-y-auto px-2 py-4 grid items-start text-sm font-medium">
        <Accordion type="multiple" value={openAccordionItems} onValueChange={setOpenAccordionItems}>
            {filteredNavItems.map(item => (
                item.subItems && item.subItems.length > 0 ? (
                    <AccordionItem value={item.href} key={item.href} className="border-b-0">
                        <AccordionTrigger className="group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-10 hover:no-underline [&>svg]:h-5 [&>svg]:w-5">
                             <item.icon className="h-5 w-5" />
                              <span className="whitespace-nowrap flex-grow transition-opacity duration-150 text-left">{item.label}</span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-1">
                            <ul className="space-y-1">
                                {item.subItems.filter(sub => sub.show).map(subItem => (
                                    <li key={subItem.href}>{renderLink(subItem, true)}</li>
                                ))}
                            </ul>
                        </AccordionContent>
                    </AccordionItem>
                ) : (
                    <div key={item.href}>{renderLink(item)}</div>
                )
            ))}
        </Accordion>
      </nav>
    </div>
  )
}
