"use client"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

type MainMenuProps = {
  onSelect: (selection: 'standard' | 'inventory') => void;
};

export function MainMenu({ onSelect }: MainMenuProps) {
  return (
    <Card className="w-full max-w-md mx-auto animate-in fade-in zoom-in-95">
      <CardHeader>
        <CardTitle className="text-center text-3xl font-headline">Conversor Inteligente</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-6">
        <Button size="lg" className="h-20 text-lg" onClick={() => onSelect('standard')}>
          Conversão Padrão
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
        <Button size="lg" className="h-20 text-lg" variant="secondary" onClick={() => onSelect('inventory')}>
          Conversão de Inventário
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </CardContent>
    </Card>
  );
}
