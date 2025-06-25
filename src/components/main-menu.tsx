"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Scale, Boxes, ClipboardCheck, Users, LogOut, ClipboardList } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';

type MainMenuProps = {
  onSelect: (selection: 'standard' | 'inventory' | 'predefined' | 'expiry' | 'users') => void;
};

export function MainMenu({ onSelect }: MainMenuProps) {
  const { user, permissions, logout } = useAuth();
  const { kiosks } = useKiosks();
  
  const canManageUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;
  
  const kioskName = user?.kioskId 
    ? (kiosks.find(k => k.id === user.kioskId)?.name || user.kioskId) 
    : 'N/A';

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
        <Button size="lg" className="h-auto justify-between text-left py-4" onClick={() => onSelect('standard')}>
          <div className="flex items-center">
            <Scale className="h-8 w-8 mr-4 text-primary-foreground/50" />
            <div>
              <p className="text-base font-semibold">Conversão Padrão</p>
              <p className="text-sm font-normal text-primary-foreground/80">Medidas de peso, volume, etc.</p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Button size="lg" className="h-auto justify-between text-left py-4" variant="secondary" onClick={() => onSelect('inventory')}>
           <div className="flex items-center">
            <Boxes className="h-8 w-8 mr-4 text-secondary-foreground/50" />
            <div>
              <p className="text-base font-semibold">Conversão de Inventário</p>
              <p className="text-sm font-normal text-secondary-foreground/80">Com base nos seus produtos.</p>
            </div>
           </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Button size="lg" className="h-auto justify-between text-left py-4" variant="secondary" onClick={() => onSelect('predefined')}>
           <div className="flex items-center">
            <ClipboardList className="h-8 w-8 mr-4 text-secondary-foreground/50" />
            <div>
              <p className="text-base font-semibold">Conversão Predefinida</p>
              <p className="text-sm font-normal text-secondary-foreground/80">Use itens pré-cadastrados para conversões rápidas.</p>
            </div>
           </div>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <Button size="lg" className="h-auto justify-between text-left py-4" variant="secondary" onClick={() => onSelect('expiry')}>
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
          <Button size="lg" className="h-auto justify-between text-left py-4" variant="secondary" onClick={() => onSelect('users')}>
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
        <div className="text-center pt-4">
            <p className="text-sm text-muted-foreground">Logado como: <strong>{user?.username}</strong> (Quiosque: {kioskName})</p>
            <Button variant="link" onClick={logout} className="text-muted-foreground hover:text-primary">
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}
