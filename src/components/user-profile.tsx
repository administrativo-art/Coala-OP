
"use client"

import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LogOut, Warehouse, Camera, Upload, KeyRound, Loader2, Eye, RotateCcw, Search } from 'lucide-react';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';
import { ChangePasswordModal } from './change-password-modal';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import type { DeveloperViewAsUser } from '@/features/auth/developer-view-as';

const LOCAL_VIEW_AS_PREVIEW: DeveloperViewAsUser[] = [
  { id: 'preview-heucilene', username: 'Heucilene Oliveira Ribeiro', email: 'heucilene@coalashakes.com', jobRoleName: 'Atendente', profileId: 'profile-attendant' },
  { id: 'preview-edna', username: 'Maria Edna Gois Ribeiro', email: 'edna@coalashakes.com', jobRoleName: 'Administrativo', profileId: 'profile-administrative' },
  { id: 'preview-edwilson', username: 'Edwilson Lobato', email: 'edwilson@coalashakes.com', jobRoleName: 'Líder', profileId: 'profile-leader' },
  { id: 'preview-samila', username: 'Samila Santos', email: 'samila@coalashakes.com', jobRoleName: 'Atendente', profileId: 'profile-attendant' },
];

function getInitials(name?: string) {
  return (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

function getAvatarUploadErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === 'storage/unauthorized') {
    return 'Seu acesso não tem permissão para gravar neste caminho de avatar.';
  }
  return 'Tente novamente.';
}

