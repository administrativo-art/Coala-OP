"use client"

import { useState } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PlusCircle, Edit, Trash2, ArrowLeft, Users, ShieldCheck, KeyRound, Package, Box, Warehouse, UserCog, ClipboardList } from 'lucide-react';
import { type User, type UserRole } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { LocationManagementModal } from './location-management-modal';

type UserManagementProps = {
  onBack: () => void;
};

const userSchema = z.object({
  username: z.string().min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.'),
  password: z.string().optional(),
  role: z.enum(['admin', 'user']),
  kioskId: z.string({ required_error: 'É obrigatório vincular o usuário a um quiosque.' }).min(1, 'O quiosque é obrigatório.'),
  permissions: z.object({
    products: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    lots: z.object({ add: z.boolean(), edit: z.boolean(), move: z.boolean(), delete: z.boolean() }),
    locations: z.object({ add: z.boolean(), delete: z.boolean() }),
    users: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    kiosks: z.object({ add: z.boolean(), delete: z.boolean() }),
    predefinedLists: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
  }),
}).refine(data => {
    // If a password is provided, it must be at least 4 chars
    return !data.password || data.password.length >= 4;
}, {
    message: "A senha deve ter pelo menos 4 caracteres.",
    path: ["password"],
});

type UserFormValues = z.infer<typeof userSchema>;

