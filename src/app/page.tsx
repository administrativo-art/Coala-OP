"use client";

import { useState } from 'react';
import { MainMenu } from '@/components/main-menu';
import { StandardConverter } from '@/components/standard-converter';
import { InventoryConverter } from '@/components/inventory-converter';

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
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 md:p-24 bg-background">
      <div className="w-full transition-all duration-300">
        {renderScreen()}
      </div>
    </main>
  );
}
