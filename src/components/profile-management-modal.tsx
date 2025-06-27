
"use client"

import { useState, useEffect } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useProfiles } from '@/hooks/use-profiles';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PlusCircle, Edit, Trash2, ShieldCheck, Package, Box, Warehouse, UserCog, ClipboardList, FileText } from 'lucide-react';
import { type Profile, type PermissionSet, defaultGuestPermissions } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

const permissionsSchema = z.object({
    products: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    lots: z.object({ add: z.boolean(), edit: z.boolean(), move: z.boolean(), delete: z.boolean() }),
    users: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    kiosks: z.object({ add: z.boolean(), delete: z.boolean() }),
    predefinedLists: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    forms: z.object({ manage: z.boolean(), fill: z.boolean(), viewHistory: z.boolean() }),
});

const profileSchema = z.object({
  name: z.string().min(3, 'O nome do perfil deve ter pelo menos 3 caracteres.'),
  permissions: permissionsSchema,
});

type ProfileFormValues = z.infer<typeof profileSchema>;

type ProfileManagementModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

export function ProfileManagementModal({ open, onOpenChange, canEdit }: ProfileManagementModalProps) {
  const { profiles, addProfile, updateProfile, deleteProfile } = useProfiles();
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      permissions: defaultGuestPermissions
    },
  });

  useEffect(() => {
    if (open) {
      setShowForm(false);
      setEditingProfile(null);
    }
  }, [open]);

  const handleAddNew = () => {
    setEditingProfile(null);
    form.reset({ name: '', permissions: defaultGuestPermissions });
    setShowForm(true);
  };

  const handleEdit = (profile: Profile) => {
    setEditingProfile(profile);
    
    const finalPermissions: PermissionSet = {
      ...defaultGuestPermissions,
      ...profile.permissions,
      products: { ...defaultGuestPermissions.products, ...profile.permissions?.products },
      lots: { ...defaultGuestPermissions.lots, ...profile.permissions?.lots },
      users: { ...defaultGuestPermissions.users, ...profile.permissions?.users },
      kiosks: { ...defaultGuestPermissions.kiosks, ...profile.permissions?.kiosks },
      predefinedLists: { ...defaultGuestPermissions.predefinedLists, ...profile.permissions?.predefinedLists },
      forms: { ...defaultGuestPermissions.forms, ...profile.permissions?.forms },
    };

    form.reset({
      name: profile.name,
      permissions: finalPermissions,
    });
    setShowForm(true);
  };
  
  const handleDeleteClick = (profile: Profile) => {
    setProfileToDelete(profile);
  };

  const handleDeleteConfirm = () => {
    if (profileToDelete) {
      deleteProfile(profileToDelete.id);
      setProfileToDelete(null);
    }
  };

  const onSubmit = (values: ProfileFormValues) => {
    if (editingProfile) {
      updateProfile({ ...editingProfile, ...values });
    } else {
      addProfile(values);
    }
    setShowForm(false);
    setEditingProfile(null);
  };

  const renderPermissionSwitch = (name: FieldPath<ProfileFormValues>, label: string, description: string) => (
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Gerenciar Perfis</DialogTitle>
            <DialogDescription>Crie perfis de permissão para atribuir aos usuários.</DialogDescription>
          </DialogHeader>
          
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                 <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do Perfil</FormLabel>
                      <FormControl><Input placeholder="ex: Operador de Quiosque" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Accordion type="multiple" defaultValue={['products', 'lots', 'predefinedLists', 'forms', 'kiosks', 'users']} className="w-full">
                  <AccordionItem value="products">
                    <AccordionTrigger className="text-lg font-semibold"><Package className="mr-2 h-5 w-5" /> Produtos</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-4 p-1">
                        {renderPermissionSwitch("permissions.products.add", "Adicionar Produtos", "Permite que o usuário cadastre novos produtos no sistema.")}
                        {renderPermissionSwitch("permissions.products.edit", "Editar Produtos", "Permite que o usuário edite informações de produtos existentes.")}
                        {renderPermissionSwitch("permissions.products.delete", "Excluir Produtos", "Permite que o usuário remova produtos do inventário.")}
                    </AccordionContent>
                  </AccordionItem>
                   <AccordionItem value="lots">
                    <AccordionTrigger className="text-lg font-semibold"><Box className="mr-2 h-5 w-5" /> Lotes de Validade</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-4 p-1">
                        {renderPermissionSwitch("permissions.lots.add", "Adicionar Lotes", "Permite adicionar novos lotes ao controle de validade.")}
                        {renderPermissionSwitch("permissions.lots.edit", "Editar Lotes", "Permite editar informações de um lote, como data ou quantidade.")}
                        {renderPermissionSwitch("permissions.lots.move", "Mover Estoque", "Permite mover estoque de um lote entre diferentes locais.")}
                        {renderPermissionSwitch("permissions.lots.delete", "Excluir Lotes", "Permite excluir entradas de lote do controle de validade.")}
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="predefinedLists">
                    <AccordionTrigger className="text-lg font-semibold"><ClipboardList className="mr-2 h-5 w-5" /> Conversão Predefinida</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-4 p-1">
                        {renderPermissionSwitch("permissions.predefinedLists.add", "Criar Listas", "Permite que o usuário crie novas listas de conversão.")}
                        {renderPermissionSwitch("permissions.predefinedLists.edit", "Editar Listas", "Permite que o usuário edite nomes e itens de listas existentes.")}
                        {renderPermissionSwitch("permissions.predefinedLists.delete", "Excluir Listas", "Permite que o usuário remova listas de conversão predefinida.")}
                    </AccordionContent>
                  </AccordionItem>
                   <AccordionItem value="forms">
                    <AccordionTrigger className="text-lg font-semibold"><FileText className="mr-2 h-5 w-5" /> Formulários</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-4 p-1">
                        {renderPermissionSwitch("permissions.forms.manage", "Gerenciar Modelos", "Permite criar, editar e excluir modelos de formulário.")}
                        {renderPermissionSwitch("permissions.forms.fill", "Preencher Formulários", "Permite preencher e enviar formulários.")}
                        {renderPermissionSwitch("permissions.forms.viewHistory", "Ver Histórico", "Permite visualizar o histórico de formulários enviados.")}
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="kiosks">
                    <AccordionTrigger className="text-lg font-semibold"><Warehouse className="mr-2 h-5 w-5" /> Quiosques</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-4 p-1">
                        {renderPermissionSwitch("permissions.kiosks.add", "Adicionar Quiosques", "Permite cadastrar novos quiosques no sistema.")}
                        {renderPermissionSwitch("permissions.kiosks.delete", "Excluir Quiosques", "Permite excluir quiosques existentes.")}
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="users">
                    <AccordionTrigger className="text-lg font-semibold"><UserCog className="mr-2 h-5 w-5" /> Gerenciamento de Usuários</AccordionTrigger>
                    <AccordionContent className="space-y-2 pt-4 p-1">
                        {renderPermissionSwitch("permissions.users.add", "Adicionar Usuários", "Permite criar novos usuários e definir suas permissões.")}
                        {renderPermissionSwitch("permissions.users.edit", "Editar Usuários", "Permite editar informações e perfis de outros usuários.")}
                        {renderPermissionSwitch("permissions.users.delete", "Excluir Usuários", "Permite excluir outros usuários do sistema.")}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingProfile ? 'Salvar Alterações' : 'Criar Perfil'}</Button>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <>
              {canEdit && (
                <Button onClick={handleAddNew} className="w-full">
                  <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Perfil
                </Button>
              )}
              <Separator className="my-4" />
              <ScrollArea className="h-72">
                <div className="space-y-2 pr-4">
                  {profiles.length > 0 ? profiles.map(profile => (
                    <div key={profile.id} className="flex items-center justify-between rounded-md border p-3">
                      <span className="font-medium">{profile.name}</span>
                      {canEdit && <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(profile)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(profile)} disabled={profile.isDefaultAdmin}><Trash2 className="h-4 w-4" /></Button>
                      </div>}
                    </div>
                  )) : (
                    <p className="text-center text-muted-foreground py-8">Nenhum perfil cadastrado.</p>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
      {profileToDelete && (
        <DeleteConfirmationDialog
          open={!!profileToDelete}
          onOpenChange={() => setProfileToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o perfil "${profileToDelete.name}"`}
        />
      )}
    </>
  );
}
