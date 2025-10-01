

"use client"

import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2, Users, Shield, Warehouse, ChevronsUpDown, Check, DollarSign, Search, Eraser, Eye, EyeOff, Camera, Upload } from 'lucide-react';
import { type User } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LocationManagementModal } from './location-management-modal';
import { ProfileManagementModal } from './profile-management-modal';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { PhotoCaptureModal } from './photo-capture-modal';
import { useToast } from '@/hooks/use-toast';
import { resizeImage } from '@/lib/image-utils';
import { Label } from '@/components/ui/label';

const userSchema = z.object({
  username: z.string().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  email: z.string().email("O e-mail é inválido."),
  password: z.string().optional(),
  profileId: z.string({ required_error: 'É obrigatório selecionar um perfil.' }).min(1, 'O perfil é obrigatório.'),
  assignedKioskIds: z.array(z.string()).min(1, 'Selecione pelo menos um quiosque.'),
  turno: z.enum(['T1', 'T2']).nullable(),
  folguista: z.boolean(),
  operacional: z.boolean(),
  valeTransporte: z.coerce.number().optional(),
  color: z.string().nullable().optional(),
  avatarUrl: z.string().optional(),
}).refine(data => {
    return !data.password || data.password.length >= 6;
}, {
    message: "A senha deve ter pelo menos 6 caracteres.",
    path: ["password"],
});

type UserFormValues = z.infer<typeof userSchema>;

