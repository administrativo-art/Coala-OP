"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Gauge, ChartNoAxesCombined } from 'lucide-react';
import { GoalsProvider } from '@/components/goals-provider';

const navItems = [
  { label: 'Acompanhamento', href: '/dashboard/goals/tracking', icon: Gauge, requireManage: false },
  { label: 'Análise e fechamentos', href: '/dashboard/goals/analysis', icon: ChartNoAxesCombined, requireManage: false },
];

export default function GoalsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions } = useAuth();

  const visibleItems = navItems.filter(item =>
    !item.requireManage || (permissions.goals?.manage ?? false)
  );

  return (
    <GoalsProvider>
      <div className="space-y-6">
        <nav aria-label="Metas de vendas" className="flex gap-1 border-b border-ds-border">
          {visibleItems.map(item => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink',
                  isActive
                    ? 'border-ds-accent text-ds-accent-ink'
                    : 'border-transparent text-ds-ink-muted hover:text-ds-ink hover:border-ds-border-input'
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </GoalsProvider>
  );
}
