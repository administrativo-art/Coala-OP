"use client"

import React, { useMemo, useState, useEffect, useRef } from 'react';
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import {
  LayoutDashboard,
  ClipboardCheck,
  DollarSign,
  Settings,
  BookOpen,
  LogOut,
  ListPlus,
  ListTodo,
  X
} from 'lucide-react'
import { Badge } from "@/components/ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

// Menu Item Component (Updated for new design)
function GlassNavItem({
    href,
    icon: Icon,
    label,
    active,
    notificationCount
}: {
    href: string,
    icon: any,
    label: string,
    active?: boolean,
    notificationCount?: number
}) {
  return (
    <Link href={href} className="block w-full" passHref>
        <div className={cn(
            "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-300",
            active
              ? "bg-primary text-white shadow-md shadow-primary/20"
              : "text-slate-500 hover:bg-white/80 dark:text-slate-400 dark:hover:bg-white/5"
        )}>
          <Icon className={cn("h-5 w-5 transition-transform", active ? "text-white" : "text-slate-400 group-hover:text-primary")} />
          <span className="flex-1">{label}</span>

          {notificationCount && notificationCount > 0 && (
            <Badge className={cn(
                "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] px-1.5",
                active ? "bg-white text-primary" : "bg-primary text-white"
            )}>
              {notificationCount}
            </Badge>
          )}
        </div>
    </Link>
  );
}

interface GlassSidebarProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function GlassSidebar({ open, onOpenChange }: GlassSidebarProps) {
  const pathname = usePathname();
  const { user, permissions, logout } = useAuth();
  const { legacyTasks } = useAllTasks();
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close sidebar on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
            const triggerButton = document.getElementById("sidebar-trigger");
            if (triggerButton && triggerButton.contains(event.target as Node)) return;
            onOpenChange(false);
        }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onOpenChange]);

  const navItems = useMemo(() => [
    { href: '/dashboard', label: 'Painel', icon: LayoutDashboard, show: permissions.dashboard.view },
    { href: '/dashboard/tasks', label: 'Tarefas', icon: ListTodo, show: permissions.tasks.view, notificationCount: legacyTasks.length },
    { href: '/dashboard/stock', label: 'Gestão de Estoque', icon: ClipboardCheck, show: permissions.stock.view },
    { href: '/dashboard/pricing', label: 'Custo e Preço', icon: DollarSign, show: permissions.pricing.view },
    { href: '/dashboard/registration', label: 'Cadastros', icon: ListPlus, show: permissions.registration.view },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings, show: permissions.settings.view },
    { href: '/dashboard/help', label: 'Ajuda', icon: BookOpen, show: permissions.help.view },
  ], [permissions, legacyTasks.length]);

  const visibleNavItems = useMemo(() => navItems.filter(item => item.show), [navItems]);

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 z-50 h-screen w-64 p-4 transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "-translate-x-full"
      )}
      ref={sidebarRef}
    >
      <div className="flex h-full flex-col bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden">

        {/* TOPO: Titulo & Fechar */}
        <div className="p-4 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center justify-between">
                <div className="text-center font-logo select-none">
                    <div className="text-2xl font-bold text-primary">coala</div>
                    <div className="text-xl font-bold text-accent -mt-2 pl-3">shakes</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-8 w-8 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 md:hidden">
                    <X className="h-4 w-4" />
                </Button>
            </div>
        </div>

        {/* MEIO: NAVEGAÇÃO */}
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto no-scrollbar">
            {visibleNavItems.map(item => (
                <GlassNavItem
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    notificationCount={item.notificationCount}
                    active={pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))}
                />
            ))}
        </nav>

        {/* RODAPÉ: PERFIL */}
        <div className="p-2 border-t border-black/5 dark:border-white/5">
            <div className="p-2 bg-white/60 dark:bg-slate-800/50 border border-white/60 dark:border-white/5 rounded-2xl backdrop-blur-md shadow-sm">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="relative">
                            <Avatar className="h-9 w-9 border-2 border-white dark:border-slate-700 shadow-sm">
                                <AvatarImage src={user?.avatarUrl} className="object-cover" />
                                <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                                    {user?.username?.substring(0,2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 bg-green-500 border-2 border-white dark:border-slate-800 rounded-full" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-slate-800 dark:text-white leading-tight truncate">{user?.username}</span>
                            <span className="text-[10px] font-medium text-muted-foreground leading-tight">Administrador</span>
                        </div>
                    </div>
                    <Button
                        onClick={logout}
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-slate-400 hover:bg-red-500 hover:text-white rounded-lg transition-all duration-300 active:scale-95"
                    >
                        <LogOut size={16} />
                    </Button>
                </div>
            </div>
        </div>
      </div>
    </aside>
  );
}
