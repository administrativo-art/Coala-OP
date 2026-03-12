"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@/hooks/use-auth';
import { GlassSidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Undo2 } from 'lucide-react';
import { DebugPanel } from '@/components/debug-panel';
import { useAllTasks } from '@/hooks/use-all-tasks';

function LoadingSkeleton() {
    return (
      <div className="flex h-screen w-full">
        <div className="flex flex-col flex-1">
            <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
                <Skeleton className="h-8 w-8 rounded-full" />
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, originalUser, stopImpersonating } = useUser();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { legacyTasks, loading: tasksLoading } = useAllTasks();
  const router = useRouter();
  const [dataLoadTime, setDataLoadTime] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const startTime = performance.now();
    if (!authLoading) {
      const endTime = performance.now();
      setDataLoadTime(endTime - startTime);
      if (!isAuthenticated) {
        router.push('/login');
      }
    }
  }, [isAuthenticated, authLoading, router]);
  
  if (!isMounted || authLoading || tasksLoading || !isAuthenticated) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#f8fafc] dark:bg-[#0f172a]">
       <div className="fixed inset-0 bg-[radial-gradient(at_0%_0%,rgba(124,58,237,0.03)_0,transparent_50%),radial-gradient(at_100%_100%,rgba(236,72,153,0.03)_0,transparent_50%)] pointer-events-none" />
      <GlassSidebar open={isSidebarOpen} onOpenChange={setIsSidebarOpen} />
      <div className="flex flex-col flex-1">
        <Header tasks={legacyTasks} onMenuClick={() => setIsSidebarOpen(true)} />
        {originalUser && (
          <div className="flex items-center justify-center gap-4 bg-yellow-400 text-black font-bold text-center py-2 px-4 shadow-md z-20">
            <span>Você está navegando como <strong>{user?.username}</strong>.</span>
            <Button variant="ghost" className="h-auto p-0 underline text-black hover:bg-yellow-400/50 hover:text-black" onClick={stopImpersonating}>
              <Undo2 className="mr-1 h-4 w-4"/>
              Voltar para sua conta
            </Button>
          </div>
        )}
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
          {children}
        </main>
        {process.env.NODE_ENV === 'development' && <DebugPanel dataLoadTime={dataLoadTime} />}
      </div>
    </div>
  )
}
