
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
import { LogOut, Warehouse, Camera, Upload, KeyRound, Loader2 } from 'lucide-react';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';
import { ChangePasswordModal } from './change-password-modal';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

export function UserProfile() {
  const { user, logout, updateUser } = useAuth();
  const { kiosks } = useKiosks();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const kioskNames = user.assignedKioskIds
    .map(id => kiosks.find(k => k.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const profile = user?.profileId ? profiles.find(p => p.id === user.profileId) : null;
  const profileName = profile ? profile.name : 'Perfil não encontrado';

  // ── Salva no Storage e guarda só a URL no Firestore ──────────────
  const handlePhotoUpdate = async (dataUrl: string) => {
    if (!user) return;
    setIsUploadingPhoto(true);
    try {
      const storageRef = ref(storage, `avatars/${user.id}`);
      await uploadString(storageRef, dataUrl, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      await updateUser({ ...user, avatarUrl: downloadURL });
      toast({ title: "Foto de perfil atualizada!" });
    } catch (error) {
      console.error(error);
      toast({ variant: 'destructive', title: 'Erro ao salvar foto.', description: 'Tente novamente.' });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handlePhotoCaptured = async (dataUrl: string) => {
    await handlePhotoUpdate(dataUrl);
    setIsPhotoModalOpen(false);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { // 5MB — Storage suporta bem
      toast({
        variant: 'destructive',
        title: 'Arquivo muito grande',
        description: 'Selecione uma imagem menor que 5MB.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      if (reader.result) {
        await handlePhotoUpdate(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" disabled={isUploadingPhoto}>
            <Avatar className="h-8 w-8">
              {isUploadingPhoto ? (
                <AvatarFallback>
                  <Loader2 className="h-4 w-4 animate-spin" />
                </AvatarFallback>
              ) : user.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt={user.username} />
              ) : (
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {user.username?.charAt(0).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
            <span className="sr-only">Menu do usuário</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user.username}</p>
              <p className="text-xs leading-none text-muted-foreground">{profileName}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-default focus:bg-transparent">
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
          <DropdownMenuItem onSelect={() => setIsPasswordModalOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            <span>Alterar senha</span>
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

      <ChangePasswordModal
        open={isPasswordModalOpen}
        onOpenChange={setIsPasswordModalOpen}
      />
    </>
  );
}
