

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
import { PlusCircle, Edit, Trash2, ShieldCheck, Package, Box, Warehouse, UserCog, ClipboardList, FileText, BarChart3, TrendingUp, History, Truck, Users, UserCheck, ShoppingCart, ListOrdered } from 'lucide-react';
import { type Profile, type PermissionSet, defaultGuestPermissions } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

const permissionsSchema = z.object({
    products: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    lots: z.object({ add: z.boolean(), edit: z.boolean(), move: z.boolean(), delete: z.boolean(), viewMovementHistory: z.boolean() }),
    users: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean(), impersonate: z.boolean() }),
    kiosks: z.object({ add: z.boolean(), delete: z.boolean() }),
    predefinedLists: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    forms: z.object({ manage: z.boolean(), fill: z.boolean(), viewHistory: z.boolean(), deleteHistory: z.boolean() }),
    stockAnalysis: z.object({ upload: z.boolean(), configure: z.boolean(), viewHistory: z.boolean(), deleteHistory: z.boolean() }),
    consumptionAnalysis: z.object({ upload: z.boolean(), viewHistory: z.boolean(), deleteHistory: z.boolean() }),
    returns: z.object({ add: z.boolean(), updateStatus: z.boolean(), delete: z.boolean() }),
    team: z.object({ manage: z.boolean(), view: z.boolean() }),
    purchasing: z.object({ suggest: z.boolean(), approve: z.boolean(), viewHistory: z.boolean() }),
    stockCount: z.object({ perform: z.boolean(), approve: z.boolean() }),
    itemRequests: z.object({ manage: z.boolean() }),
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
      stockAnalysis: { ...defaultGuestPermissions.stockAnalysis, ...profile.permissions?.stockAnalysis },
      consumptionAnalysis: { ...defaultGuestPermissions.consumptionAnalysis, ...profile.permissions?.consumptionAnalysis },
      returns: { ...defaultGuestPermissions.returns, ...profile.permissions?.returns },
      team: { ...defaultGuestPermissions.team, ...profile.permissions?.team },
      purchasing: { ...defaultGuestPermissions.purchasing, ...profile.permissions?.purchasing },
      stockCount: { ...defaultGuestPermissions.stockCount, ...profile.permissions?.stockCount },
      itemRequests: { ...defaultGuestPermissions.itemRequests, ...profile.permissions?.itemRequests },
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

  const handleDeleteConfirm = async () => {
    if (profileToDelete) {
      await deleteProfile(profileToDelete.id);
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
            <DialogTitle>Gerenciar perfis</DialogTitle>
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
                      <FormLabel>Nome do perfil</FormLabel>
                      <FormControl><Input placeholder="ex: Operador de quiosque" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <ScrollArea className="h-[55vh] pr-6">
                    <Accordion type="multiple" defaultValue={['products', 'lots', 'predefinedLists', 'forms', 'kiosks', 'users', 'stockAnalysis', 'consumptionAnalysis', 'returns', 'team', 'purchasing']} className="w-full">
                    <AccordionItem value="purchasing">
                        <AccordionTrigger className="text-lg font-semibold"><ShoppingCart className="mr-2 h-5 w-5" /> Gestão de Compras</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.purchasing.suggest", "Sugerir/Pesquisar Preços", "Permite que o usuário insira preços durante uma sessão de pesquisa.")}
                            {renderPermissionSwitch("permissions.purchasing.approve", "Aprovar Compras", "Permite efetivar uma compra, atualizando o preço médio do insumo.")}
                            {renderPermissionSwitch("permissions.purchasing.viewHistory", "Visualizar Histórico", "Permite ver o histórico de pesquisas de preço e compras efetivadas.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="team">
                        <AccordionTrigger className="text-lg font-semibold"><Users className="mr-2 h-5 w-5" /> Gestão de equipe</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.team.view", "Visualizar escalas", "Permite que o usuário veja as escalas de trabalho.")}
                            {renderPermissionSwitch("permissions.team.manage", "Gerenciar escalas", "Permite criar, editar e excluir escalas de trabalho.")}
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="stockCount">
                        <AccordionTrigger className="text-lg font-semibold"><ListOrdered className="mr-2 h-5 w-5" /> Contagem de Estoque</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.stockCount.perform", "Realizar contagem", "Permite registrar contagens de estoque.")}
                            {renderPermissionSwitch("permissions.stockCount.approve", "Aprovar contagem", "Permite aprovar ou rejeitar contagens, ajustando o estoque.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="itemRequests">
                        <AccordionTrigger className="text-lg font-semibold"><PlusCircle className="mr-2 h-5 w-5" /> Solicitações de Insumos</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.itemRequests.manage", "Gerenciar solicitações", "Permite aprovar ou rejeitar solicitações de cadastro de novos insumos.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="stockAnalysis">
                        <AccordionTrigger className="text-lg font-semibold"><BarChart3 className="mr-2 h-5 w-5" /> Análise de estoque</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.stockAnalysis.upload", "Fazer upload de relatório", "Permite que o usuário suba arquivos PDF para analisar o estoque.")}
                            {renderPermissionSwitch("permissions.stockAnalysis.configure", "Configurar parâmetros", "Permite que o usuário defina o estoque ideal e parâmetros de análise.")}
                            {renderPermissionSwitch("permissions.stockAnalysis.viewHistory", "Ver histórico de análises", "Permite visualizar relatórios de análises anteriores.")}
                            {renderPermissionSwitch("permissions.stockAnalysis.deleteHistory", "Excluir histórico", "Permite excluir relatórios do histórico de análises.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="consumptionAnalysis">
                        <AccordionTrigger className="text-lg font-semibold"><TrendingUp className="mr-2 h-5 w-5" /> Análise de consumo</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.consumptionAnalysis.upload", "Fazer upload de relatório", "Permite subir relatórios de vendas/consumo para análise.")}
                            {renderPermissionSwitch("permissions.consumptionAnalysis.viewHistory", "Ver histórico de consumo", "Permite visualizar análises de consumo de meses anteriores.")}
                            {renderPermissionSwitch("permissions.consumptionAnalysis.deleteHistory", "Excluir histórico", "Permite excluir relatórios do histórico de consumo.")}
                        </AccordionContent>
                    </AccordionItem>
                     <AccordionItem value="returns">
                        <AccordionTrigger className="text-lg font-semibold"><Truck className="mr-2 h-5 w-5" /> Devoluções e bonificações</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.returns.add", "Abrir chamados", "Permite abrir novos chamados de devolução ou bonificação.")}
                            {renderPermissionSwitch("permissions.returns.updateStatus", "Atualizar status", "Permite alterar o status de um chamado (ex: de aberta para em andamento).")}
                            {renderPermissionSwitch("permissions.returns.delete", "Excluir chamados", "Permite excluir chamados do sistema.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="products">
                        <AccordionTrigger className="text-lg font-semibold"><Package className="mr-2 h-5 w-5" /> Produtos</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.products.add", "Adicionar produtos", "Permite que o usuário cadastre novos produtos no sistema.")}
                            {renderPermissionSwitch("permissions.products.edit", "Editar produtos", "Permite que o usuário edite informações de produtos existentes.")}
                            {renderPermissionSwitch("permissions.products.delete", "Excluir produtos", "Permite que o usuário remova produtos do inventário.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="lots">
                        <AccordionTrigger className="text-lg font-semibold"><Box className="mr-2 h-5 w-5" /> Lotes de validade</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.lots.add", "Adicionar lotes", "Permite adicionar novos lotes ao controle de validade.")}
                            {renderPermissionSwitch("permissions.lots.edit", "Editar lotes", "Permite editar informações de um lote, como data ou quantidade.")}
                            {renderPermissionSwitch("permissions.lots.move", "Mover estoque", "Permite mover estoque de um lote entre diferentes locais.")}
                            {renderPermissionSwitch("permissions.lots.viewMovementHistory", "Ver histórico de movimentação", "Permite visualizar o histórico de transferências de estoque.")}
                            {renderPermissionSwitch("permissions.lots.delete", "Excluir lotes", "Permite excluir entradas de lote do controle de validade.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="predefinedLists">
                        <AccordionTrigger className="text-lg font-semibold"><ClipboardList className="mr-2 h-5 w-5" /> Conversão predefinida</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.predefinedLists.add", "Criar listas", "Permite que o usuário crie novas listas de conversão.")}
                            {renderPermissionSwitch("permissions.predefinedLists.edit", "Editar listas", "Permite que o usuário edite nomes e itens de listas existentes.")}
                            {renderPermissionSwitch("permissions.predefinedLists.delete", "Excluir listas", "Permite que o usuário remova listas de conversão predefinida.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="forms">
                        <AccordionTrigger className="text-lg font-semibold"><FileText className="mr-2 h-5 w-5" /> Formulários</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.forms.manage", "Gerenciar modelos", "Permite criar, editar e excluir modelos de formulário.")}
                            {renderPermissionSwitch("permissions.forms.fill", "Preencher formulários", "Permite preencher e enviar formulários.")}
                            {renderPermissionSwitch("permissions.forms.viewHistory", "Ver histórico", "Permite visualizar o histórico de formulários enviados.")}
                            {renderPermissionSwitch("permissions.forms.deleteHistory", "Excluir histórico", "Permite excluir envios de formulários do histórico.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="kiosks">
                        <AccordionTrigger className="text-lg font-semibold"><Warehouse className="mr-2 h-5 w-5" /> Quiosques</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.kiosks.add", "Adicionar quiosques", "Permite cadastrar novos quiosques no sistema.")}
                            {renderPermissionSwitch("permissions.kiosks.delete", "Excluir quiosques", "Permite excluir quiosques existentes.")}
                        </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="users">
                        <AccordionTrigger className="text-lg font-semibold"><UserCog className="mr-2 h-5 w-5" /> Gerenciamento de usuários</AccordionTrigger>
                        <AccordionContent className="space-y-2 pt-4 p-1">
                            {renderPermissionSwitch("permissions.users.add", "Adicionar usuários", "Permite criar novos usuários e definir suas permissões.")}
                            {renderPermissionSwitch("permissions.users.edit", "Editar usuários", "Permite editar informações e perfis de outros usuários.")}
                            {renderPermissionSwitch("permissions.users.delete", "Excluir outros usuários do sistema.")}
                            {renderPermissionSwitch("permissions.users.impersonate", "Navegar como outro usuário", "Permite acessar o sistema como se fosse outro colaborador.")}
                        </AccordionContent>
                    </AccordionItem>
                    </Accordion>
                </ScrollArea>
                <DialogFooter className="pt-4 border-t">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit">{editingProfile ? 'Salvar alterações' : 'Criar perfil'}</Button>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <>
              {canEdit && (
                <Button onClick={handleAddNew} className="w-full">
                  <PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo perfil
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
