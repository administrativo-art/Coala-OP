
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    }
  }, [isAuthenticated, loading, router]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="inline-block font-logo select-none">
          <div className="text-left text-6xl text-primary">coala</div>
          <div className="text-left text-5xl text-accent -mt-4 pl-6">shakes</div>
        </div>
        <p>Carregando...</p>
      </div>
    </div>
  );
}
