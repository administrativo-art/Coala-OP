
"use client"

import { useState } from 'react';
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut, Warehouse, Camera } from 'lucide-react';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';


export function UserProfile() {
  const { user, logout, updateUser } = useAuth();
  const { kiosks } = useKiosks();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);

  if (!user) {
    return null;
  }

  const kioskNames = user.assignedKioskIds
    .map(id => kiosks.find(k => k.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  
  const profile = user?.profileId ? profiles.find(p => p.id === user.profileId) : null;
  const profileName = profile ? profile.name : 'Perfil não encontrado';

  const handlePhotoCaptured = (dataUrl: string) => {
    if (user) {
      updateUser({ ...user, avatarUrl: dataUrl });
      toast({ title: "Foto de perfil atualizada!" });
    }
  };

  return (
    <>
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="rounded-full">
                  <Avatar className="h-8 w-8">
                    {user.avatarUrl ? (
                        <AvatarImage src={user.avatarUrl} alt={user.username} />
                    ) : (
                        <AvatarFallback className="bg-secondary text-secondary-foreground">
                        {user.username?.charAt(0).toUpperCase()}
                        </AvatarFallback>
                    )}
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
                  <span>Quiosque(s): {kioskNames || 'N/A'}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setIsPhotoModalOpen(true)}>
                  <Camera className="mr-2 h-4 w-4" />
                  <span>Adicionar foto</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
              </DropdownMenuItem>
          </DropdownMenuContent>
      </DropdownMenu>

      <PhotoCaptureModal 
        open={isPhotoModalOpen}
        onOpenChange={setIsPhotoModalOpen}
        onPhotoCaptured={handlePhotoCaptured}
      />
    </>
  );
}
