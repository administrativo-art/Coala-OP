
"use client"

import React, { useRef, useState, useMemo, useEffect } from 'react';
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardCheck, Users, ListPlus, Settings, LifeBuoy, DollarSign, ListTodo, BarChart2, BookOpen } from 'lucide-react'
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
    { href: '/dashboard/stock', label: 'Gestão de estoque', icon: ClipboardCheck, group: 'main', show: permissions.stock.view },
    { href: '/dashboard/team', label: 'Gestão de equipe', icon: Users, group: 'main', show: permissions.team.view },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, group: 'main', show: permissions.registration.view },
    { href: '/dashboard/pricing', label: 'Custo e preço', icon: DollarSign, group: 'main', show: permissions.pricing.view },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, group: 'main', show: permissions.settings.view },
    { href: '/dashboard/help', label: 'Ajuda', icon: BookOpen, group: 'main', show: permissions.help.view },
  ], [permissions, legacyTasks.length]);
  
  const filteredNavItems = useMemo(() => {
    if (!searchTerm) return navItems.filter(item => item.show);

    const lowerCaseSearch = searchTerm.toLowerCase();

    return navItems.filter(item => {
        if (!item.show) return false;
        return item.label.toLowerCase().includes(lowerCaseSearch);
    });
  }, [navItems, searchTerm]);

  useEffect(() => {
    const activeItem = navItems.find(item => pathname.startsWith(item.href) && item.href !== '/dashboard');
    if (activeItem) {
        setOpenAccordionItems(prev => [...prev, activeItem.group]);
    }
  }, [pathname, navItems]);


  const renderLink = (item: Omit<NavItem, 'group' | 'subItems'>) => (
     <SheetClose asChild>
      <Link
          href={item.href}
          className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground h-10",
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
        <ul>
            {filteredNavItems.map(item => (
                <li key={item.href}>{renderLink(item)}</li>
            ))}
        </ul>
      </nav>
    </div>
  )
}
