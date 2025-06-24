"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Scale, Boxes, ClipboardCheck } from 'lucide-react';

type MainMenuProps = {
  onSelect: (selection: 'standard' | 'inventory' | 'expiry') => void;
};

export function MainMenu({ onSelect }: MainMenuProps) {
  return (
    <Card className="w-full max-w-md mx-auto animate-in fade-in zoom-in-95">
      <CardHeader className="items-center text-center">
        <div className="font-logo mb-4 text-center select-none">
          <div className="text-6xl text-primary">coala</div>
          <div className="text-5xl text-accent -mt-4">shakes</div>
        </div>
        <CardTitle className="text-3xl font-headline">Olá, humanos!</CardTitle>
        <CardDescription className="px-4 pt-2">
            Fiz esse APP para ajudar vocês a gerenciar melhor o meu negócio. Estou de olho!
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
        <Button size="lg" className="h-auto justify-start text-left py-4" variant="secondary" onClick={() => onSelect('expiry')}>
           <ClipboardCheck className="h-8 w-8 mr-4 text-secondary-foreground/50" />
           <div className="flex-grow">
            <p className="text-base font-semibold">Controle de Validade</p>
            <p className="text-sm font-normal text-secondary-foreground/80">Gerencie lotes e vencimentos.</p>
          </div>
          <ArrowRight className="h-5 w-5 ml-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
