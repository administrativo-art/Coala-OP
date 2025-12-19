
"use client"

import React, { useMemo, useState } from 'react';
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { LayoutDashboard, ClipboardCheck, DollarSign, Settings, BookOpen, LogOut } from 'lucide-react'
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
    { href: '/dashboard/pricing', label: 'Custo e Preço', icon: DollarSign, show: permissions.pricing.view },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, show: permissions.settings.view },
    { href: '/dashboard/help', label: 'Ajuda', icon: BookOpen, show: permissions.help.view },
  ], [permissions]);

  const filteredNavItems = useMemo(() => {
    if (!searchTerm) return navItems.filter(item => item.show);
    const lowerCaseSearch = searchTerm.toLowerCase();
    return navItems.filter(item => item.show && item.label.toLowerCase().includes(lowerCaseSearch));
  }, [navItems, searchTerm]);

  return (
    <aside className="fixed left-4 top-4 bottom-4 w-64 z-50">
        <div className="h-full flex flex-col bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-[2.5rem] shadow-2xl p-6">
            
            <div className="px-2 mb-8">
                <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                    <div className="font-logo select-none">
                        <div className="text-left text-2xl font-bold text-primary leading-none">coala</div>
                        <div className="text-left text-xl font-bold text-accent -mt-1.5 pl-2.5 leading-none">shakes</div>
                    </div>
                </Link>
            </div>

            <nav className="flex-1 space-y-2">
                <div className="text-[10px] uppercase font-bold text-muted-foreground px-4 mb-2 tracking-widest">Principal</div>
                
                {filteredNavItems.map(item => {
                    const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm",
                                isActive 
                                    ? "bg-primary text-white shadow-lg shadow-primary/30" 
                                    : "text-slate-500 dark:text-slate-400 hover:bg-white/50 dark:hover:bg-white/5"
                            )}
                        >
                            <item.icon size={20} />
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    )
                })}
            </nav>

            <div className="mt-auto pt-6 border-t border-slate-200 dark:border-slate-700/60">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <img src={user?.avatarUrl || `https://ui-avatars.com/api/?name=${user?.username}&background=random`} className="h-10 w-10 rounded-full border-2 border-primary/20" alt="User Avatar" />
                        <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-800 dark:text-white leading-none">{user?.username}</span>
                            <span className="text-[10px] text-muted-foreground">Administrador</span>
                        </div>
                    </div>
                    <button onClick={logout} className="p-2 hover:bg-red-100 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 rounded-xl transition-colors">
                        <LogOut size={18} />
                    </button>
                </div>
            </div>
        </div>
    </aside>
  );
}
