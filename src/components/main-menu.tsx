"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Boxes, ClipboardCheck, Users, ClipboardList } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

type MainMenuProps = {
  onSelect: (selection: 'inventory' | 'predefined' | 'expiry' | 'users') => void;
};

export function MainMenu({ onSelect }: MainMenuProps) {
  const { permissions } = useAuth();
  
  const canManageUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;
    
  const buttonClassName = "h-auto justify-between text-left py-4 hover:bg-primary hover:text-primary-foreground transition-colors duration-200";

  return (
    <Card className="w-full max-w-md mx-auto animate-in fade-in zoom-in-95">
      <CardHeader className="items-center text-center">
        <div className="font-logo mb-4 text-center select-none">
          <div className="text-5xl sm:text-6xl text-primary">coala</div>
          <div className="text-4xl sm:text-5xl text-accent -mt-4">shakes</div>
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-headline">Olá, humanos!</CardTitle>
        <CardDescription className="px-4 pt-2">
            Fiz esse APP para ajudar vocês a gerenciar melhor o meu negócio. Estou de olho!
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-6">
        <Button size="lg" className={buttonClassName} variant="secondary" onClick={() => onSelect('inventory')}>
           <div className="flex items-center">
            <Boxes className="h-8 w-8 mr-4 text-secondary-foreground/50" />
            <div>
              <p className="text-base font-semibold">Conversão de Inventário</p>
              <p className="text-sm font-normal text-secondary-foreground/80">Com base nos seus produtos.</p>
            </div>
           </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Button size="lg" className={buttonClassName} variant="secondary" onClick={() => onSelect('predefined')}>
           <div className="flex items-center">
            <ClipboardList className="h-8 w-8 mr-4 text-secondary-foreground/50" />
            <div>
              <p className="text-base font-semibold">Conversão Predefinida</p>
              <p className="text-sm font-normal text-secondary-foreground/80">Use itens pré-cadastrados para conversões rápidas.</p>
            </div>
           </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Button size="lg" className={buttonClassName} variant="secondary" onClick={() => onSelect('expiry')}>
           <div className="flex items-center">
            <ClipboardCheck className="h-8 w-8 mr-4 text-secondary-foreground/50" />
            <div>
              <p className="text-base font-semibold">Controle de Validade</p>
              <p className="text-sm font-normal text-secondary-foreground/80">Gerencie lotes e vencimentos.</p>
            </div>
           </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        {canManageUsers && (
          <Button size="lg" className={buttonClassName} variant="secondary" onClick={() => onSelect('users')}>
            <div className="flex items-center">
              <Users className="h-8 w-8 mr-4 text-secondary-foreground/50" />
              <div>
                <p className="text-base font-semibold">Gerenciar Usuários</p>
                <p className="text-sm font-normal text-secondary-foreground/80">Adicione e edite usuários e permissões.</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
