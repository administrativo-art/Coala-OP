
"use client"

import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
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
  const { profiles } = useProfiles();

  if (!user) {
    return null;
  }

  const kioskName = user?.kioskId 
    ? (kiosks.find(k => k.id === user.kioskId)?.name || 'N/A') 
    : 'N/A';
  
  const profile = user?.profileId ? profiles.find(p => p.id === user.profileId) : null;
  const profileName = profile ? profile.name : 'Perfil não encontrado';

  return (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                    {user.username?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                </Avatar>
                <span className="sr-only">Toggle user menu</span>
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
            <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.username}</p>
                <p className="text-xs leading-none text-muted-foreground">
                    {profileName}
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
                <span>Adicionar foto</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sair</span>
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
  );
}
