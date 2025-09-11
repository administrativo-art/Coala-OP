
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
import { PlusCircle, Edit, Trash2, ShieldCheck, Package, Box, Warehouse, UserCog, ClipboardList, BarChart3, TrendingUp, History, Truck, Users, UserCheck, ShoppingCart, ListOrdered, DollarSign, AreaChart, BookOpen, ShieldCheck as AuditIcon, ListTodo, FileText, Repeat, ClipboardCheck, ListPlus, Settings } from 'lucide-react';
import { type Profile, type PermissionSet, defaultGuestPermissions } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

const permissionsSchema = z.object({
  registration: z.object({
    view: z.boolean(),
    items: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    baseProducts: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
    entities: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
  }),
  stock: z.object({
    view: z.boolean(),
    inventoryControl: z.object({ addLot: z.boolean(), editLot: z.boolean(), writeDown: z.boolean(), transfer: z.boolean(), viewHistory: z.boolean() }),
    stockCount: z.object({ perform: z.boolean(), approve: z.boolean(), requestItem: z.boolean() }),
    audit: z.object({ start: z.boolean(), approve: z.boolean() }),
    analysis: z.object({ view: z.boolean(), restock: z.boolean(), consumption: z.boolean(), projection: z.boolean(), valuation: z.boolean() }),
    purchasing: z.object({ view: z.boolean(), suggest: z.boolean(), approve: z.boolean(), deleteHistory: z.boolean() }),
    returns: z.object({ view: z.boolean(), add: z.boolean(), updateStatus: z.boolean(), delete: z.boolean() }),
    conversions: z.object({ view: z.boolean() }),
  }),
  team: z.object({ view: z.boolean(), manage: z.boolean() }),
  pricing: z.object({ view: z.boolean(), simulate: z.boolean(), manageParameters: z.boolean() }),
  settings: z.object({ view: z.boolean(), manageUsers: z.boolean(), manageKiosks: z.boolean(), manageProfiles: z.boolean(), manageLabels: z.boolean() }),
  // Legacy
  products: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
  lots: z.object({ add: z.boolean(), edit: z.boolean(), move: z.boolean(), delete: z.boolean(), viewMovementHistory: z.boolean() }),
  users: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean(), impersonate: z.boolean() }),
  kiosks: z.object({ add: z.boolean(), delete: z.boolean() }),
  predefinedLists: z.object({ add: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
  consumptionAnalysis: z.object({ upload: z.boolean(), viewHistory: z.boolean(), deleteHistory: z.boolean() }),
  itemRequests: z.object({ add: z.boolean(), approve: z.boolean() }),
  tasks: z.object({ view: z.boolean(), manage: z.boolean() }),
  reposition: { cancel: z.boolean() },
  help: { view: z.boolean() },
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
    
    // Deep merge with defaults to ensure all keys are present
    const mergedPermissions = JSON.parse(JSON.stringify(defaultGuestPermissions));
    
    for (const mainKey in profile.permissions) {
        if (Object.prototype.hasOwnProperty.call(profile.permissions, mainKey)) {
            const key = mainKey as keyof PermissionSet;
            if (typeof profile.permissions[key] === 'object' && profile.permissions[key] !== null) {
                if (!mergedPermissions[key]) {
                    (mergedPermissions as any)[key] = {};
                }
                for (const subKey in profile.permissions[key]) {
                    if (Object.prototype.hasOwnProperty.call(profile.permissions[key], subKey)) {
                        (mergedPermissions[key] as any)[subKey] = (profile.permissions[key] as any)[subKey];
                    }
                }
            } else {
                 (mergedPermissions as any)[key] = profile.permissions[key];
            }
        }
    }

    form.reset({
      name: profile.name,
      permissions: mergedPermissions,
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
      updateProfile({ ...editingProfile, permissions: values.permissions, name: values.name });
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
        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            <FormDescription className="text-xs">{description}</FormDescription>
          </div>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );
  
   const renderModuleToggle = (label: string, name: `permissions.${keyof PermissionSet}`, description?: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm bg-muted/30">
          <div className="space-y-0.5">
            <FormLabel className="text-base">{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
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
        <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Gerenciar perfis</DialogTitle>
            <DialogDescription>Crie perfis de permissão para atribuir aos usuários.</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-hidden">
          {showForm ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 h-full flex flex-col">
                <div className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full pr-6">
                        <div className="space-y-4">
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
                            <Accordion type="multiple" defaultValue={['registration', 'stock', 'team', 'pricing', 'settings', 'help']} className="w-full">
                            
                            <AccordionItem value="registration">
                                <AccordionTrigger className="text-lg font-semibold"><ListPlus className="mr-2 h-5 w-5" /> Cadastros</AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("Ver Módulo de Cadastros", "permissions.registration.view")}
                                    {renderPermissionSwitch("permissions.registration.items.add", "Adicionar Insumos", "Permite cadastrar novos insumos (itens físicos).")}
                                    {renderPermissionSwitch("permissions.registration.items.edit", "Editar Insumos", "Permite editar insumos existentes.")}
                                    {renderPermissionSwitch("permissions.registration.items.delete", "Excluir Insumos", "Permite excluir insumos (ação perigosa).")}
                                    {renderPermissionSwitch("permissions.registration.baseProducts.add", "Adicionar Produtos Base", "Permite criar novos produtos base.")}
                                    {renderPermissionSwitch("permissions.registration.baseProducts.edit", "Editar Produtos Base", "Permite editar produtos base existentes.")}
                                    {renderPermissionSwitch("permissions.registration.baseProducts.delete", "Excluir Produtos Base", "Permite excluir produtos base.")}
                                    {renderPermissionSwitch("permissions.registration.entities.add", "Adicionar Entidades", "Permite cadastrar Pessoas e Empresas.")}
                                    {renderPermissionSwitch("permissions.registration.entities.edit", "Editar Entidades", "Permite editar Pessoas e Empresas.")}
                                    {renderPermissionSwitch("permissions.registration.entities.delete", "Excluir Entidades", "Permite excluir Pessoas e Empresas.")}
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="stock">
                                <AccordionTrigger className="text-lg font-semibold"><ClipboardCheck className="mr-2 h-5 w-5" /> Gestão de Estoque</AccordionTrigger>
                                <AccordionContent className="space-y-4 p-1 pt-4">
                                     {renderModuleToggle("Ver Módulo de Estoque", "permissions.stock.view")}
                                     <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Controle de Estoque</h4>
                                        {renderPermissionSwitch("permissions.stock.inventoryControl.addLot", "Adicionar Lotes", "Permite adicionar novos lotes de produtos ao estoque.")}
                                        {renderPermissionSwitch("permissions.stock.inventoryControl.editLot", "Editar Lotes", "Permite editar informações de lotes existentes.")}
                                        {renderPermissionSwitch("permissions.stock.inventoryControl.writeDown", "Dar Baixa em Lotes", "Permite registrar saídas por consumo ou descarte.")}
                                        {renderPermissionSwitch("permissions.stock.inventoryControl.transfer", "Transferir Lotes", "Permite mover estoque entre quiosques.")}
                                        {renderPermissionSwitch("permissions.stock.inventoryControl.viewHistory", "Ver Histórico de Lotes", "Permite ver o histórico de movimentações de um lote.")}
                                     </div>
                                      <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Contagem</h4>
                                        {renderPermissionSwitch("permissions.stock.stockCount.perform", "Realizar Contagem", "Permite registrar contagens parciais de estoque.")}
                                        {renderPermissionSwitch("permissions.stock.stockCount.approve", "Aprovar Contagem", "Permite aprovar divergências, ajustando o estoque.")}
                                        {renderPermissionSwitch("permissions.stock.stockCount.requestItem", "Solicitar Novo Insumo", "Permite solicitar cadastro de um item não encontrado.")}
                                     </div>
                                     <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Auditoria</h4>
                                        {renderPermissionSwitch("permissions.stock.audit.start", "Iniciar Auditoria", "Permite iniciar uma auditoria completa de um quiosque.")}
                                        {renderPermissionSwitch("permissions.stock.audit.approve", "Aprovar Auditoria", "Permite finalizar uma auditoria, efetivando os ajustes.")}
                                     </div>
                                     <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Análise de Estoque</h4>
                                         {renderModuleToggle("Ver Análises de Estoque", "permissions.stock.analysis.view")}
                                        {renderPermissionSwitch("permissions.stock.analysis.restock", "Analisar Reposição", "Permite ver a tela de análise de reposição.")}
                                        {renderPermissionSwitch("permissions.stock.analysis.consumption", "Analisar Consumo", "Permite ver a tela de consumo médio.")}
                                        {renderPermissionSwitch("permissions.stock.analysis.projection", "Analisar Projeção", "Permite ver a projeção de consumo vs. validade.")}
                                        {renderPermissionSwitch("permissions.stock.analysis.valuation", "Analisar Avaliação Financeira", "Permite ver o valor financeiro do estoque.")}
                                     </div>
                                      <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Compras</h4>
                                         {renderModuleToggle("Ver Módulo de Compras", "permissions.stock.purchasing.view")}
                                        {renderPermissionSwitch("permissions.stock.purchasing.suggest", "Sugerir Preços", "Permite criar sessões de compra e adicionar cotações.")}
                                        {renderPermissionSwitch("permissions.stock.purchasing.approve", "Efetivar Compra", "Permite confirmar um preço, atualizando o custo do insumo.")}
                                        {renderPermissionSwitch("permissions.stock.purchasing.deleteHistory", "Excluir Histórico de Preços", "Permite apagar registros de preços efetivados.")}
                                     </div>
                                      <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Avarias</h4>
                                         {renderModuleToggle("Ver Módulo de Avarias", "permissions.stock.returns.view")}
                                        {renderPermissionSwitch("permissions.stock.returns.add", "Abrir Chamados", "Permite criar novos chamados de avaria/devolução.")}
                                        {renderPermissionSwitch("permissions.stock.returns.updateStatus", "Atualizar Status de Chamados", "Permite avançar o status de um chamado.")}
                                        {renderPermissionSwitch("permissions.stock.returns.delete", "Excluir Chamados", "Permite apagar chamados de avaria.")}
                                     </div>
                                      <div className="pl-4 border-l-2 ml-2">
                                        <h4 className="font-semibold text-md mb-2">Conversões</h4>
                                        {renderModuleToggle("Ver Conversor de Medidas", "permissions.stock.conversions.view")}
                                     </div>
                                </AccordionContent>
                            </AccordionItem>

                             <AccordionItem value="team">
                                <AccordionTrigger className="text-lg font-semibold"><Users className="mr-2 h-5 w-5" /> Equipe</AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("Ver Módulo de Equipe", "permissions.team.view")}
                                    {renderPermissionSwitch("permissions.team.manage", "Gerenciar Escalas", "Permite criar e editar as escalas de trabalho.")}
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="pricing">
                                <AccordionTrigger className="text-lg font-semibold"><DollarSign className="mr-2 h-5 w-5" /> Custo e Preço</AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("Ver Módulo de Custo e Preço", "permissions.pricing.view")}
                                    {renderPermissionSwitch("permissions.pricing.simulate", "Simular Custo e Preço", "Permite criar/editar fichas técnicas e simulações.")}
                                    {renderPermissionSwitch("permissions.pricing.manageParameters", "Gerenciar Parâmetros de Preço", "Permite editar o % operacional e faixas de lucro.")}
                                </AccordionContent>
                            </AccordionItem>
                            
                            <AccordionItem value="settings">
                                <AccordionTrigger className="text-lg font-semibold"><Settings className="mr-2 h-5 w-5" /> Configurações</AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                     {renderModuleToggle("Ver Módulo de Configurações", "permissions.settings.view")}
                                     {renderPermissionSwitch("permissions.settings.manageUsers", "Gerenciar Usuários", "Permite criar, editar e excluir usuários.")}
                                     {renderPermissionSwitch("permissions.users.impersonate", "Navegar como Outro Usuário", "Permite entrar no sistema como se fosse outro usuário.")}
                                     {renderPermissionSwitch("permissions.settings.manageKiosks", "Gerenciar Quiosques", "Permite criar e excluir quiosques.")}
                                     {renderPermissionSwitch("permissions.settings.manageProfiles", "Gerenciar Perfis", "Permite criar e editar perfis de permissão.")}
                                     {renderPermissionSwitch("permissions.settings.manageLabels", "Gerenciar Etiquetas", "Permite alterar o tamanho padrão das etiquetas.")}
                                </AccordionContent>
                            </AccordionItem>

                             <AccordionItem value="tasks">
                                <AccordionTrigger className="text-lg font-semibold"><ListTodo className="mr-2 h-5 w-5" /> Tarefas</AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderPermissionSwitch("permissions.tasks.view", "Visualizar Tarefas", "Permite visualizar todas as tarefas do sistema.")}
                                    {renderPermissionSwitch("permissions.tasks.manage", "Gerenciar Tarefas", "Permite criar, atribuir, editar e excluir tarefas.")}
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="help">
                                <AccordionTrigger className="text-lg font-semibold"><BookOpen className="mr-2 h-5 w-5" /> Ajuda</AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("Ver Central de Ajuda", "permissions.help.view")}
                                </AccordionContent>
                            </AccordionItem>

                            </Accordion>
                        </div>
                    </ScrollArea>
                </div>
                <DialogFooter className="pt-4 border-t shrink-0">
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
              <div className="flex-1 overflow-auto">
                <ScrollArea className="h-full pr-4">
                  <div className="space-y-2">
                    {profiles.length > 0 ? profiles.map(profile => (
                      <div key={profile.id} className="flex items-center justify-between rounded-md border p-3">
                        <span className="font-medium">{profile.name}</span>
                        {canEdit && <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(profile)}><Edit className="h-4 w-4" /></Button>
                            <DeleteConfirmationDialog
                                open={false}
                                onOpenChange={()=>{}}
                                onConfirm={handleDeleteConfirm}
                                itemName={`o perfil "${profileToDelete?.name}"`}
                                triggerButton={
                                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(profile)} disabled={profile.isDefaultAdmin}><Trash2 className="h-4 w-4" /></Button>
                                }
                            />
                        </div>}
                      </div>
                    )) : (
                      <p className="text-center text-muted-foreground py-8">Nenhum perfil cadastrado.</p>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