const userColors = ['#FDFFB6', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#FFC6FF', '#FFADAD', '#FFD6A5'];

export function UserManagement() {
  const { permissions, users, addUser, deleteUser, user: currentUser, updateUser } = useAuth();
  const { kiosks, updateKiosk, deleteKiosk: deleteKioskFromProvider, loading: kiosksLoading } = useKiosks();
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();
  const { toast } = useToast();
  
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isKiosksModalOpen, setIsKiosksModalOpen] = useState(false);
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileFilter, setProfileFilter] = useState('all');
  const [kioskFilter, setKioskFilter] = useState('all');
  const [showPassword, setShowPassword] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
        username: '',
        email: '',
        password: '',
        profileId: '',
        assignedKioskIds: [],
        turno: null,
        folguista: false,
        operacional: true,
        valeTransporte: 0,
        color: null,
        avatarUrl: '',
    }
  });
  
  const isFolguista = form.watch('folguista');

  useEffect(() => {
    if (isFolguista) {
        form.setValue('turno', null);
    }
  }, [isFolguista, form]);
  
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const searchMatch = user.username.toLowerCase().includes(searchTerm.toLowerCase());
      const profileMatch = profileFilter === 'all' || user.profileId === profileFilter;
      const kioskMatch = kioskFilter === 'all' || user.assignedKioskIds.includes(kioskFilter);
      return searchMatch && profileMatch && kioskMatch;
    });
  }, [users, searchTerm, profileFilter, kioskFilter]);


  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      email: '',
      password: '',
      profileId: '',
      assignedKioskIds: [],
      turno: null,
      folguista: false,
      operacional: true,
      valeTransporte: 0,
      color: null,
      avatarUrl: '',
    });
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
      turno: user.turno,
      folguista: user.folguista,
      operacional: user.operacional,
      valeTransporte: user.valeTransporte || 0,
      color: user.color || null,
      avatarUrl: user.avatarUrl || '',
    });
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

  const onSubmit = (values: UserFormValues) => {
    if (editingUser) {
      const updatedData: Partial<User> = {
          ...values,
          valeTransporte: values.valeTransporte || 0,
      };
      delete (updatedData as any).password; 
      updateUser({ ...editingUser, ...updatedData });
    } else {
        if (!values.password) {
             form.setError("password", { type: "manual", message: "A senha é obrigatória para novos usuários." });
             return;
        }
      addUser({ 
          username: values.username, 
          profileId: values.profileId,
          assignedKioskIds: values.assignedKioskIds,
          turno: values.turno,
          folguista: values.folguista,
          operacional: values.operacional,
          valeTransporte: values.valeTransporte || 0,
          color: values.color,
          avatarUrl: values.avatarUrl,
      }, values.email, values.password);
    }
    setShowForm(false);
    setEditingUser(null);
  };
  
  const handlePhotoUpdate = async (dataUrl: string) => {
    form.setValue('avatarUrl', dataUrl, { shouldDirty: true });
    toast({ title: "Foto de perfil atualizada!" });
  };
  
  const handlePhotoCaptured = async (dataUrl: string) => {
      try {
          const resized = await resizeImage(dataUrl, 512, 512);
          handlePhotoUpdate(resized);
      } catch (e) {
          toast({ variant: 'destructive', title: 'Erro ao processar imagem' });
      }
      setIsPhotoModalOpen(false);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        toast({ variant: 'destructive', title: 'Arquivo muito grande' });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
            const resizedDataUrl = await resizeImage(reader.result as string, 512, 512);
            handlePhotoUpdate(resizedDataUrl);
        } catch (error) {
            toast({ variant: 'destructive', title: 'Erro ao processar imagem' });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCurrencyChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
    const value = e.target.value;
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly === '') {
        field.onChange(undefined);
        return;
    }

    const numericValue = parseInt(digitsOnly, 10) / 100;
    field.onChange(numericValue);
  };

  const formatCurrencyForDisplay = (value: number | undefined) => {
      if (value === undefined || value === null) return '';
      return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };


  const canManageAnyUsers = permissions.settings.manageUsers;
  const canManageKiosks = permissions.settings.manageKiosks;

  
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
      <Card>
        <CardHeader>
          <CardTitle>
            Usuários e perfis
          </CardTitle>
          <CardDescription>Adicione ou edite usuários e atribua perfis e escalas.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <Button variant="outline" onClick={() => setShowForm(false)}>
                    Voltar para Configurações
                </Button>
                <h3 className="text-lg font-medium">{editingUser ? `Editando ${editingUser.username}` : 'Adicionar novo usuário'}</h3>
                <div className="space-y-4 p-1">
                 <div className="flex flex-col md:flex-row gap-6 items-start">
                    <div className="space-y-2">
                        <Label>Foto do perfil</Label>
                        <Avatar className="h-24 w-24">
                           <AvatarImage src={form.watch('avatarUrl') || undefined} />
                           <AvatarFallback className="text-3xl bg-primary text-primary-foreground">
                             {form.watch('username')?.charAt(0).toUpperCase() || '?'}
                           </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col gap-1.5">
                            <Button type="button" size="sm" variant="outline" onClick={() => setIsPhotoModalOpen(true)}><Camera className="mr-2 h-4 w-4"/> Tirar foto</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4"/> Carregar</Button>
                        </div>
                        <Input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow">
                        <FormField control={form.control} name="username" render={({ field }) => (
                            <FormItem>
                            <FormLabel>Nome de usuário</FormLabel>
                            <FormControl><Input placeholder="ex: joao.silva" {...field} /></FormControl>
                            <FormMessage />
                            </FormItem>
                        )}
                        />
                        <FormField control={form.control} name="email" render={({ field }) => (
                            <FormItem>
                            <FormLabel>E-mail</FormLabel>
                            <FormControl><Input type="email" placeholder="email@dominio.com" {...field} disabled={!!editingUser} /></FormControl>
                            <FormMessage />
                            </FormItem>
                        )}
                        />
                         {!editingUser &&
                            <div className="col-span-full">
                               <FormField
                                    control={form.control}
                                    name="password"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Senha</FormLabel>
                                            <div className="relative">
                                                <FormControl>
                                                    <Input
                                                        type={showPassword ? 'text' : 'password'}
                                                        placeholder="Senha com no mínimo 6 caracteres"
                                                        {...field}
                                                    />
                                                </FormControl>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                                                >
                                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                                </button>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                           </div>
                        }
                    </div>
                </div>

                  <Separator />
                  <h4 className="font-medium text-muted-foreground">Permissões e alocação</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="profileId" render={({ field }) => (
                        <FormItem>
                        <FormLabel>Perfil de permissão</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={profilesLoading}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione um perfil"/></SelectTrigger></FormControl>
                            <SelectContent>
                                {profiles.map(p => <SelectItem key={p.id} value={p.id} disabled={p.isDefaultAdmin && currentUser?.profileId !== adminProfileId}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                    <Controller
                        control={form.control}
                        name="assignedKioskIds"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Quiosques</FormLabel>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <FormControl>
                                            <Button variant="outline" className="w-full justify-between font-normal">
                                                {field.value?.length > 0 ? `${field.value.length} quiosque(s) selecionado(s)` : "Selecione quiosques"}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                                        <DropdownMenuLabel>Quiosques disponíveis</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        <ScrollArea className="h-48">
                                            {kiosks.map((kiosk) => (
                                                <DropdownMenuCheckboxItem
                                                    key={kiosk.id}
                                                    checked={field.value?.includes(kiosk.id)}
                                                    onCheckedChange={(checked) => {
                                                        const selected = field.value || [];
                                                        return checked
                                                            ? field.onChange([...selected, kiosk.id])
                                                            : field.onChange(selected.filter((id) => id !== kiosk.id));
                                                    }}
                                                    onSelect={(e) => e.preventDefault()}
                                                >
                                                    {kiosk.name}
                                                </DropdownMenuCheckboxItem>
                                            ))}
                                        </ScrollArea>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                  </div>

                  <Separator />
                  <h4 className="font-medium text-muted-foreground">Configuração de escala</h4>

                  <FormField
                    control={form.control}
                    name="operacional"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                            <FormLabel>Colaborador operacional</FormLabel>
                            <FormDescription>
                                Ative se este colaborador deve ser incluído na geração da escala de trabalho.
                            </FormDescription>
                        </div>
                        <FormControl>
                            <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            />
                        </FormControl>
                        </FormItem>
                    )}
                    />
                  
                   <FormField control={form.control} name="folguista" render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                            <div className="space-y-0.5">
                                <FormLabel>É folguista?</FormLabel>
                            </div>
                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                    )}/>
                    
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="turno" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Turno padrão</FormLabel>
                            <Select onValueChange={(val) => field.onChange(val === 'null' ? null : val)} value={field.value || 'null'} disabled={isFolguista}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Selecione um turno..." /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="T1">T1</SelectItem>
                                    <SelectItem value="T2">T2</SelectItem>
                                    <SelectItem value="null">Nenhum (para folguistas)</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}/>
                     <FormField control={form.control} name="valeTransporte" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Valor diário do VT</FormLabel>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                                <FormControl>
                                <Input
                                    type="text"
                                    placeholder="0,00"
                                    className="pl-9"
                                    value={formatCurrencyForDisplay(field.value)}
                                    onChange={e => handleCurrencyChange(e, field)}
                                />
                                </FormControl>
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}/>
                  </div>
                   <FormField
                    control={form.control}
                    name="color"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Cor do destaque</FormLabel>
                        <FormControl>
                            <div className="flex flex-wrap gap-2 pt-2">
                            {userColors.map((color) => (
                                <button
                                key={color}
                                type="button"
                                className={cn(
                                    "h-8 w-8 rounded-full border-2 transition-all",
                                    field.value === color ? 'border-primary ring-2 ring-ring' : 'border-transparent'
                                )}
                                style={{ backgroundColor: color }}
                                onClick={() => field.onChange(color)}
                                />
                            ))}
                            <button
                                type="button"
                                className={cn(
                                    "h-8 w-8 rounded-full border-2 flex items-center justify-center bg-muted transition-all",
                                    !field.value ? 'border-primary ring-2 ring-ring' : 'border-transparent'
                                )}
                                onClick={() => field.onChange(null)}
                            >
                                <Eraser className="h-4 w-4 text-muted-foreground" />
                            </button>
                            </div>
                        </FormControl>
                        <FormDescription>
                            Selecione uma cor para destacar o colaborador na escala.
                        </FormDescription>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingUser ? 'Salvar alterações' : 'Criar usuário'}</Button>
                </div>
              </form>
            </Form>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleAddNew} className="flex-grow" disabled={!permissions.settings.manageUsers}>
                  <PlusCircle className="mr-2" /> Adicionar usuário
                </Button>
                 <Button variant="outline" onClick={() => setIsProfilesModalOpen(true)} className="flex-grow" disabled={!permissions.settings.manageProfiles}>
                    <Shield className="mr-2" /> Gerenciar perfis
                </Button>
                 <Button variant="outline" onClick={() => setIsKiosksModalOpen(true)} className="flex-grow" disabled={!canManageKiosks}>
                    <Warehouse className="mr-2" /> Gerenciar quiosques
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2 mt-4 p-3 border rounded-lg bg-muted/50">
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
                  <Button variant="ghost" onClick={() => {
                      setSearchTerm('');
                      setProfileFilter('all');
                      setKioskFilter('all');
                  }}>
                      <Eraser className="mr-2 h-4 w-4" />
                      Limpar
                  </Button>
              </div>
              
              <Separator className="my-4" />
              <div className="space-y-2">
                <div className="hidden rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground md:grid md:grid-cols-5">
                  <div>Usuário</div>
                  <div>Perfil</div>
                  <div>Quiosque(s)</div>
                  <div>VT diário</div>
                  <div className="text-right">Ações</div>
                </div>
                {filteredUsers.map(user => (
                  <div key={user.id} className="grid grid-cols-2 items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 md:grid-cols-5">
                    <div className="font-medium flex items-center gap-2">
                      {user.color && <div className="h-3 w-3 rounded-full" style={{ backgroundColor: user.color }}></div>}
                      <span className="md:hidden text-muted-foreground">Usuário: </span>
                      {user.username}
                    </div>
                    <div>
                      <span className="md:hidden text-muted-foreground">Perfil: </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${profileIsAdmin(user.profileId) ? 'bg-primary/20 text-primary' : 'bg-secondary text-secondary-foreground'}`}>
                        {getProfileName(user.profileId)}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-sm truncate">
                      <span className="md:hidden font-medium text-card-foreground">Quiosque(s): </span>
                      {getKioskNames(user.assignedKioskIds)}
                    </div>
                     <div>
                      <span className="md:hidden text-muted-foreground">VT diário: </span>
                      {user.valeTransporte ? user.valeTransporte.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}
                    </div>
                    <div className="col-span-2 flex justify-end gap-2 md:col-span-1">
                        {permissions.settings.manageUsers && <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}><Edit className="h-4 w-4" /></Button>}
                        {permissions.settings.manageUsers && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(user)} disabled={user.id === currentUser?.id || profileIsAdmin(user.profileId)}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      
      <ProfileManagementModal 
        open={isProfilesModalOpen}
        onOpenChange={setIsProfilesModalOpen}
        canEdit={!!permissions.settings.manageProfiles}
      />

      <LocationManagementModal
        open={isKiosksModalOpen}
        onOpenChange={setIsKiosksModalOpen}
        kiosks={kiosks}
        updateKiosk={updateKiosk}
        deleteKiosk={deleteKioskFromProvider}
        permissions={{add: !!canManageKiosks, delete: !!canManageKiosks}}
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
    </>
  );
}
