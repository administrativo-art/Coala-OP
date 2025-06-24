"use client"
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

type MainMenuProps = {
  onSelect: (selection: 'standard' | 'inventory') => void;
};

export function MainMenu({ onSelect }: MainMenuProps) {
  return (
    <Card className="w-full max-w-md mx-auto animate-in fade-in zoom-in-95">
      <CardHeader className="items-center text-center">
        <Image
          src="/logo.png"
          alt="Coala Shakes Logo"
          width={150}
          height={150}
          className="mb-4"
        />
        <CardTitle className="text-3xl font-headline">Conversor Inteligente</CardTitle>
        <CardDescription className="px-4 pt-2">
            Sua ferramenta para conversões de unidades no dia a dia e no controle de estoque.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-6">
        <Button size="lg" className="h-auto justify-between py-4" onClick={() => onSelect('standard')}>
          <div className="text-left">
            <p className="text-base font-semibold">Conversão Padrão</p>
            <p className="text-sm font-normal text-primary-foreground/80">Medidas de peso, volume, etc.</p>
          </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Button size="lg" className="h-auto justify-between py-4" variant="secondary" onClick={() => onSelect('inventory')}>
           <div className="text-left">
            <p className="text-base font-semibold">Conversão de Inventário</p>
            <p className="text-sm font-normal text-secondary-foreground/80">Com base nos seus produtos.</p>
          </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
      </CardContent>
    </Card>
  );
}
