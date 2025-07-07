
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

  if (loading || !isAuthenticated) {
    return (
      <div className="flex h-screen w-full">
         <div className="hidden border-r bg-muted/40 md:block w-[280px]">
            <div className="flex h-full max-h-screen flex-col">
                 <div className="flex h-14 items-center justify-center border-b px-4 lg:h-[60px]">
                    <Skeleton className="h-8 w-40" />
                 </div>
                 <div className="flex-1 p-4 space-y-4">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                 </div>
            </div>
         </div>
        <div className="flex flex-col flex-1">
            <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
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
    <div className="grid min-h-screen w-full md:grid-cols-[280px_1fr]">
      <Sidebar />
      <div className="flex flex-col overflow-hidden">
        <Header />
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 bg-background overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
