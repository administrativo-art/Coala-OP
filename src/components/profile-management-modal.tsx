
"use client"

import { useState, useEffect, useMemo, useRef } from 'react';
import { useForm, type FieldPath, type FieldValues, ControllerRenderProps } from 'react-hook-form';
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@radix-ui/react-accordion";
import { PlusCircle, Edit, Trash2, ShieldCheck, Package, Box, Warehouse, UserCog, BarChart3, TrendingUp, History, Truck, Users, UserCheck, ShoppingCart, ListOrdered, DollarSign, AreaChart, BookOpen, ShieldCheck as AuditIcon, ListTodo, FileText, Repeat, ClipboardCheck, ListPlus, Settings, LayoutDashboard, Ticket, Copy, PackagePlus } from 'lucide-react';
import { type Profile, type PermissionSet, defaultGuestPermissions } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

const permissionsSchema = z.object({}).passthrough(); 

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

function DuplicateProfileModal({
  profileToDuplicate,
  onClose,
  onConfirm,
}: {
  profileToDuplicate: Profile | null;
  onClose: () => void;
  onConfirm: (newName: string) => void;
}) {
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (profileToDuplicate) {
      setNewName(`${profileToDuplicate.name} (cópia)`);
    }
  }, [profileToDuplicate]);

  if (!profileToDuplicate) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicar perfil "{profileToDuplicate.name}"</DialogTitle>
          <DialogDescription>
            Insira um nome para o novo perfil que terá as mesmas permissões.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do novo perfil"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm(newName)} disabled={!newName.trim()}>
            Criar Duplicata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProfileManagementModal({ open, onOpenChange, canEdit }: ProfileManagementModalProps) {
  const { profiles, addProfile, updateProfile, deleteProfile, adminProfileId } = useProfiles();
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [profileToDuplicate, setProfileToDuplicate] = useState<Profile | null>(null);

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
    
    const mergeRecursive = (target: Record<string, any>, source: Record<string, any>) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return;
      if (!target || typeof target !== 'object' || Array.isArray(target)) return;

      Object.keys(source).forEach(key => {
        const sourceValue = source[key];
        const targetValue = target[key];

        if (
          sourceValue !== null &&
          sourceValue !== undefined &&
          typeof sourceValue === 'object' &&
          !Array.isArray(sourceValue) &&
          targetValue !== null &&
          targetValue !== undefined &&
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue)
        ) {
          mergeRecursive(targetValue, sourceValue);
        } else if (sourceValue !== undefined && sourceValue !== null) {
          target[key] = sourceValue;
        }
      });
    };
    
    const initialPermissions = JSON.parse(JSON.stringify(defaultGuestPermissions));
    mergeRecursive(initialPermissions, profile.permissions || {});

    form.reset({
      name: profile.name,
      permissions: initialPermissions,
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

  const handleDuplicateClick = (profile: Profile) => {
    setProfileToDuplicate(profile);
  };

  const handleDuplicateConfirm = (newName: string) => {
    if (profileToDuplicate) {
      addProfile({
        name: newName,
        permissions: profileToDuplicate.permissions,
      });
      setProfileToDuplicate(null);
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

  const renderPermissionSwitch = (
    name: FieldPath<ProfileFormValues>, 
    label: string, 
    description: string, 
    disabled: boolean = false, 
    indented: boolean = false
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={`flex flex-row items-center justify-between rounded-lg border p-3 ${indented ? 'ml-6 bg-muted/30' : ''}`}>
          <div className="space-y-0.5">
            <FormLabel>{label}</FormLabel>
            <FormDescription className="text-xs">{description}</FormDescription>
          </div>
          <FormControl>
            <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
          </FormControl>
        </FormItem>
      )}
    />
  );
  
   const renderModuleToggle = (
     name: FieldPath<ProfileFormValues>,
     label: string,
     description?: string
   ) => (
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
            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
        </FormItem>
      )}
    />
  );

  const createSyncedSwitch = (
    primaryPath: FieldPath<ProfileFormValues>,
    secondaryPath: FieldPath<ProfileFormValues>,
    label: string,
    description: string,
    disabled: boolean = false,
    indented: boolean = false
  ) => {
    return (
      <FormField
        control={form.control}
        name={primaryPath}
        render={({ field }) => (
          <FormItem className={`flex flex-row items-center justify-between rounded-lg border p-3 ${indented ? 'ml-6 bg-muted/30' : ''}`}>
            <div className="space-y-0.5">
              <FormLabel>{label}</FormLabel>
              <FormDescription className="text-xs">{description}</FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={!!field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  form.setValue(secondaryPath, checked);
                }}
                disabled={disabled}
              />
            </FormControl>
          </FormItem>
        )}
      />
    );
  };

  const dashboardViewWatch = form.watch('permissions.dashboard.view' as any);
  const stockViewWatch = form.watch('permissions.stock.view' as any);
  const stockCountViewWatch = form.watch('permissions.stock.stockCount.view' as any);
  const analysisViewWatch = form.watch('permissions.stock.analysis.view' as any);
  const purchasingViewWatch = form.watch('permissions.stock.purchasing.view' as any);
  const returnsViewWatch = form.watch('permissions.stock.returns.view' as any);
  const registrationViewWatch = form.watch('permissions.registration.view' as any);
  const pricingViewWatch = form.watch('permissions.pricing.view' as any);
  const tasksViewWatch = form.watch('permissions.tasks.view' as any);
  const settingsViewWatch = form.watch('permissions.settings.view' as any);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Gerenciar perfis</DialogTitle>
            <DialogDescription>Crie perfis de permissão para atribuir aos usuários.</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto -mx-6 px-6">
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
                            <Accordion type="multiple" defaultValue={['dashboard', 'stock']} className="w-full">
                            
                            <AccordionItem value="dashboard">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><LayoutDashboard className="mr-2 h-5 w-5" /> Dashboard</div></AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("permissions.dashboard.view" as any, "Visualizar Dashboard Principal", "Permite que o usuário veja a página inicial do dashboard.")}
                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <FormField control={form.control} name="permissions.dashboard.operational" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3"><div className="space-y-0.5"><FormLabel>Aba Operacional</FormLabel></div><FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={!dashboardViewWatch} /></FormControl></FormItem> )} />
                                        <FormField control={form.control} name="permissions.dashboard.pricing" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3"><div className="space-y-0.5"><FormLabel>Aba Custo e Preço</FormLabel></div><FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={!dashboardViewWatch} /></FormControl></FormItem> )} />
                                        <FormField control={form.control} name="permissions.dashboard.technicalSheets" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3"><div className="space-y-0.5"><FormLabel>Aba Fichas Técnicas</FormLabel></div><FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={!dashboardViewWatch} /></FormControl></FormItem> )} />
                                        <FormField control={form.control} name="permissions.dashboard.audit" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3"><div className="space-y-0.5"><FormLabel>Aba Auditoria</FormLabel></div><FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={!dashboardViewWatch} /></FormControl></FormItem> )} />
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="registration">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><ListPlus className="mr-2 h-5 w-5" /> Cadastros</div></AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("permissions.registration.view" as any, "Ver Módulo de Cadastros")}
                                    {renderPermissionSwitch("permissions.registration.items.add" as any, "Adicionar Insumos", "Permite cadastrar novos insumos (itens físicos).", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.items.edit" as any, "Editar Insumos", "Permite editar insumos existentes.", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.items.delete" as any, "Excluir Insumos", "Permite excluir insumos (ação perigosa).", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.baseProducts.add" as any, "Adicionar Produtos Base", "Permite criar novos produtos base.", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.baseProducts.edit" as any, "Editar Produtos Base", "Permite editar produtos base existentes.", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.baseProducts.delete" as any, "Excluir Produtos Base", "Permite excluir produtos base.", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.entities.add" as any, "Adicionar Entidades", "Permite cadastrar Pessoas e Empresas.", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.entities.edit" as any, "Editar Entidades", "Permite editar Pessoas e Empresas.", !registrationViewWatch)}
                                    {renderPermissionSwitch("permissions.registration.entities.delete" as any, "Excluir Entidades", "Permite excluir Pessoas e Empresas.", !registrationViewWatch)}
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="stock">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><ClipboardCheck className="mr-2 h-5 w-5" /> Gestão de Estoque</div></AccordionTrigger>
                                <AccordionContent className="space-y-4 p-1 pt-4">
                                    {renderModuleToggle("permissions.stock.view" as any, "Visualizar Módulo de Estoque", "Permissão geral para acessar a seção.")}
                                    
                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Controle de Estoque</h4>
                                        {renderPermissionSwitch("permissions.stock.inventoryControl.view" as any, "Visualizar Controle de Estoque", "Permite ver a tela principal de controle de estoque.", !stockViewWatch)}
                                        <div className="pl-6 space-y-2">
                                            {renderPermissionSwitch("permissions.stock.inventoryControl.addLot" as any, "Adicionar Lotes", "Permite adicionar novos lotes de produtos ao estoque.", !stockViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.inventoryControl.editLot" as any, "Editar Lotes", "Permite editar informações de lotes existentes.", !stockViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.inventoryControl.writeDown" as any, "Dar Baixa em Lotes", "Permite registrar saídas por consumo ou descarte.", !stockViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.inventoryControl.transfer" as any, "Transferir Lotes", "Permite mover estoque entre quiosques.", !stockViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.inventoryControl.viewHistory" as any, "Ver Histórico de Lotes", "Permite ver o histórico de movimentações de um lote.", !stockViewWatch, true)}
                                        </div>
                                    </div>

                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Contagem de estoque</h4>
                                        {createSyncedSwitch("permissions.stock.stockCount.view" as any, "permissions.stock.audit.view" as any, "Visualizar Histórico", "Permite ver as sessões salvas.", !stockViewWatch)}
                                        <div className="pl-6 space-y-2">
                                            {createSyncedSwitch("permissions.stock.stockCount.perform" as any, "permissions.stock.audit.start" as any, "Realizar contagem", "Permite iniciar uma nova sessão de contagem.", !stockCountViewWatch, true)}
                                            {createSyncedSwitch("permissions.stock.stockCount.approve" as any, "permissions.stock.audit.approve" as any, "Concluir contagem", "Permite aprovar divergências, ajustando o estoque.", !stockCountViewWatch, true)}
                                        </div>
                                    </div>

                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Análise de Estoque</h4>
                                        {renderPermissionSwitch("permissions.stock.analysis.view" as any, "Visualizar Análises de Estoque", "Permite ver a tela de análises.", !stockViewWatch)}
                                         <div className="pl-6 space-y-2">
                                            {renderPermissionSwitch("permissions.stock.analysis.restock" as any, "Analisar Reposição", "Permite ver a tela de análise de reposição.", !analysisViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.analysis.consumption" as any, "Analisar Consumo", "Permite ver a tela de consumo médio.", !analysisViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.analysis.projection" as any, "Analisar Projeção", "Permite ver projeções futuras.", !analysisViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.analysis.valuation" as any, "Analisar Avaliação Financeira", "Permite ver o valor financeiro do estoque.", !analysisViewWatch, true)}
                                         </div>
                                    </div>

                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Compras</h4>
                                        {renderPermissionSwitch("permissions.stock.purchasing.view" as any, "Visualizar Módulo de Compras", "Permite ver a tela de compras.", !stockViewWatch)}
                                         <div className="pl-6 space-y-2">
                                            {renderPermissionSwitch("permissions.stock.purchasing.suggest" as any, "Sugerir Preços", "Permite criar sessões de compra e adicionar cotações.", !purchasingViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.purchasing.approve" as any, "Efetivar Compra", "Permite confirmar um preço, atualizando o custo do insumo.", !purchasingViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.purchasing.deleteHistory" as any, "Excluir Histórico de Preços", "Permite apagar registros de preços efetivados.", !purchasingViewWatch, true)}
                                         </div>
                                    </div>

                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Avarias</h4>
                                        {renderPermissionSwitch("permissions.stock.returns.view" as any, "Visualizar Módulo de Avarias", "Permite ver a tela de avarias.", !stockViewWatch)}
                                         <div className="pl-6 space-y-2">
                                            {renderPermissionSwitch("permissions.stock.returns.add" as any, "Abrir Chamados", "Permite criar novos chamados de avaria/devolução.", !returnsViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.returns.updateStatus" as any, "Atualizar Status de Chamados", "Permite avançar o status de um chamado.", !returnsViewWatch, true)}
                                            {renderPermissionSwitch("permissions.stock.returns.delete" as any, "Excluir Chamados", "Permite apagar chamados de avaria.", !returnsViewWatch, true)}
                                         </div>
                                    </div>

                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Conversões e Listas</h4>
                                        {renderPermissionSwitch("permissions.stock.conversions.view" as any, "Visualizar Conversor de Medidas", "Permite acessar a ferramenta de conversão.", !stockViewWatch)}
                                    </div>
                                    
                                    <div className="pl-4 border-l-2 ml-2 space-y-2">
                                        <h4 className="font-semibold text-md mb-2">Reposição</h4>
                                        {renderPermissionSwitch("permissions.reposition.cancel" as any, "Cancelar Atividade", "Permite cancelar uma atividade de reposição em andamento.", !stockViewWatch)}
                                    </div>

                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="pricing">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><DollarSign className="mr-2 h-5 w-5" /> Custo e Preço</div></AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("permissions.pricing.view" as any, "Ver Módulo de Custo e Preço")}
                                    {renderPermissionSwitch("permissions.pricing.simulate" as any, "Simular Custo e Preço", "Permite criar/editar fichas técnicas e simulações.", !pricingViewWatch)}
                                    {renderPermissionSwitch("permissions.pricing.manageParameters" as any, "Gerenciar Parâmetros de Preço", "Permite editar o % operacional e faixas de lucro.", !pricingViewWatch)}
                                </AccordionContent>
                            </AccordionItem>
                            
                            <AccordionItem value="settings">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><Settings className="mr-2 h-5 w-5" /> Configurações</div></AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("permissions.settings.view" as any, "Ver Módulo de Configurações")}
                                    {renderPermissionSwitch("permissions.settings.manageUsers" as any, "Gerenciar Usuários", "Permite criar, editar e excluir usuários.", !settingsViewWatch)}
                                    {renderPermissionSwitch("permissions.settings.manageKiosks" as any, "Gerenciar Quiosques", "Permite criar e excluir quiosques.", !settingsViewWatch)}
                                    {renderPermissionSwitch("permissions.settings.manageProfiles" as any, "Gerenciar Perfis", "Permite criar e editar perfis de permissão.", !settingsViewWatch)}
                                    {renderPermissionSwitch("permissions.settings.manageLabels" as any, "Gerenciar Etiquetas", "Permite alterar o tamanho padrão das etiquetas.", !settingsViewWatch)}
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="tasks">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><ListTodo className="mr-2 h-5 w-5" /> Tarefas</div></AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("permissions.tasks.view" as any, "Visualizar Tarefas", "Permite visualizar todas as tarefas do sistema.")}
                                    {renderPermissionSwitch("permissions.tasks.manage" as any, "Gerenciar Tarefas", "Permite criar, atribuir, editar e excluir tarefas.", !tasksViewWatch)}
                                </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="help">
                                <AccordionTrigger className="text-lg font-semibold flex items-center justify-between py-4 border-b"><div className="flex items-center"><BookOpen className="mr-2 h-5 w-5" /> Ajuda</div></AccordionTrigger>
                                <AccordionContent className="space-y-2 pt-4 p-1">
                                    {renderModuleToggle("permissions.help.view" as any, "Ver Central de Ajuda")}
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
              <div className="flex-1 overflow-y-auto -mx-6 px-6">
                <ScrollArea className="h-full pr-4">
                  <div className="space-y-2">
                    {profiles.length > 0 ? profiles.map(profile => (
                      <div key={profile.id} className="flex items-center justify-between rounded-md border p-3">
                        <span className="font-medium">{profile.name}</span>
                        {canEdit && <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicateClick(profile)}><Copy className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(profile)}><Edit className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive h-8 w-8" onClick={() => handleDeleteClick(profile)} disabled={profile.isDefaultAdmin}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
      
      {profileToDelete && (
          <DeleteConfirmationDialog
            open={!!profileToDelete}
            onOpenChange={() => setProfileToDelete(null)}
            onConfirm={handleDeleteConfirm}
            itemName={`o perfil "${profileToDelete?.name}"`}
        />
      )}

      <DuplicateProfileModal
        profileToDuplicate={profileToDuplicate}
        onClose={() => setProfileToDuplicate(null)}
        onConfirm={handleDuplicateConfirm}
      />
    </>
  );
}
