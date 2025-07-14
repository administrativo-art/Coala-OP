

"use client"

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useEntities } from '@/hooks/use-entities';
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PlusCircle, Trash2, Edit, Building, User, Phone, Mail, MapPin } from 'lucide-react';
import { type Entity } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from './ui/scroll-area';

const entitySchema = z.object({
  type: z.enum(['pessoa_fisica', 'pessoa_juridica']),
  name: z.string().min(1, 'O nome é obrigatório.'),
  fantasyName: z.string().optional(),
  document: z.string().min(1, 'O documento é obrigatório.'),
  address: z.object({
    zipCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }),
  contact: z.object({
    phone: z.string().optional(),
    email: z.string().email('E-mail inválido.').or(z.literal('')).optional(),
  }),
  responsible: z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.type === 'pessoa_juridica') {
        if (!data.fantasyName || data.fantasyName.trim() === '') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Nome fantasia é obrigatório.",
                path: ['fantasyName'],
            });
        }
    }

    if (data.type === 'pessoa_fisica') {
        if(!data.address.zipCode || data.address.zipCode.length < 8) {
            ctx.addIssue({ code: 'custom', message: 'CEP inválido.', path: ['address.zipCode'] });
        }
        if(!data.address.street) {
             ctx.addIssue({ code: 'custom', message: 'A rua é obrigatória.', path: ['address.street'] });
        }
         if(!data.address.number) {
             ctx.addIssue({ code: 'custom', message: 'O número é obrigatório.', path: ['address.number'] });
        }
         if(!data.address.neighborhood) {
             ctx.addIssue({ code: 'custom', message: 'O bairro é obrigatório.', path: ['address.neighborhood'] });
        }
         if(!data.address.city) {
             ctx.addIssue({ code: 'custom', message: 'A cidade é obrigatória.', path: ['address.city'] });
        }
        if(!data.address.state || data.address.state.length !== 2) {
             ctx.addIssue({ code: 'custom', message: 'UF inválido.', path: ['address.state'] });
        }
    }
});

type EntityFormValues = z.infer<typeof entitySchema>;

