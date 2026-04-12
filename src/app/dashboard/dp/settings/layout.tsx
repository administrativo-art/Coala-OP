"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Users, Building2, Clock, CalendarDays } from 'lucide-react';

const navItems = [
  { label: 'Colaboradores', href: '/dashboard/dp/settings/collaborators', icon: Users,        perm: 'collaborators' as const },
  { label: 'Unidades',      href: '/dashboard/dp/settings/units',          icon: Building2,    perm: 'units' as const },
  { label: 'Turnos',        href: '/dashboard/dp/settings/shifts',         icon: Clock,        perm: 'shifts' as const },
  { label: 'Calendários',   href: '/dashboard/dp/settings/calendars',      icon: CalendarDays, perm: 'calendars' as const },
];

const permMap = {
  collaborators: (dp: any) => dp?.collaborators?.add,
  units:         (dp: any) => dp?.settings?.manageUnits,
  shifts:        (dp: any) => dp?.settings?.manageShifts,
  calendars:     (dp: any) => dp?.settings?.manageCalendars,
};

export default function DPSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions } = useAuth();

  const visibleItems = navItems.filter(item => permMap[item.perm](permissions.dp));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações — Departamento Pessoal</h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie os dados base do módulo.</p>
      </div>
      <nav className="flex gap-1 border-b pb-0">
        {visibleItems.map(item => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
