
"use client"

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useProfiles } from '@/hooks/use-profiles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2, Users, Shield, Warehouse } from 'lucide-react';
import { type User } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LocationManagementModal } from './location-management-modal';
import { ProfileManagementModal } from './profile-management-modal';

const userSchema = z.object({
  username: z.string().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  password: z.string().optional(),
  profileId: z.string({ required_error: 'É obrigatório selecionar um perfil.' }).min(1, 'O perfil é obrigatório.'),
  kioskId: z.string({ required_error: 'É obrigatório vincular o usuário a um quiosque.' }).min(1, 'O quiosque é obrigatório.'),
}).refine(data => {
    // If a password is provided, it must be at least 4 chars
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
  });

  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      password: '',
      profileId: '',
      kioskId: '',
    });
    setShowForm(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: '',
      profileId: user.profileId,
      kioskId: user.kioskId,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (user: User) => {
    if (user.id === currentUser?.id || user.username === 'master') return;
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
          username: values.username, // Username should be editable now
          profileId: values.profileId,
          kioskId: values.kioskId,
      };
      if (values.password && values.password.trim() !== '') {
        updatedData.password = values.password;
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
  
  const getProfileName = (profileId: string) => {
    return profiles.find(p => p.id === profileId)?.name || 'N/A';
  }

  return (
    <>
      <Card className="w-full max-w-4xl mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
            <Users /> Gerenciar usuários
          </CardTitle>
          <CardDescription className="text-center">Adicione ou edite usuários e atribua perfis de permissão.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <h3 className="text-lg font-medium">{editingUser ? `Editando ${editingUser.username}` : 'Adicionar novo usuário'}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-1">
                  <FormField control={form.control} name="username" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome de usuário</FormLabel>
                        <FormControl><Input placeholder="ex: joao.silva" {...field} disabled={editingUser?.username === 'master'} /></FormControl>
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
                    <FormField control={form.control} name="profileId" render={({ field }) => (
                        <FormItem>
                        <FormLabel>Perfil de permissão</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value} disabled={editingUser?.username === 'master' || profilesLoading}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione um perfil"/></SelectTrigger></FormControl>
                            <SelectContent>
                                {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                    />
                  <FormField
                      control={form.control}
                      name="kioskId"
                      render={({ field }) => (
                          <FormItem>
                          <FormLabel>Quiosque principal</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value} disabled={kiosksLoading}>
                              <FormControl>
                              <SelectTrigger>
                                  <SelectValue placeholder="Selecione o quiosque" />
                              </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                              {kiosks.map(kiosk => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}
                              </SelectContent>
                          </Select>
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
              <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                  {users.map(user => (
                    <div key={user.id} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <span className="font-medium">{user.username}</span>
                            <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${user.profileId === adminProfileId ? 'bg-primary/20 text-primary' : 'bg-secondary'}`}>{getProfileName(user.profileId)}</span>
                        </div>
                      <div className="flex gap-2">
                        {permissions.users.edit && <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}><Edit className="h-4 w-4" /></Button>}
                        {permissions.users.delete && <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(user)} disabled={user.username === 'master' || user.id === currentUser?.id}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
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
          onOpenChange={() => setUserToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o usuário "${userToDelete.username}"`}
        />
      )}
    </>
  );
}
