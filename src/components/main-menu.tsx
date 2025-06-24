"use client"
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Scale, Boxes } from 'lucide-react';

type MainMenuProps = {
  onSelect: (selection: 'standard' | 'inventory') => void;
};

export function MainMenu({ onSelect }: MainMenuProps) {
  return (
    <Card className="w-full max-w-md mx-auto animate-in fade-in zoom-in-95">
      <CardHeader className="items-center text-center">
        <Image
          src="https://placehold.co/150x150.png"
          alt="Coala Shakes Logo"
          width={150}
          height={150}
          data-ai-hint="koala logo"
          className="mb-4 rounded-full"
        />
        <CardTitle className="text-3xl font-headline">Conversor Inteligente</CardTitle>
        <CardDescription className="px-4 pt-2">
            Sua ferramenta para conversões de unidades no dia a dia e no controle de estoque.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-6">
        <Button size="lg" className="h-auto justify-start text-left py-4" onClick={() => onSelect('standard')}>
          <Scale className="h-8 w-8 mr-4 text-primary-foreground/50" />
          <div className="flex-grow">
            <p className="text-base font-semibold">Conversão Padrão</p>
            <p className="text-sm font-normal text-primary-foreground/80">Medidas de peso, volume, etc.</p>
          </div>
          <ArrowRight className="h-5 w-5 ml-4" />
        </Button>
        <Button size="lg" className="h-auto justify-start text-left py-4" variant="secondary" onClick={() => onSelect('inventory')}>
           <Boxes className="h-8 w-8 mr-4 text-secondary-foreground/50" />
           <div className="flex-grow">
            <p className="text-base font-semibold">Conversão de Inventário</p>
            <p className="text-sm font-normal text-secondary-foreground/80">Com base nos seus produtos.</p>
          </div>
          <ArrowRight className="h-5 w-5 ml-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
