"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { MainMenu } from '@/components/main-menu';
import { InventoryConverter } from '@/components/inventory-converter';
import { PredefinedConverter } from '@/components/predefined-converter';
import { ExpiryControl } from '@/components/expiry-control';
import { UserManagement } from '@/components/user-management';
import { AppFooter } from '@/components/footer';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

type Screen = 'menu' | 'inventory' | 'predefined' | 'expiry' | 'users';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('menu');
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, router]);

  if (loading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-10 w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  const renderScreen = () => {
    switch (screen) {
      case 'inventory':
        return <InventoryConverter />;
      case 'predefined':
        return <PredefinedConverter />;
      case 'expiry':
        return <ExpiryControl />;
      case 'users':
        return <UserManagement />;
      case 'menu':
      default:
        return <MainMenu onSelect={(selection) => setScreen(selection as Screen)} />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-grow flex flex-col items-center p-4 sm:p-6 md:p-8">
        <div className="w-full max-w-4xl transition-all duration-300">
          {screen !== 'menu' && (
            <Button
              variant="ghost"
              size="sm"
              className="mb-4"
              onClick={() => setScreen('menu')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Menu
            </Button>
          )}
          {renderScreen()}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
