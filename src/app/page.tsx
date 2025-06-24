"use client";

import { useState } from 'react';
import { MainMenu } from '@/components/main-menu';
import { StandardConverter } from '@/components/standard-converter';
import { InventoryConverter } from '@/components/inventory-converter';
import { AppFooter } from '@/components/footer';

type Screen = 'menu' | 'standard' | 'inventory';

export default function Home() {
  const [screen, setScreen] = useState<Screen>('menu');

  const renderScreen = () => {
    switch (screen) {
      case 'standard':
        return <StandardConverter onBack={() => setScreen('menu')} />;
      case 'inventory':
        return <InventoryConverter onBack={() => setScreen('menu')} />;
      case 'menu':
      default:
        return <MainMenu onSelect={(selection) => setScreen(selection as Screen)} />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex-grow flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="w-full transition-all duration-300">
          {renderScreen()}
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
