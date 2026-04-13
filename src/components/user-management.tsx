"use client"

import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format } from 'date-fns';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
import { useDP } from '@/hooks/use-dp';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2, Users, Shield, ChevronsUpDown, Check, DollarSign, Search, Eraser, Eye, EyeOff, Camera, Upload, KeyRound, Loader2, Building2, ArrowLeft, UserCircle, Briefcase, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { type User } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ProfileManagementModal } from './profile-management-modal';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { storage } from '@/lib/firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { pickUserColor, getUserColor } from '@/lib/utils/user-colors';

function timestampToDateInput(ts: Timestamp | undefined): string {
  if (!ts) return '';
  try { return format(ts.toDate(), 'yyyy-MM-dd'); } catch { return ''; }
}


const userSchema = z.object({
  username: z.string().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  email: z.string().email("O e-mail é inválido."),
  password: z.string().optional(),
  profileId: z.string({ required_error: 'É obrigatório selecionar um perfil.' }).min(1, 'O perfil é obrigatório.'),
  assignedKioskIds: z.array(z.string()),
  avatarUrl: z.string().optional(),
  operacional: z.boolean().optional(),
  participatesInGoals: z.boolean().optional(),
  // Departamento Pessoal
  registrationIdBizneo: z.string().optional(),
  registrationIdPdv: z.string().optional(),
  admissionDate: z.string().optional(),
  birthDate: z.string().optional(),
  shiftDefinitionId: z.string().optional(),
  needsTransportVoucher: z.boolean().optional(),
  transportVoucherValue: z.coerce.number().nonnegative().optional(),
}).refine(data => {
    return !data.password || data.password.length >= 6;
}, {
    message: "A senha deve ter pelo menos 6 caracteres.",
    path: ["password"],
}).refine(data => {
    // Quiosque obrigatório apenas para não-admins
    if (data.profileId === 'admin') return true;
    return data.assignedKioskIds.length > 0;
}, {
    message: 'Selecione pelo menos um quiosque.',
    path: ['assignedKioskIds'],
});

type UserFormValues = z.infer<typeof userSchema>;

