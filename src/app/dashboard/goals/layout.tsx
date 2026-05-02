"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { TrendingUp, BarChart2, ClipboardList, History } from 'lucide-react';
import { GoalsProvider } from '@/components/goals-provider';

const navItems = [
  { label: 'Acompanhamento', href: '/dashboard/goals/tracking', icon: TrendingUp, requireManage: false },
  { label: 'Cadastro', href: '/dashboard/goals/registration', icon: ClipboardList, requireManage: true },
  { label: 'Análise', href: '/dashboard/goals/analysis', icon: BarChart2, requireManage: false },
  { label: 'Histórico', href: '/dashboard/goals/history', icon: History, requireManage: false },
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
    </GoalsProvider>
  );
}