export function UserProfile({ variant = "avatar", collapsed = false }: { variant?: "avatar" | "card"; collapsed?: boolean }) {
  const {
    user,
    authenticatedUser,
    logout,
    updateUser,
    canViewAs,
    viewAs,
    viewAsUsers,
    startViewAs,
    stopViewAs,
  } = useAuth();
  const { kiosks } = useKiosks();
  const { profiles } = useProfiles();
  const { toast } = useToast();

  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isViewAsOpen, setIsViewAsOpen] = useState(false);
  const [viewAsQuery, setViewAsQuery] = useState('');
  const [viewAsBusy, setViewAsBusy] = useState(false);
  const [localViewAs, setLocalViewAs] = useState<DeveloperViewAsUser | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const kioskNames = (user.assignedKioskIds ?? [])
    .map(id => kiosks.find(k => k.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const profile = user?.profileId ? profiles.find(p => p.id === user.profileId) : null;
  const profileName = profile ? profile.name : 'Perfil não encontrado';
  const usesLocalPreview = process.env.NODE_ENV === 'development' && canViewAs && viewAsUsers.length === 0;
  const displayedViewAs = viewAs ?? localViewAs;
  const displayedViewAsUsers = usesLocalPreview ? LOCAL_VIEW_AS_PREVIEW : viewAsUsers;
  const normalizedViewAsQuery = viewAsQuery.trim().toLocaleLowerCase('pt-BR');
  const filteredViewAsUsers = normalizedViewAsQuery
    ? displayedViewAsUsers.filter((candidate) =>
        `${candidate.username} ${candidate.email} ${candidate.jobRoleName ?? ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedViewAsQuery)
      )
    : displayedViewAsUsers;

  const handleStartViewAs = async (targetUserId: string) => {
    if (usesLocalPreview) {
      setLocalViewAs(LOCAL_VIEW_AS_PREVIEW.find((candidate) => candidate.id === targetUserId) ?? null);
      setIsViewAsOpen(false);
      return;
    }
    setViewAsBusy(true);
    try {
      await startViewAs(targetUserId);
    } catch (error) {
      setViewAsBusy(false);
      toast({
        variant: 'destructive',
        title: 'Não foi possível visualizar esse usuário.',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });
    }
  };

  const handleStopViewAs = async () => {
    if (localViewAs) {
      setLocalViewAs(null);
      return;
    }
    setViewAsBusy(true);
    try {
      await stopViewAs();
    } catch (error) {
      setViewAsBusy(false);
      toast({
        variant: 'destructive',
        title: 'Não foi possível voltar ao seu perfil.',
        description: error instanceof Error ? error.message : 'Tente novamente.',
      });
    }
  };

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
      toast({ variant: 'destructive', title: 'Erro ao salvar foto.', description: getAvatarUploadErrorMessage(error) });
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
          {variant === "card" ? (
            <button
              type="button"
              disabled={isUploadingPhoto}
              title={collapsed ? `${user.username} · ${profileName}` : undefined}
              className={`group/user flex w-full items-center gap-2.5 rounded-ds-btn-lg border border-white/10 bg-white/6 text-left text-ds-on-dark transition-colors hover:bg-white/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-kicker ${collapsed ? "justify-center p-1.5" : "p-2"}`}
            >
              <Avatar className={`shrink-0 ring-2 ring-white/10 transition-[width,height] duration-300 motion-reduce:transition-none ${collapsed ? "h-9 w-9" : "h-10 w-10"}`}>
                {isUploadingPhoto ? (
                  <AvatarFallback><Loader2 className="h-4 w-4 animate-spin" /></AvatarFallback>
                ) : user.avatarUrl ? (
                  <AvatarImage src={user.avatarUrl} alt={user.username} className="object-cover" />
                ) : (
                  <AvatarFallback className="bg-ds-accent text-[13px] font-extrabold text-ds-dark">
                    {getInitials(user.username)}
                  </AvatarFallback>
                )}
              </Avatar>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold leading-tight">{user.username}</span>
                  <span className="block truncate text-[11.5px] text-ds-on-dark-muted">{user.jobRoleName || profileName}</span>
                </span>
              )}
              <span className="sr-only">Menu do usuário</span>
            </button>
          ) : (
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
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align={variant === "card" ? "start" : "end"} side={variant === "card" ? "right" : "bottom"} className="w-64">
          <div className="flex items-center gap-3 px-2 py-2.5">
            {displayedViewAs ? (
              <Avatar className="h-11 w-11 shrink-0">
                {displayedViewAs.avatarUrl ? <AvatarImage src={displayedViewAs.avatarUrl} alt={displayedViewAs.username} className="object-cover" /> : null}
                <AvatarFallback className="bg-ds-accent-soft text-[13px] font-extrabold text-ds-accent-ink">
                  {getInitials(displayedViewAs.username)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuPrimitive.SubTrigger
                  aria-label="Alterar foto de perfil"
                  disabled={isUploadingPhoto}
                  className="group/photo relative shrink-0 cursor-pointer rounded-full outline-hidden data-highlighted:ring-2 data-highlighted:ring-ds-accent-ink data-[state=open]:ring-2 data-[state=open]:ring-ds-accent-ink"
                >
                  <Avatar className="h-11 w-11">
                    {isUploadingPhoto ? (
                      <AvatarFallback><Loader2 className="h-4 w-4 animate-spin" /></AvatarFallback>
                    ) : user.avatarUrl ? (
                      <AvatarImage src={user.avatarUrl} alt={user.username} className="object-cover" />
                    ) : (
                      <AvatarFallback className="bg-ds-accent text-[13px] font-extrabold text-ds-dark">
                        {getInitials(user.username)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-popover text-muted-foreground group-hover/photo:text-foreground">
                    <Camera className="h-3 w-3" />
                  </span>
                </DropdownMenuPrimitive.SubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="w-44">
                    <DropdownMenuItem onSelect={() => setIsPhotoModalOpen(true)}>
                      <Camera className="mr-2 h-4 w-4" />
                      <span>Tirar foto</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                      <Upload className="mr-2 h-4 w-4" />
                      <span>Carregar foto</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="truncate text-sm font-medium leading-tight">{displayedViewAs?.username ?? user.username}</p>
              <p className="truncate text-xs text-muted-foreground">
                {displayedViewAs ? `${displayedViewAs.jobRoleName || displayedViewAs.email} · somente leitura` : profileName}
              </p>
              {!displayedViewAs && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground" title={kioskNames.join(', ') || undefined}>
                  <Warehouse className="h-3 w-3 shrink-0" />
                  <span className="truncate">{kioskNames[0] ?? 'Sem quiosque'}</span>
                  {kioskNames.length > 1 && <span className="shrink-0">· +{kioskNames.length - 1}</span>}
                </p>
              )}
            </div>
          </div>
          <DropdownMenuSeparator />
          {canViewAs && (displayedViewAs ? (
            <DropdownMenuItem disabled={viewAsBusy} onSelect={handleStopViewAs} className="font-medium">
              <RotateCcw className="mr-2 h-4 w-4" />
              <span>Voltar ao meu perfil</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setIsViewAsOpen(true)}>
              <Eye className="mr-2 h-4 w-4" />
              <span>Visualizar como usuário</span>
            </DropdownMenuItem>
          ))}
          {!displayedViewAs && (
            <DropdownMenuItem onSelect={() => setIsPasswordModalOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              <span>Alterar senha</span>
            </DropdownMenuItem>
          )}
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

      <Dialog open={isViewAsOpen} onOpenChange={setIsViewAsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Visualizar como usuário</DialogTitle>
            <DialogDescription>
              Você continua autenticado como {authenticatedUser?.email}. As alterações ficam bloqueadas até voltar ao seu perfil.
            </DialogDescription>
          </DialogHeader>
          {usesLocalPreview && (
            <p className="rounded-ds-card border border-ds-accent/30 bg-ds-accent-soft px-3 py-2 text-xs text-ds-accent-ink">
              Prévia local preenchida: nenhuma troca de identidade será enviada ao servidor.
            </p>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={viewAsQuery}
              onChange={(event) => setViewAsQuery(event.target.value)}
              placeholder="Buscar por nome, e-mail ou função"
              className="pl-9"
            />
          </div>
          <ScrollArea className="max-h-[min(420px,60vh)] pr-3">
            <div className="space-y-2">
              {filteredViewAsUsers.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={viewAsBusy}
                  onClick={() => handleStartViewAs(candidate.id)}
                  className="flex w-full items-center gap-3 rounded-ds-card border border-ds-border bg-ds-surface px-3 py-3 text-left transition-colors hover:bg-ds-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink disabled:opacity-60"
                >
                  <Avatar className="h-9 w-9">
                    {candidate.avatarUrl ? <AvatarImage src={candidate.avatarUrl} alt={candidate.username} /> : null}
                    <AvatarFallback>{candidate.username.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{candidate.username}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {candidate.jobRoleName || candidate.email}
                    </span>
                  </span>
                  {viewAsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                </button>
              ))}
              {filteredViewAsUsers.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Nenhum usuário ativo encontrado.</p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