export function UserManagement({ onBack }: UserManagementProps) {
  const { users, addUser, updateUser, deleteUser, permissions, user: currentUser } = useAuth();
  const { kiosks, addKiosk, deleteKiosk } = useKiosks();
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isKiosksModalOpen, setIsKiosksModalOpen] = useState(false);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
  });

  const handleAddNew = () => {
    setEditingUser(null);
    form.reset({
      username: '',
      password: '',
      role: 'user',
      kioskId: '',
      permissions: { 
        products: { add: false, edit: false, delete: false },
        lots: { add: true, edit: true, move: true, delete: true },
        locations: { add: false, delete: false },
        users: { add: false, edit: false, delete: false },
        kiosks: { add: false, delete: false },
        predefinedLists: { add: false, edit: false, delete: false },
       },
    });
    setShowForm(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.reset({
      username: user.username,
      password: '', // Password is not shown, only updated if a new one is typed
      role: user.role,
      kioskId: user.kioskId,
      permissions: user.permissions,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (user: User) => {
    if (user.id === 'master-user' || user.id === currentUser?.id) return;
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
      const updatedUser: User = { 
          ...editingUser,
          role: values.role,
          kioskId: values.kioskId,
          permissions: values.permissions,
       };
      if (values.password && values.password.trim() !== '') {
        updatedUser.password = values.password;
      }
      updateUser(updatedUser);
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
                <CardTitle>Acesso Negado</CardTitle>
            </CardHeader>
            <CardContent>
                <p>Você não tem permissão para gerenciar usuários.</p>
                <Button onClick={onBack} className="mt-4">Voltar</Button>
            </CardContent>
        </Card>
    );
  }

  const renderPermissionSwitch = (name: FieldPath<UserFormValues>, label: string, description: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <FormLabel className="text-base">{label}</FormLabel>
            <FormDescription>{description}</FormDescription>
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
  
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
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <Accordion type="multiple" defaultValue={['credentials', 'permissions']} className="w-full">
                  <AccordionItem value="credentials">
                    <AccordionTrigger className="text-lg font-semibold"><KeyRound className="mr-2 h-5 w-5" /> Credenciais e Perfil</AccordionTrigger>
                    <AccordionContent className="pt-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-1">
                        <FormField control={form.control} name="username" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Nome de Usuário</FormLabel>
                              <FormControl><Input placeholder="ex: joao.silva" {...field} disabled={!!editingUser} /></FormControl>
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
                         <FormField control={form.control} name="role" render={({ field }) => (
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
                        <FormField
                            control={form.control}
                            name="kioskId"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Quiosque Principal</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
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
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="permissions">
                    <AccordionTrigger className="text-lg font-semibold"><ShieldCheck className="mr-2 h-5 w-5" /> Permissões Detalhadas</AccordionTrigger>
                    <AccordionContent className="space-y-6 pt-4 p-1">
                      <div className="space-y-3">
                        <h4 className="font-medium flex items-center gap-2"><Package /> Produtos</h4>
                        <div className="space-y-2">
                          {renderPermissionSwitch("permissions.products.add", "Adicionar Produtos", "Permite que o usuário cadastre novos produtos no sistema.")}
                          {renderPermissionSwitch("permissions.products.edit", "Editar Produtos", "Permite que o usuário edite informações de produtos existentes.")}
                          {renderPermissionSwitch("permissions.products.delete", "Excluir Produtos", "Permite que o usuário remova produtos do inventário.")}
                        </div>
                      </div>
                      <Separator />
                      <div className="space-y-3">
                        <h4 className="font-medium flex items-center gap-2"><Box /> Lotes de Validade</h4>
                        <div className="space-y-2">
                          {renderPermissionSwitch("permissions.lots.add", "Adicionar Lotes", "Permite adicionar novos lotes ao controle de validade.")}
                          {renderPermissionSwitch("permissions.lots.edit", "Editar Lotes", "Permite editar informações de um lote, como data ou quantidade.")}
                          {renderPermissionSwitch("permissions.lots.move", "Mover Estoque", "Permite mover estoque de um lote entre diferentes locais.")}
                          {renderPermissionSwitch("permissions.lots.delete", "Excluir Lotes", "Permite excluir entradas de lote do controle de validade.")}
                        </div>
                      </div>
                       <Separator />
                      <div className="space-y-3">
                        <h4 className="font-medium flex items-center gap-2"><ClipboardList /> Conversão Predefinida</h4>
                        <div className="space-y-2">
                          {renderPermissionSwitch("permissions.predefinedLists.add", "Criar Listas", "Permite que o usuário crie novas listas de conversão.")}
                          {renderPermissionSwitch("permissions.predefinedLists.edit", "Editar Listas", "Permite que o usuário edite nomes e itens de listas existentes.")}
                          {renderPermissionSwitch("permissions.predefinedLists.delete", "Excluir Listas", "Permite que o usuário remova listas de conversão predefinida.")}
                        </div>
                      </div>
                      <Separator />
                       <div className="space-y-3">
                        <h4 className="font-medium flex items-center gap-2"><Warehouse /> Locais e Quiosques</h4>
                        <div className="space-y-2">
                          {renderPermissionSwitch("permissions.locations.add", "Adicionar Locais", "Permite cadastrar novas lojas ou locais de armazenamento.")}
                          {renderPermissionSwitch("permissions.locations.delete", "Excluir Locais", "Permite excluir locais de armazenamento existentes.")}
                          {renderPermissionSwitch("permissions.kiosks.add", "Adicionar Quiosques", "Permite cadastrar novos quiosques no sistema.")}
                          {renderPermissionSwitch("permissions.kiosks.delete", "Excluir Quiosques", "Permite excluir quiosques existentes.")}
                        </div>
                      </div>
                      <Separator />
                      <div className="space-y-3">
                        <h4 className="font-medium flex items-center gap-2"><UserCog /> Gerenciamento de Usuários</h4>
                        <div className="space-y-2">
                          {renderPermissionSwitch("permissions.users.add", "Adicionar Usuários", "Permite criar novos usuários e definir suas permissões.")}
                          {renderPermissionSwitch("permissions.users.edit", "Editar Usuários", "Permite editar informações e permissões de outros usuários.")}
                          {renderPermissionSwitch("permissions.users.delete", "Excluir Usuários", "Permite excluir outros usuários do sistema.")}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingUser ? 'Salvar Alterações' : 'Criar Usuário'}</Button>
                </div>
              </form>
            </Form>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={handleAddNew} className="flex-grow" disabled={!permissions.users.add}>
                  <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Usuário
                </Button>
                 <Button variant="outline" onClick={() => setIsKiosksModalOpen(true)} className="flex-grow" disabled={!canManageKiosks}>
                    <Warehouse className="mr-2" /> Gerenciar Quiosques
                </Button>
              </div>
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
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(user)} disabled={!permissions.users.edit}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(user)} disabled={user.id === 'master-user' || !permissions.users.delete || user.id === currentUser?.id}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </CardContent>
      </Card>
      
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
