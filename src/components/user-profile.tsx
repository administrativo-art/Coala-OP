
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import { LogOut, Warehouse, Camera, Upload, Users, Undo2 } from 'lucide-react';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';

const resizeImage = (dataUrl: string, maxWidth: number, maxHeight: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round(height * (maxWidth / width));
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round(width * (maxHeight / height));
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context'));
            }
            ctx.drawImage(img, 0, 0, width, height);
            
            resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = (err) => {
            reject(new Error('Failed to load image'));
        };
        img.src = dataUrl;
    });
};

export function UserProfile() {
  const { user, users, originalUser, impersonate, stopImpersonating, logout, updateUser, permissions } = useAuth();
  const { kiosks } = useKiosks();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const isImpersonating = !!originalUser;

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
      reader.onloadend = async () => {
        try {
            const resizedDataUrl = await resizeImage(reader.result as string, 512, 512);
            handlePhotoUpdate(resizedDataUrl);
        } catch (error) {
            console.error("Image resize error:", error);
            toast({
                variant: 'destructive',
                title: 'Erro ao processar imagem',
                description: 'Não foi possível redimensionar a imagem. Tente uma imagem diferente.'
            });
        }
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
              {isImpersonating && (
                <>
                  <DropdownMenuLabel className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200">
                    Navegando como {user.username}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={stopImpersonating}>
                    <Undo2 className="mr-2" />
                    <span>Voltar para {originalUser.username}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
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

              {permissions.users.impersonate && !isImpersonating && (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Users className="mr-2 h-4 w-4" />
                      <span>Navegar como</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <ScrollArea className="h-64">
                          {users
                            .filter(u => u.id !== user.id)
                            .sort((a,b) => a.username.localeCompare(b.username))
                            .map(u => (
                              <DropdownMenuItem key={u.id} onSelect={() => impersonate(u.id)}>
                                  {u.username}
                              </DropdownMenuItem>
                          ))}
                        </ScrollArea>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                </>
              )}

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
