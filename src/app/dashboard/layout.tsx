

"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Undo2 } from 'lucide-react';
import { DebugPanel } from '@/components/debug-panel';
import { useAllTasks } from '@/hooks/use-all-tasks';
import { useKiosks } from '@/hooks/use-kiosks';
import { useLocalStorage } from '@/hooks/use-local-storage';

function SidebarSkeleton({ isCollapsed }: { isCollapsed: boolean }) {
    return (
        <div className={cn("hidden border-r bg-card md:flex flex-col dark transition-[width] duration-300", isCollapsed ? "w-[80px]" : "w-[280px]")}>
            <div className="flex h-[60px] shrink-0 items-center justify-center border-b px-4">
                <Skeleton className="h-8 w-8" />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-4 space-y-4">
                <Skeleton className="h-9 w-full" />
                <div className="space-y-2 pt-4">
                    {!isCollapsed && <Skeleton className="h-4 w-20 mb-2 ml-3" />}
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                </div>
                 <div className="space-y-2 pt-4">
                    {!isCollapsed && <Skeleton className="h-4 w-24 mb-2 ml-3" />}
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                </div>
            </div>
             <div className="mt-auto p-4 border-t flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-10 w-10" />
                    {!isCollapsed && <Skeleton className="h-8 w-8" />}
                </div>
            </div>
        </div>
    );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isAuthenticated, loading, originalUser, stopImpersonating } = useAuth();
  const { legacyTasks, loading: tasksLoading } = useAllTasks();
  const [isCollapsed, setIsCollapsed] = useLocalStorage('sidebarIsCollapsed', false);
  const router = useRouter();
  const pathname = usePathname();
  const [dataLoadTime, setDataLoadTime] = useState<number | null>(null);

  useEffect(() => {
    const startTime = performance.now();
    if (!loading) {
      const endTime = performance.now();
      setDataLoadTime(endTime - startTime);
      if (!isAuthenticated) {
        router.push('/login');
      }
    }
  }, [isAuthenticated, loading, router]);
  
  if (loading || tasksLoading || !isAuthenticated) {
    return (
      <div className="flex h-screen w-full">
         <SidebarSkeleton isCollapsed={isCollapsed} />
        <div className="flex flex-col flex-1">
            <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
                <Skeleton className="h-8 w-8 rounded-full md:hidden" />
                <div className="w-full flex-1"></div>
                <Skeleton className="h-8 w-8 rounded-full" />
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
            </main>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("grid min-h-screen w-full", isCollapsed ? "md:grid-cols-[80px_1fr]" : "md:grid-cols-[280px_1fr]")}>
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <div className="flex flex-col min-w-0">
        <Header tasks={legacyTasks} />
        {originalUser && (
          <div className="flex items-center justify-center gap-4 bg-yellow-400 text-black font-bold text-center py-2 px-4 shadow-md">
            <span>Você está navegando como <strong>{user?.username}</strong>.</span>
            <Button variant="ghost" className="h-auto p-0 underline text-black hover:bg-yellow-400/50 hover:text-black" onClick={stopImpersonating}>
              <Undo2 className="mr-1 h-4 w-4"/>
              Voltar para sua conta
            </Button>
          </div>
        )}
        <main className="p-4 lg:p-6 bg-background">
          {children}
        </main>
      </div>
      {process.env.NODE_ENV === 'development' && <DebugPanel dataLoadTime={dataLoadTime} />}
    </div>
  )
}