function AddEditEntityModal({ open, onOpenChange, entityToEdit }: { open: boolean, onOpenChange: (open: boolean) => void, entityToEdit: Entity | null }) {
    const { addEntity, updateEntity } = useEntities();

    const form = useForm<EntityFormValues>({
        resolver: zodResolver(entitySchema),
        defaultValues: entityToEdit ? {
            ...entityToEdit,
            contact: {
                phone: entityToEdit.contact?.phone || '',
                email: entityToEdit.contact?.email || '',
            },
        } : {
            type: 'pessoa_fisica',
            name: '',
            fantasyName: '',
            document: '',
            address: { zipCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' },
            contact: { phone: '', email: '' },
            responsible: '',
        }
    });
    
    const entityType = form.watch('type');

    const handleZipCodeBlur = async (zipCode: string) => {
        const numericZipCode = zipCode.replace(/\D/g, '');
        if(numericZipCode.length !== 8) return;
        try {
            const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${numericZipCode}`);
            if (!res.ok) {
                throw new Error('Falha ao buscar CEP');
            }
            const data = await res.json();
            if(!data.erro) {
                form.setValue('address.street', data.street);
                form.setValue('address.neighborhood', data.neighborhood);
                form.setValue('address.city', data.city);
                form.setValue('address.state', data.state);
            }
        } catch (error) {
            console.error("Failed to fetch address from CEP", error);
        }
    };

    const onSubmit = (values: EntityFormValues) => {
        if (entityToEdit) {
            updateEntity({ ...entityToEdit, ...values });
        } else {
            addEntity(values);
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{entityToEdit ? 'Editar Cadastro' : 'Novo Cadastro'}</DialogTitle>
                    <DialogDescription>{entityToEdit ? 'Edite as informações abaixo.' : 'Crie um novo cadastro de pessoa física ou jurídica.'}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 flex-1 overflow-hidden flex flex-col">
                        <ScrollArea className="flex-1 pr-6">
                            <div className="space-y-4">
                                <FormField control={form.control} name="type" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tipo de Cadastro</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                        <SelectContent><SelectItem value="pessoa_fisica">Pessoa Física</SelectItem><SelectItem value="pessoa_juridica">Pessoa Jurídica</SelectItem></SelectContent>
                                        </Select><FormMessage />
                                    </FormItem>
                                )}/>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Nome Completo / Razão Social</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                    {entityType === 'pessoa_juridica' ? (
                                        <FormField control={form.control} name="fantasyName" render={({ field }) => (<FormItem><FormLabel>Nome Fantasia</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                    ) : (
                                        <FormField control={form.control} name="document" render={({ field }) => (<FormItem><FormLabel>CPF</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                    )}
                                </div>
                                {entityType === 'pessoa_juridica' && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField control={form.control} name="document" render={({ field }) => (<FormItem><FormLabel>CNPJ</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                        <FormField control={form.control} name="responsible" render={({ field }) => (<FormItem><FormLabel>Responsável (opcional)</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                    </div>
                                )}

                                <h3 className="text-md font-medium border-t pt-4">Endereço (opcional para empresas)</h3>
                                <div className="grid grid-cols-3 gap-4">
                                     <FormField control={form.control} name="address.zipCode" render={({ field }) => (<FormItem><FormLabel>CEP</FormLabel><FormControl><Input {...field} value={field.value ?? ''} onBlur={e => handleZipCodeBlur(e.target.value)} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                <div className="grid grid-cols-[2fr_1fr] gap-4">
                                     <FormField control={form.control} name="address.street" render={({ field }) => (<FormItem><FormLabel>Rua</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                     <FormField control={form.control} name="address.number" render={({ field }) => (<FormItem><FormLabel>Número</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="address.complement" render={({ field }) => (<FormItem><FormLabel>Complemento</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="address.neighborhood" render={({ field }) => (<FormItem><FormLabel>Bairro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                                 <div className="grid grid-cols-[2fr_1fr] gap-4">
                                    <FormField control={form.control} name="address.city" render={({ field }) => (<FormItem><FormLabel>Cidade</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="address.state" render={({ field }) => (<FormItem><FormLabel>Estado (UF)</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                </div>

                                <h3 className="text-md font-medium border-t pt-4">Contato (opcional)</h3>
                                 <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="contact.phone" render={({ field }) => (<FormItem><FormLabel>Telefone</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                    <FormField control={form.control} name="contact.email" render={({ field }) => (<FormItem><FormLabel>E-mail</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                </div>
                            </div>
                        </ScrollArea>
                        <DialogFooter className="pt-4 border-t mt-auto">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="submit">{entityToEdit ? 'Salvar Alterações' : 'Adicionar'}</Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}


export function EntityManagement() {
  const { entities, loading, deleteEntity } = useEntities();
  const [entityToDelete, setEntityToDelete] = useState<Entity | null>(null);
  const [entityToEdit, setEntityToEdit] = useState<Entity | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleDeleteClick = (entity: Entity) => {
    setEntityToDelete(entity);
  };

  const handleDeleteConfirm = async () => {
    if (entityToDelete) {
      await deleteEntity(entityToDelete.id);
      setEntityToDelete(null);
    }
  };

  const handleAddNew = () => {
    setEntityToEdit(null);
    setIsModalOpen(true);
  };

  const handleEdit = (entity: Entity) => {
    setEntityToEdit(entity);
    setIsModalOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Pessoas e Empresas</CardTitle>
          <CardDescription>Gerencie seus contatos, clientes e fornecedores.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Button onClick={handleAddNew} className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Novo Cadastro
           </Button>
           
            <div className="space-y-2 pt-4 border-t">
                {loading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                ) : entities.length > 0 ? (
                    entities.map(entity => (
                        <div key={entity.id} className="p-3 border rounded-lg flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                {entity.type === 'pessoa_juridica' ? <Building className="h-6 w-6 text-primary"/> : <User className="h-6 w-6 text-primary"/>}
                                <div>
                                    <p className="font-semibold">{entity.fantasyName || entity.name}</p>
                                    <p className="text-sm text-muted-foreground">{entity.document}</p>
                                </div>
                            </div>
                            <div className="flex items-center shrink-0">
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(entity)}><Edit className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(entity)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center text-muted-foreground py-8 border-2 border-dashed rounded-lg">
                        <User className="mx-auto h-10 w-10 mb-2" />
                        <p className="font-semibold">Nenhum cadastro encontrado.</p>
                        <p className="text-sm">Clique no botão acima para adicionar.</p>
                    </div>
                )}
            </div>
        </CardContent>
      </Card>

      <AddEditEntityModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        entityToEdit={entityToEdit}
      />

      {entityToDelete && (
        <DeleteConfirmationDialog
          open={!!entityToDelete}
          onOpenChange={() => setEntityToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o cadastro de "${entityToDelete.name}"`}
        />
      )}
    </>
  );
}
