
"use client"

import { useState, useRef } from 'react';
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
import { Input } from '@/components/ui/input';
import { LogOut, Warehouse, Camera, Upload } from 'lucide-react';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';


export function UserProfile() {
  const { user, logout, updateUser } = useAuth();
  const { kiosks } = useKiosks();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) {
    return null;
  }

  const kioskNames = user.assignedKioskIds
    .map(id => kiosks.find(k => k.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  
  const profile = user?.profileId ? profiles.find(p => p.id === user.profileId) : null;
  const profileName = profile ? profile.name : 'Perfil não encontrado';

  const handlePhotoUpdate = (dataUrl: string) => {
    if (user) {
      updateUser({ ...user, avatarUrl: dataUrl });
      toast({ title: "Foto de perfil atualizada!" });
    }
  };

  const handlePhotoCaptured = (dataUrl: string) => {
    handlePhotoUpdate(dataUrl);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        toast({
          variant: 'destructive',
          title: 'Arquivo muito grande',
          description: 'Por favor, selecione um arquivo de imagem menor que 2MB.',
        });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        handlePhotoUpdate(reader.result as string);
      };
      reader.readAsDataURL(file);
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
                  <span>Tirar foto</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  <span>Carregar foto</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
              </DropdownMenuItem>
          </DropdownMenuContent>
      </DropdownMenu>

       <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileUpload}
      />

      <PhotoCaptureModal 
        open={isPhotoModalOpen}
        onOpenChange={setIsPhotoModalOpen}
        onPhotoCaptured={handlePhotoCaptured}
      />
    </>
  );
}
