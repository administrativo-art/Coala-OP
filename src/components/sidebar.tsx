
"use client"

import React, { useMemo, useState } from 'react';
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardCheck, DollarSign, Settings, BookOpen, LogOut, ListPlus, ListTodo } from 'lucide-react'
import { Badge } from "@/components/ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { Input } from '@/components/ui/input';

interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    show?: boolean;
    notificationCount?: number;
}

export function Sidebar() {
  const pathname = usePathname()
  const { user, permissions, logout } = useAuth()
  const { legacyTasks } = useAllTasks();
  const [searchTerm, setSearchTerm] = useState('');

  const navItems: NavItem[] = useMemo(() => [
    { href: '/dashboard', label: 'Painel', icon: LayoutDashboard, show: permissions.dashboard.view },
    { href: '/dashboard/stock', label: 'Gestão de Estoque', icon: ClipboardCheck, show: permissions.stock.view },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, show: permissions.registration.view },
    { href: '/dashboard/pricing', label: 'Custo e Preço', icon: DollarSign, show: permissions.pricing.view },
    { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, show: permissions.tasks.view, notificationCount: legacyTasks.length },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, show: permissions.settings.view },
    { href: '/dashboard/help', label: 'Ajuda', icon: BookOpen, show: permissions.help.view },
  ], [permissions, legacyTasks.length]);

  const filteredNavItems = useMemo(() => {
    if (!searchTerm) return navItems.filter(item => item.show);
    const lowerCaseSearch = searchTerm.toLowerCase();
    return navItems.filter(item => item.show && item.label.toLowerCase().includes(lowerCaseSearch));
  }, [navItems, searchTerm]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="px-4 mb-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
              <div className="font-logo select-none">
                  <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
                  <div className="text-left text-xl font-bold text-accent -mt-1.5 pl-2.5 leading-none">shakes</div>
              </div>
          </Link>
      </div>

      <div className="relative mb-4">
        <Input 
          placeholder="Buscar no menu..." 
          className="w-full"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <nav className="flex-1 space-y-1">
        {filteredNavItems.map(item => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
                <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                        isActive && "bg-muted text-primary"
                    )}
                >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                    {item.notificationCount && item.notificationCount > 0 && (
                      <Badge className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                          {item.notificationCount}
                      </Badge>
                    )}
                </Link>
            )
        })}
      </nav>
      <div className="mt-auto">
          <Button variant="ghost" className="w-full justify-start" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
          </Button>
      </div>
    </div>
  );
}

