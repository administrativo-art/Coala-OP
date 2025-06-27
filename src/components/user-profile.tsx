"use client"

import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut, User, Warehouse } from 'lucide-react';

export function UserProfile() {
  const { user, logout } = useAuth();
  const { kiosks } = useKiosks();

  if (!user) {
    return null;
  }

  const kioskName = user?.kioskId 
    ? (kiosks.find(k => k.id === user.kioskId)?.name || 'N/A') 
    : 'N/A';

  return (
    <div className="absolute top-6 left-6 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-12 w-12 rounded-full">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                {user.username?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="start" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user.username}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {user.role === 'admin' ? 'Administrador' : 'Usuário Padrão'}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-default focus:bg-transparent focus:text-accent-foreground">
              <Warehouse className="mr-2 h-4 w-4" />
              <span>Quiosque: {kioskName}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <User className="mr-2 h-4 w-4" />
            <span>Adicionar Foto</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sair</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
