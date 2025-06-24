"use client"

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Edit, Trash2, ArrowLeft, Users, ShieldCheck, KeyRound } from 'lucide-react';
import { type User, type UserRole } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

type UserManagementProps = {
  onBack: () => void;
};

const userSchema = z.object({
  username: z.string().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  password: z.string().optional(),
  role: z.enum(['admin', 'user']),
  permissions: z.object({
    canManageProducts: z.boolean(),
    canManageLocations: z.boolean(),
    canManageUsers: z.boolean(),
    canManageKiosks: z.boolean(),
  }),
}).superRefine((data, ctx) => {
  if (!data.password && !data.username) {
    // This is likely an edit, so password is not required
  } else if (!data.password || data.password.length < 4) {
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A senha deve ter pelo menos 4 caracteres.",
        path: ["password"],
    });
  }
});


type UserFormValues = z.infer<typeof userSchema>;

export function UserManagement({ onBack }: UserManagementProps) {
  const { users, addUser, updateUser, deleteUser, permissions } = useAuth();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
  });

  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      password: '',
      role: 'user',
      permissions: { canManageProducts: false, canManageLocations: false, canManageUsers: false, canManageKiosks: false },
    });
    setShowForm(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: '', // Password is not shown, only updated if a new one is typed
      role: user.role,
      permissions: user.permissions,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (user: User) => {
    if (user.id === 'master-user') return;
    setUserToDelete(user);
  };

  const handleDeleteConfirm = () => {
    if (userToDelete) {
      deleteUser(userToDelete.id);
      setUserToDelete(null);
    }
  };

  const onSubmit = (values: UserFormValues) => {
    if (editingUser) {
      const updatedData: User = { ...editingUser, ...values };
      if (!values.password) {
        delete updatedData.password;
      }
      updateUser(updatedData);
    } else {
      addUser(values as Omit<User, 'id' | 'permissions'> & {password: string});
    }
    setShowForm(false);
    setEditingUser(null);
  };

  if (!permissions.canManageUsers) {
    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle>Acesso Negado</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Você não tem permissão para gerenciar usuários.</p>
                <Button onClick={onBack} className="mt-4">Voltar</Button>
            </CardContent>
        </Card>
    );
  }

  return (
    <>
      <Card className="w-full max-w-4xl mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <Button variant="ghost" size="sm" className="absolute top-4 left-4" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Menu
          </Button>
          <CardTitle className="text-center pt-10 font-headline flex items-center justify-center gap-2">
            <Users /> Gerenciar Usuários
          </CardTitle>
          <CardDescription className="text-center">Adicione ou edite usuários e suas permissões de acesso.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-4 rounded-md border p-4">
                  <h3 className="text-lg font-medium flex items-center gap-2"><KeyRound />{editingUser ? 'Editar Credenciais' : 'Novas Credenciais'}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nome de Usuário</FormLabel>
                          <FormControl><Input placeholder="ex: joao.silva" {...field} disabled={!!editingUser} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha</FormLabel>
                          <FormControl><Input type="password" placeholder={editingUser ? 'Deixe em branco para não alterar' : 'Senha forte'} {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                     <FormField
                        control={form.control}
                        name="role"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Perfil</FormLabel>
                            <Select onValueChange={(value) => field.onChange(value as UserRole)} value={field.value}>
                              <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="user">Usuário Padrão</SelectItem>
                                <SelectItem value="admin">Administrador</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                  </div>
                </div>

                <div className="space-y-4 rounded-md border p-4">
                    <h3 className="text-lg font-medium flex items-center gap-2"><ShieldCheck />Permissões</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <FormField
                            control={form.control}
                            name="permissions.canManageProducts"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                    <FormLabel htmlFor="canManageProducts" className="font-normal text-sm">Gerenciar Produtos</FormLabel>
                                    <FormControl>
                                        <Switch id="canManageProducts" checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="permissions.canManageLocations"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                    <FormLabel htmlFor="canManageLocations" className="font-normal text-sm">Gerenciar Locais</FormLabel>
                                    <FormControl>
                                        <Switch id="canManageLocations" checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="permissions.canManageUsers"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                    <FormLabel htmlFor="canManageUsers" className="font-normal text-sm">Gerenciar Usuários</FormLabel>
                                    <FormControl>
                                        <Switch id="canManageUsers" checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="permissions.canManageKiosks"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                    <FormLabel htmlFor="canManageKiosks" className="font-normal text-sm">Gerenciar Quiosques</FormLabel>
                                    <FormControl>
                                        <Switch id="canManageKiosks" checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingUser ? 'Salvar Alterações' : 'Criar Usuário'}</Button>
                </div>
              </form>
            </Form>
          ) : (
            <>
              <Button onClick={handleAddNew} className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Usuário
              </Button>
              <Separator className="my-4" />
              <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                  {users.map(user => (
                    <div key={user.id} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                            <span className="font-medium">{user.username}</span>
                            <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${user.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-secondary'}`}>{user.role}</span>
                        </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(user)} disabled={user.id === 'master-user'}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </CardContent>
      </Card>
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
