"use client"

import { useState, useEffect } from 'react';
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
import { PlusCircle, Edit, Trash2, Users, Shield, Warehouse, ChevronsUpDown, Check } from 'lucide-react';
import { type User } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LocationManagementModal } from './location-management-modal';
import { ProfileManagementModal } from './profile-management-modal';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Switch } from './ui/switch';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';

const userSchema = z.object({
  username: z.string().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  password: z.string().optional(),
  profileId: z.string({ required_error: 'É obrigatório selecionar um perfil.' }).min(1, 'O perfil é obrigatório.'),
  assignedKioskIds: z.array(z.string()).min(1, 'Selecione ao menos um quiosque.'),
  turno: z.enum(['T1', 'T2']).nullable(),
  folguista: z.boolean(),
  operacional: z.boolean(),
}).refine(data => {
    return !data.password || data.password.length >= 4;
}, {
    message: "A senha deve ter pelo menos 4 caracteres.",
    path: ["password"],
});

type UserFormValues = z.infer<typeof userSchema>;

export function UserManagement() {
  const { users, addUser, updateUser, deleteUser, permissions, user: currentUser } = useAuth();
  const { kiosks, addKiosk, deleteKiosk, loading: kiosksLoading } = useKiosks();
  const { profiles, adminProfileId, loading: profilesLoading } = useProfiles();
  
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isKiosksModalOpen, setIsKiosksModalOpen] = useState(false);
  const [isProfilesModalOpen, setIsProfilesModalOpen] = useState(false);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
        username: '',
        password: '',
        profileId: '',
        assignedKioskIds: [],
        turno: null,
        folguista: false,
        operacional: true,
    }
  });
  
  const isFolguista = form.watch('folguista');

  useEffect(() => {
    if (isFolguista) {
        form.setValue('turno', null);
    }
  }, [isFolguista, form]);


  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      password: '',
      profileId: '',
      assignedKioskIds: [],
      turno: null,
      folguista: false,
      operacional: true,
    });
    setShowForm(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: '',
      profileId: user.profileId,
      assignedKioskIds: user.assignedKioskIds || [],
      turno: user.turno,
      folguista: user.folguista,
      operacional: user.operacional,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (user: User) => {
    if (user.id === currentUser?.id || user.username === 'Tiago Brasil') return;
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
          ...values
      };
      if (!values.password || values.password.trim() === '') {
        delete updatedData.password;
      }
      updateUser({ ...editingUser, ...updatedData });
    } else {
        if (!values.password) {
             form.setError("password", { type: "manual", message: "A senha é obrigatória para novos usuários." });
             return;
        }
      addUser(values as Omit<User, 'id'>);
    }
    setShowForm(false);
    setEditingUser(null);
  };

  const canManageAnyUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;
  const canManageKiosks = permissions.kiosks.add || permissions.kiosks.delete;

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
      <Card className="w-full max-w-4xl mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
            <Users /> Gerenciar usuários
          </CardTitle>
          <CardDescription className="text-center">Adicione ou edite usuários e atribua perfis e escalas.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <h3 className="text-lg font-medium">{editingUser ? `Editando ${editingUser.username}` : 'Adicionar novo usuário'}</h3>
                <div className="space-y-4 p-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="username" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nome de usuário</FormLabel>
                          <FormControl><Input placeholder="ex: joao.silva" {...field} disabled={editingUser?.username === 'Tiago Brasil'} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField control={form.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha</FormLabel>
                          <FormControl><Input type="password" placeholder={editingUser ? 'Deixe em branco para não alterar' : 'Senha forte'} {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <Separator />
                  <h4 className="font-medium text-muted-foreground">Permissões e Alocação</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="profileId" render={({ field }) => (
                        <FormItem>
                        <FormLabel>Perfil de permissão</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={editingUser?.username === 'Tiago Brasil' || profilesLoading}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione um perfil"/></SelectTrigger></FormControl>
                            <SelectContent>
                                {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
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
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button variant="outline" role="combobox" className={cn("w-full justify-between", field.value?.length === 0 && "text-muted-foreground")}>
                                                {field.value?.length > 0 ? `${field.value.length} quiosque(s) selecionado(s)` : "Selecione quiosques"}
                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                        <Command>
                                            <CommandInput placeholder="Buscar quiosque..." />
                                            <CommandList>
                                                <CommandEmpty>Nenhum quiosque encontrado.</CommandEmpty>
                                                <CommandGroup>
                                                    <ScrollArea className="h-48">
                                                    {kiosks.map((kiosk) => (
                                                        <CommandItem key={kiosk.id} onSelect={() => {
                                                            const selected = field.value || [];
                                                            const isSelected = selected.includes(kiosk.id);
                                                            field.onChange(isSelected ? selected.filter(id => id !== kiosk.id) : [...selected, kiosk.id]);
                                                        }}>
                                                             <Check className={cn("mr-2 h-4 w-4", (field.value || []).includes(kiosk.id) ? "opacity-100" : "opacity-0")} />
                                                            {kiosk.name}
                                                        </CommandItem>
                                                    ))}
                                                    </ScrollArea>
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                      />
                  </div>

                  <Separator />
                  <h4 className="font-medium text-muted-foreground">Configuração de Escala</h4>

                  <FormField
                    control={form.control}
                    name="operacional"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                            <FormLabel>Colaborador Operacional</FormLabel>
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
                                <FormLabel>É Folguista?</FormLabel>
                            </div>
                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                    )}/>
                    
                  <FormField control={form.control} name="turno" render={({ field }) => (
                      <FormItem>
                          <FormLabel>Turno Padrão</FormLabel>
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
                <Button onClick={handleAddNew} className="flex-grow" disabled={!permissions.users.add}>
                  <PlusCircle className="mr-2" /> Adicionar usuário
                </Button>
                 <Button variant="outline" onClick={() => setIsProfilesModalOpen(true)} className="flex-grow" disabled={!permissions.users.edit}>
                    <Shield className="mr-2" /> Gerenciar perfis
                </Button>
                 <Button variant="outline" onClick={() => setIsKiosksModalOpen(true)} className="flex-grow" disabled={!canManageKiosks}>
                    <Warehouse className="mr-2" /> Gerenciar quiosques
                </Button>
              </div>
              <Separator className="my-4" />
              <div className="space-y-2">
                <div className="hidden rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground md:grid md:grid-cols-4">
                  <div>Usuário</div>
                  <div>Perfil</div>
                  <div>Quiosque(s)</div>
                  <div className="text-right">Ações</div>
                </div>
                {users.map(user => (
                  <div key={user.id} className="grid grid-cols-2 items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50 md:grid-cols-4">
                    <div className="font-medium">
                      <span className="md:hidden text-muted-foreground">Usuário: </span>
                      {user.username}
                    </div>
                    <div>
                      <span className="md:hidden text-muted-foreground">Perfil: </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${user.profileId === adminProfileId ? 'bg-primary/20 text-primary' : 'bg-secondary text-secondary-foreground'}`}>
                        {getProfileName(user.profileId)}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-sm truncate">
                      <span className="md:hidden font-medium text-card-foreground">Quiosque(s): </span>
                      {getKioskNames(user.assignedKioskIds)}
                    </div>
                    <div className="col-span-2 flex justify-end gap-2 md:col-span-1">
                        {permissions.users.edit && <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}><Edit className="h-4 w-4" /></Button>}
                        {permissions.users.delete && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(user)} disabled={user.username === 'Tiago Brasil' || user.id === currentUser?.id}><Trash2 className="h-4 w-4" /></Button>}
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
        canEdit={!!permissions.users?.edit}
      />

      <LocationManagementModal
        open={isKiosksModalOpen}
        onOpenChange={setIsKiosksModalOpen}
        kiosks={kiosks}
        addKiosk={addKiosk}
        deleteKiosk={deleteKiosk}
        permissions={permissions.kiosks}
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
