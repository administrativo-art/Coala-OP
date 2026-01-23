
"use client"

import React, { useMemo, useState, useEffect, useRef } from 'react';
import Link from "next/link"
import Image from "next/image";
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
  Search,
  X
} from 'lucide-react'
import { Badge } from "@/components/ui/badge"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

// Componente do Item de Menu (Estilo Glass com suporte a Badge e Next.js Link)
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
    <Link href={href} className="block w-full">
        <div className={cn(
            "group flex w-full items-center gap-3 rounded-[1.25rem] px-4 py-3.5 text-sm font-semibold transition-all duration-300",
            active
              ? "bg-primary text-white shadow-lg shadow-primary/25 translate-x-1" 
              : "text-slate-500 hover:bg-white/80 dark:text-slate-400 dark:hover:bg-white/5 hover:translate-x-1"
        )}>
          <Icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", active ? "text-white" : "text-slate-400 group-hover:text-primary")} />
          <span className="flex-1">{label}</span>
          
          {notificationCount && notificationCount > 0 && (
            <Badge className={cn(
                "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] px-1",
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
  const [searchTerm, setSearchTerm] = useState('');
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Fecha a sidebar ao clicar fora (Lógica da versão nova)
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

  const filteredNavItems = useMemo(() => {
    const lowerCaseSearch = searchTerm.toLowerCase();
    return navItems.filter(item => item.show && item.label.toLowerCase().includes(lowerCaseSearch));
  }, [navItems, searchTerm]);

  return (
    <aside 
      className={cn(
        "fixed top-0 left-0 z-50 h-screen w-80 p-4 transition-transform duration-500 ease-in-out",
        open ? "translate-x-0" : "-translate-x-full"
      )}
      ref={sidebarRef}
    >
      <div className="flex h-full flex-col bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl border border-white/40 dark:border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden">
        
        {/* TOPO: LOGO E BUSCA */}
        <div className="px-8 pt-10 pb-6 border-b border-black/5 dark:border-white/5">
            <div className="flex items-center justify-end mb-8">
                <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="h-8 w-8 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                    placeholder="Buscar no menu..." 
                    className="w-full pl-10 bg-white/40 dark:bg-slate-800/40 border-white/20 dark:border-white/10 rounded-[1.25rem] h-11 focus-visible:ring-primary/30"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        {/* MEIO: NAVEGAÇÃO COM SCROLL */}
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
            {filteredNavItems.map(item => (
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

        {/* RODAPÉ: PERFIL FLUTUANTE (DESIGN PREMIUM) */}
        <div className="p-4 mt-auto border-t border-black/5 dark:border-white/5">
            <div className="p-4 bg-white/60 dark:bg-slate-800/50 border border-white/60 dark:border-white/5 rounded-[2.2rem] backdrop-blur-md shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Avatar className="h-10 w-10 border-2 border-white dark:border-slate-700 shadow-sm rounded-2xl">
                                <AvatarImage src={user?.avatarUrl} className="object-cover" />
                                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                                    {user?.username?.substring(0,2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 bg-green-500 border-2 border-white dark:border-slate-800 rounded-full" />
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-sm font-bold text-slate-800 dark:text-white leading-none truncate">{user?.username}</span>
                            <span className="text-[10px] font-medium text-muted-foreground">Administrador</span>
                        </div>
                    </div>
                    <Button 
                        onClick={logout} 
                        variant="ghost" 
                        size="icon" 
                        className="h-10 w-10 text-slate-400 hover:bg-red-500 hover:text-white rounded-[1.25rem] transition-all duration-300 active:scale-95"
                    >
                        <LogOut size={18} />
                    </Button>
                </div>
            </div>
        </div>
      </div>
    </aside>
  );
}