export function UserManagement() {
  const { permissions, users, addUser, deleteUser, user: currentUser, updateUser, resetPassword } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();
  const { shiftDefinitions } = useDP();
  const { toast } = useToast();
  
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [userToResetPassword, setUserToResetPassword] = useState<User | null>(null);
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileFilter, setProfileFilter] = useState('all');
  const [kioskFilter, setKioskFilter] = useState('all');
  const [showPassword, setShowPassword] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [pdvOperatorIds, setPdvOperatorIds] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
        username: '',
        email: '',
        password: '',
        profileId: '',
        assignedKioskIds: [],
        avatarUrl: '',
        operacional: false,
        participatesInGoals: false,
        registrationIdBizneo: '',
        registrationIdPdv: '',
        admissionDate: '',
        birthDate: '',
        shiftDefinitionId: '',
        needsTransportVoucher: false,
        transportVoucherValue: undefined,
    }
  });

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const searchMatch = user.username.toLowerCase().includes(searchTerm.toLowerCase());
      const profileMatch = profileFilter === 'all' || user.profileId === profileFilter;
      const kioskMatch = kioskFilter === 'all' || user.assignedKioskIds.includes(kioskFilter);
      return searchMatch && profileMatch && kioskMatch;
    });
  }, [users, searchTerm, profileFilter, kioskFilter]);

  // Group users by profile, ordered: admin → gestor/gerente → líder → others
  const groupedUsers = useMemo(() => {
    const profileOrder = (profileId: string, name: string) => {
      if (profileId === adminProfileId) return 0;
      const n = name.toLowerCase();
      if (n.includes('gestor') || n.includes('gerente')) return 1;
      if (n.includes('líder') || n.includes('lider')) return 2;
      return 3;
    };

    const map = new Map<string, { profileId: string; profileName: string; order: number; users: User[] }>();
    filteredUsers.forEach(user => {
      const profileName = profiles.find(p => p.id === user.profileId)?.name ?? 'Sem perfil';
      if (!map.has(user.profileId)) {
        map.set(user.profileId, {
          profileId: user.profileId,
          profileName,
          order: profileOrder(user.profileId, profileName),
          users: [],
        });
      }
      map.get(user.profileId)!.users.push(user);
    });

    return [...map.values()].sort((a, b) => a.order - b.order || a.profileName.localeCompare(b.profileName));
  }, [filteredUsers, profiles, adminProfileId]);


  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      email: '',
      password: '',
      profileId: '',
      assignedKioskIds: [],
      avatarUrl: '',
      operacional: false,
      participatesInGoals: false,
      registrationIdBizneo: '',
      registrationIdPdv: '',
      admissionDate: '',
      birthDate: '',
      shiftDefinitionId: '',
      needsTransportVoucher: false,
      transportVoucherValue: undefined,
    });
    setPdvOperatorIds({});
    setShowForm(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      email: user.email,
      password: '',
      profileId: user.profileId,
      assignedKioskIds: user.assignedKioskIds || [],
      avatarUrl: user.avatarUrl || '',
      operacional: user.operacional || false,
      participatesInGoals: user.participatesInGoals || false,
      registrationIdBizneo: user.registrationIdBizneo ?? '',
      registrationIdPdv: user.registrationIdPdv ?? '',
      admissionDate: timestampToDateInput(user.admissionDate),
      birthDate: timestampToDateInput(user.birthDate),
      shiftDefinitionId: user.shiftDefinitionId ?? '',
      needsTransportVoucher: user.needsTransportVoucher ?? false,
      transportVoucherValue: user.transportVoucherValue,
    });
    const existing: Record<string, string> = {};
    Object.entries(user.pdvOperatorIds ?? {}).forEach(([k, v]) => { existing[k] = String(v); });
    setPdvOperatorIds(existing);
    setShowForm(true);
  };
  
  const profileIsAdmin = (profileId: string) => profileId === adminProfileId;
  const handleDeleteClick = (user: User) => {
    if (user.id === currentUser?.id || profileIsAdmin(user.profileId)) return;
    setUserToDelete(user);
  };

  const handleDeleteConfirm = async () => {
    if (userToDelete) {
      await deleteUser(userToDelete.id);
      setUserToDelete(null);
    }
  };
  
  const handleResetPasswordConfirm = async () => {
    if (userToResetPassword) {
      const success = await resetPassword(userToResetPassword.email);
      if (success) {
        toast({
          title: "E-mail de redefinição enviado!",
          description: `Um link para redefinir a senha foi enviado para ${userToResetPassword.email}.`
        });
      } else {
        toast({
          variant: "destructive",
          title: "Falha no envio",
          description: "Não foi possível enviar o e-mail de redefinição de senha."
        });
      }
      setUserToResetPassword(null);
    }
  };

  const onSubmit = async (values: UserFormValues) => {
    const avatarUrl = values.avatarUrl || '';
    if (editingUser) {
      // Converte datas DP para Timestamp
      const admissionDate = values.admissionDate
        ? Timestamp.fromDate(new Date(values.admissionDate + 'T12:00:00'))
        : undefined;
      const birthDate = values.birthDate
        ? Timestamp.fromDate(new Date(values.birthDate + 'T12:00:00'))
        : undefined;

      const updatedData: Partial<User> = {
          ...values,
          avatarUrl,
          pdvOperatorIds: Object.fromEntries(
            Object.entries(pdvOperatorIds).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])
          ),
          registrationIdBizneo: values.registrationIdBizneo || undefined,
          registrationIdPdv: values.registrationIdPdv || undefined,
          admissionDate,
          birthDate,
          shiftDefinitionId: values.shiftDefinitionId || undefined,
          needsTransportVoucher: values.needsTransportVoucher,
          transportVoucherValue: values.needsTransportVoucher ? values.transportVoucherValue : undefined,
      };
      delete (updatedData as any).password;
      await updateUser({ ...editingUser, ...updatedData });
    } else {
        if (!values.password) {
             form.setError("password", { type: "manual", message: "A senha é obrigatória para novos usuários." });
             return;
        }
      const uid = await addUser({
          username: values.username,
          profileId: values.profileId,
          assignedKioskIds: values.assignedKioskIds,
          avatarUrl: avatarUrl,
          color: pickUserColor(users.map(u => u.color)),
          operacional: values.operacional,
          participatesInGoals: values.participatesInGoals,
          pdvOperatorIds: Object.fromEntries(
            Object.entries(pdvOperatorIds).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])
          ),
      }, values.email, values.password);

      if (!uid) {
        toast({ title: 'Erro ao criar usuário.', description: 'Verifique o console para detalhes.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Usuário criado com sucesso.' });
    }
    setShowForm(false);
    setEditingUser(null);
  };
  
  const handlePhotoUpdate = async (dataUrl: string) => {
    setIsUploadingPhoto(true);
    const targetUserId = editingUser?.id || `new-user-${Date.now()}`;
    try {
      const storageRef = ref(storage, `avatars/${targetUserId}`);
      await uploadString(storageRef, dataUrl, 'data_url');
      const downloadURL = await getDownloadURL(storageRef);
      form.setValue('avatarUrl', downloadURL, { shouldDirty: true });
      // Auto-save avatarUrl immediately so the photo persists
      // even if the user closes the form without clicking "Salvar alterações"
      if (editingUser) {
        await updateUser({ ...editingUser, avatarUrl: downloadURL });
      }
      toast({ title: "Foto atualizada!" });
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
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Selecione uma imagem menor que 5MB.' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = reader.result as string;
        await handlePhotoUpdate(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };


  const canManageAnyUsers = permissions.settings.manageUsers;


  if (!canManageAnyUsers) {
    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle>Acesso negado</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Você não tem permissão para gerenciar usuários.</p>
            </CardContent>
        </Card>
    );
  }
  
  const getProfileName = (profileId: string) => profiles.find(p => p.id === profileId)?.name || 'N/A';
  const getKioskNames = (kioskIds: string[]) => {
    if (!kioskIds || kioskIds.length === 0) return 'N/A';
    return kioskIds.map(id => kiosks.find(k => k.id === id)?.name || id).join(', ');
  }

  return (
    <>
      {showForm ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-2xl">
            {/* ── Back nav ── */}
            <div className="flex items-center gap-3 mb-2">
              <Button
                type="button" variant="ghost" size="icon"
                className="shrink-0 h-8 w-8 rounded-full"
                onClick={() => { setShowForm(false); setEditingUser(null); }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <p className="font-semibold leading-tight">
                  {editingUser ? editingUser.username : 'Novo usuário'}
                </p>
                <p className="text-xs text-muted-foreground">Configurações › Usuários</p>
              </div>
            </div>

            {/* ── Cartão 1: Identidade ── */}
            <Card style={{ padding: '1.25rem 1.5rem' }}>
              <div className="flex gap-5 items-start">
                {/* Avatar + botões */}
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <Avatar className="h-20 w-20">
                    {isUploadingPhoto ? (
                      <AvatarFallback><Loader2 className="h-5 w-5 animate-spin" /></AvatarFallback>
                    ) : (
                      <>
                        <AvatarImage src={form.watch('avatarUrl') || undefined} />
                        <AvatarFallback
                          className="text-2xl font-bold text-white"
                          style={{
                            backgroundColor: editingUser
                              ? getUserColor(editingUser.id, editingUser.color)
                              : pickUserColor(users.map(u => u.color)),
                          }}
                        >
                          {form.watch('username')?.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '?'}
                        </AvatarFallback>
                      </>
                    )}
                  </Avatar>
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setIsPhotoModalOpen(true)} disabled={isUploadingPhoto}>
                      <Camera className="h-3 w-3 mr-1" /> Tirar foto
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => fileInputRef.current?.click()} disabled={isUploadingPhoto}>
                      <Upload className="h-3 w-3 mr-1" /> Carregar
                    </Button>
                  </div>
                  <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                </div>

                {/* Nome, e-mail, badges */}
                <div className="flex-1 space-y-3 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="h-3 w-3 rounded-full ring-1 ring-border shrink-0"
                        style={{
                          backgroundColor: editingUser
                            ? getUserColor(editingUser.id, editingUser.color)
                            : pickUserColor(users.map(u => u.color)),
                        }}
                      />
                      <span className="text-[11px] text-muted-foreground">Cor na escala</span>
                    </div>
                    {editingUser && (
                      <Badge variant={editingUser.isActive !== false ? 'default' : 'secondary'} className="text-[10px]">
                        {editingUser.isActive !== false ? 'Ativo' : 'Inativo'}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField control={form.control} name="username" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome</FormLabel>
                        <FormControl><Input placeholder="ex: Maria Silva" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>E-mail</FormLabel>
                        <FormControl><Input type="email" placeholder="email@dominio.com" {...field} disabled={!!editingUser} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    {!editingUser && (
                      <div className="col-span-full">
                        <FormField control={form.control} name="password" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Senha</FormLabel>
                            <div className="relative">
                              <FormControl>
                                <Input type={showPassword ? 'text' : 'password'} placeholder="Mínimo 6 caracteres" {...field} />
                              </FormControl>
                              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground">
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* ── Cartão 2: Comportamento no sistema ── */}
            <Card style={{ padding: '1.25rem 1.5rem' }}>
              <p className="text-sm font-semibold mb-3">Comportamento no sistema</p>
              <div className="space-y-2">
                <FormField control={form.control} name="operacional" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="font-medium">Usuário operacional</FormLabel>
                      <FormDescription className="text-xs">Aparece nas escalas de trabalho e relatórios operacionais.</FormDescription>
                    </div>
                    <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="participatesInGoals" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="font-medium">Participa de metas</FormLabel>
                      <FormDescription className="text-xs">Incluído no acompanhamento de metas do quiosque.</FormDescription>
                    </div>
                    <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="needsTransportVoucher" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="font-medium">Vale-transporte</FormLabel>
                      <FormDescription className="text-xs">Colaborador tem direito a vale-transporte mensal.</FormDescription>
                    </div>
                    <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <div
                  className="overflow-hidden transition-all duration-200"
                  style={{ maxHeight: form.watch('needsTransportVoucher') ? '80px' : '0', opacity: form.watch('needsTransportVoucher') ? 1 : 0 }}
                >
                  <div className="pt-2">
                    <FormField control={form.control} name="transportVoucherValue" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor mensal (R$)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" placeholder="0,00" {...field} value={field.value ?? ''} className="max-w-[180px]" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </div>
            </Card>

            {/* ── Cartão 3: Permissões e alocação ── */}
            <Card style={{ padding: '1.25rem 1.5rem' }}>
              <p className="text-sm font-semibold mb-3">Permissões e alocação</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={form.control} name="profileId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Perfil de permissão</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={profilesLoading}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um perfil" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {profiles.map(p => (
                          <SelectItem key={p.id} value={p.id} disabled={p.isDefaultAdmin && currentUser?.profileId !== adminProfileId}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <Controller control={form.control} name="assignedKioskIds" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quiosques</FormLabel>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className="w-full justify-between font-normal">
                            {(field.value?.length || 0) > 0 ? `${field.value.length} quiosque(s)` : 'Selecione quiosques'}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                        <DropdownMenuLabel>Quiosques disponíveis</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <ScrollArea className="h-48">
                          {kiosks.map(kiosk => (
                            <DropdownMenuCheckboxItem
                              key={kiosk.id}
                              checked={field.value?.includes(kiosk.id)}
                              onCheckedChange={checked => {
                                const selected = field.value || [];
                                field.onChange(checked ? [...selected, kiosk.id] : selected.filter(id => id !== kiosk.id));
                              }}
                              onSelect={e => e.preventDefault()}
                            >
                              {kiosk.name}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </ScrollArea>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              {/* PDV operator IDs — somente leitura */}
              {form.watch('assignedKioskIds')?.length > 0 && Object.keys(pdvOperatorIds).some(k => pdvOperatorIds[k]) && (
                <div className="mt-4 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">IDs no PDV</p>
                  <div className="flex flex-wrap gap-1.5">
                    {form.watch('assignedKioskIds').map(kioskId => {
                      const id = pdvOperatorIds[kioskId];
                      if (!id) return null;
                      const name = kiosks.find(k => k.id === kioskId)?.name ?? kioskId;
                      return (
                        <span key={kioskId} className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground rounded-md px-2 py-1">
                          <span className="font-medium">{name}</span>
                          <span className="text-muted-foreground/60">·</span>
                          {id}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* ── Cartão 4: Departamento Pessoal (edição + permissão dp) ── */}
            {editingUser && permissions.dp?.view && (
              <Card style={{ padding: '1.25rem 1.5rem' }}>
                <p className="text-sm font-semibold mb-3">Departamento Pessoal</p>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="registrationIdBizneo" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Matrícula Bizneo</FormLabel>
                        <FormControl><Input placeholder="Ex: 18043422" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="shiftDefinitionId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Turno padrão</FormLabel>
                        <Select value={field.value || '__none__'} onValueChange={v => field.onChange(v === '__none__' ? '' : v)}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">— Nenhum —</SelectItem>
                            {shiftDefinitions.map(def => (
                              <SelectItem key={def.id} value={def.id}>{def.name} ({def.startTime}–{def.endTime})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="admissionDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data de admissão</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="birthDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data de nascimento</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
              </Card>
            )}

            {/* ── Footer ── */}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingUser(null); }}>Cancelar</Button>
              <Button type="submit" disabled={isUploadingPhoto || (!!editingUser && !form.formState.isDirty)}>
                {editingUser ? 'Salvar alterações' : 'Criar usuário'}
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <div className="space-y-5">
          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={handleAddNew} disabled={!permissions.settings.manageUsers}>
              <PlusCircle className="mr-2 h-4 w-4" /> Adicionar usuário
            </Button>
            <Button variant="outline" onClick={() => setIsProfilesModalOpen(true)} disabled={!permissions.settings.manageProfiles}>
              <Shield className="mr-2 h-4 w-4" /> Gerenciar perfis
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row items-center gap-2 p-3 border rounded-lg bg-muted/50">
            <div className="relative flex-grow w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 w-full"
              />
            </div>
            <Select value={profileFilter} onValueChange={setProfileFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Perfil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Perfis</SelectItem>
                {profiles.map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kioskFilter} onValueChange={setKioskFilter}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Quiosque" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Quiosques</SelectItem>
                {kiosks.map(kiosk => (
                  <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={() => { setSearchTerm(''); setProfileFilter('all'); setKioskFilter('all'); }}>
              <Eraser className="mr-2 h-4 w-4" /> Limpar
            </Button>
          </div>

          {/* Grouped user list */}
          {groupedUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum usuário encontrado.</p>
          ) : (
            <div className="space-y-6">
              {groupedUsers.map(group => (
                <div key={group.profileId} className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    {group.profileName}
                    <span className="ml-2 font-normal normal-case">({group.users.length})</span>
                  </h3>
                  <div className="space-y-1.5">
                    {group.users.map(user => (
                      <div key={user.id} className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/40">
                        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                          <AvatarImage src={user.avatarUrl} />
                          <AvatarFallback className="text-xs text-white" style={{ backgroundColor: getUserColor(user.id, user.color) }}>
                            {user.username.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{user.username}</p>
                          {user.assignedKioskIds?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {user.assignedKioskIds.map(id => {
                                const name = kiosks.find(k => k.id === id)?.name ?? id;
                                return (
                                  <span key={id} className="text-[11px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 leading-none">
                                    {name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {permissions.settings.manageUsers && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(user)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {permissions.settings.manageUsers && (
                            <DeleteConfirmationDialog
                              open={false}
                              onOpenChange={() => {}}
                              onConfirm={() => setUserToResetPassword(user)}
                              title={`Redefinir senha de ${user.username}?`}
                              description={`Um e-mail será enviado para ${user.email} com instruções para redefinir a senha.`}
                              confirmButtonText="Sim, enviar e-mail"
                              confirmButtonVariant="default"
                              triggerButton={<Button variant="ghost" size="icon" className="h-8 w-8"><KeyRound className="h-3.5 w-3.5" /></Button>}
                            />
                          )}
                          {permissions.settings.manageUsers && (
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteClick(user)}
                              disabled={user.id === currentUser?.id || profileIsAdmin(user.profileId)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      <ProfileManagementModal 
        open={isProfilesModalOpen}
        onOpenChange={setIsProfilesModalOpen}
        canEdit={!!permissions.settings.manageProfiles}
      />

      <PhotoCaptureModal 
        open={isPhotoModalOpen}
        onOpenChange={setIsPhotoModalOpen}
        onPhotoCaptured={handlePhotoCaptured}
      />

      {userToDelete && (
        <DeleteConfirmationDialog
          open={!!userToDelete}
          isDeleting={false}
          onOpenChange={() => setUserToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o usuário "${userToDelete.username}"`}
        />
      )}
      
      {userToResetPassword && (
         <DeleteConfirmationDialog
            open={!!userToResetPassword}
            isDeleting={false}
            onOpenChange={() => setUserToResetPassword(null)}
            onConfirm={handleResetPasswordConfirm}
            title={`Enviar link de redefinição?`}
            description={`Um e-mail será enviado para ${userToResetPassword.email}.`}
            confirmButtonText="Sim, enviar"
          />
      )}
    </>
  );
}
