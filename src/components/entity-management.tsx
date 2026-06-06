

"use client"

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useEntities } from '@/hooks/use-entities';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PlusCircle, Trash2, Edit, Building, User, Phone, Mail, MapPin, Search, Eraser, Upload, Check, ChevronLeft, ChevronRight, MapPinned } from 'lucide-react';
import { type Entity } from '@/types';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { cn } from '@/lib/utils';

const entitySchema = z.object({
  type: z.enum(['pessoa_fisica', 'pessoa_juridica']),
  name: z.string().min(1, 'O nome é obrigatório.'),
  fantasyName: z.string().optional(),
  nickname: z.string().optional(),
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
  status: z.enum(['active', 'inactive']).optional(),
  rg: z.string().optional(),
  birthDate: z.string().optional(),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
}).superRefine((data, ctx) => {
    if (data.type === 'pessoa_juridica') {
        if (!data.fantasyName || data.fantasyName.trim() === '') {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Nome fantasia é obrigatório.",
                path: ['fantasyName'],
            });
        }
    } else {
       if (data.address.zipCode || data.address.street || data.address.number || data.address.neighborhood || data.address.city || data.address.state) {
            // Se um campo de endereço for preenchido, todos se tornam obrigatórios
            if (!data.address.zipCode) ctx.addIssue({ code: 'custom', message: 'CEP inválido.', path: ['address.zipCode'] });
            if (!data.address.street) ctx.addIssue({ code: 'custom', message: 'A rua é obrigatória.', path: ['address.street'] });
            if (!data.address.number) ctx.addIssue({ code: 'custom', message: 'O número é obrigatório.', path: ['address.number'] });
            if (!data.address.neighborhood) ctx.addIssue({ code: 'custom', message: 'O bairro é obrigatório.', path: ['address.neighborhood'] });
            if (!data.address.city) ctx.addIssue({ code: 'custom', message: 'A cidade é obrigatória.', path: ['address.city'] });
            if (!data.address.state) ctx.addIssue({ code: 'custom', message: 'UF inválido.', path: ['address.state'] });
       }
    }
});

type EntityFormValues = z.infer<typeof entitySchema>;

const emptyEntityFormValues: EntityFormValues = {
    type: 'pessoa_fisica',
    name: '',
    fantasyName: '',
    nickname: '',
    document: '',
    address: { zipCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '' },
    contact: { phone: '', email: '' },
    responsible: '',
    status: 'active',
    rg: '',
    birthDate: '',
    notes: '',
    imageUrl: '',
};

function getEntityFormValues(entity: Entity | null): EntityFormValues {
    if (!entity) return emptyEntityFormValues;

    const legacyEntity = entity as Entity & {
        cpf?: string;
        cnpj?: string;
        zipCode?: string;
        street?: string;
        number?: string;
        complement?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        phone?: string;
        email?: string;
    };

    return {
        type: entity.type ?? 'pessoa_fisica',
        name: entity.name ?? '',
        fantasyName: entity.fantasyName ?? '',
        nickname: entity.nickname ?? '',
        document: entity.document ?? legacyEntity.cnpj ?? legacyEntity.cpf ?? '',
        address: {
            zipCode: entity.address?.zipCode ?? legacyEntity.zipCode ?? '',
            street: entity.address?.street ?? legacyEntity.street ?? '',
            number: entity.address?.number ?? legacyEntity.number ?? '',
            complement: entity.address?.complement ?? legacyEntity.complement ?? '',
            neighborhood: entity.address?.neighborhood ?? legacyEntity.neighborhood ?? '',
            city: entity.address?.city ?? legacyEntity.city ?? '',
            state: entity.address?.state ?? legacyEntity.state ?? '',
        },
        contact: {
            phone: entity.contact?.phone ?? legacyEntity.phone ?? '',
            email: entity.contact?.email ?? legacyEntity.email ?? '',
        },
        responsible: entity.responsible ?? '',
        status: entity.status ?? 'active',
        rg: entity.rg ?? '',
        birthDate: entity.birthDate ?? '',
        notes: entity.notes ?? '',
        imageUrl: entity.imageUrl ?? '',
    };
}

/** Redimensiona/comprime um data URL para caber no Firestore (avatar). */
function compressDataUrl(dataUrl: string, maxSide = 400, quality = 0.82): Promise<string> {
    return new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    });
}

const ENTITY_WIZARD_STEPS = [
    { id: 1, label: 'Identificação', icon: User, description: 'Tipo de cadastro, foto e documento. O tipo define os campos.' },
    { id: 2, label: 'Contato e endereço', icon: MapPinned, description: 'Como falar com este cadastro e onde ele está localizado.' },
] as const;

function AddEditEntityModal({ open, onOpenChange, entityToEdit }: { open: boolean, onOpenChange: (open: boolean) => void, entityToEdit: Entity | null }) {
    const { addEntity, updateEntity } = useEntities();

    const [currentStep, setCurrentStep] = useState(1);
    const avatarInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<EntityFormValues>({
        resolver: zodResolver(entitySchema),
        defaultValues: emptyEntityFormValues,
    });

    useEffect(() => {
        if (!open) return;
        setCurrentStep(1);
        form.reset(getEntityFormValues(entityToEdit));
    }, [entityToEdit, form, open]);

    const entityType = form.watch('type');
    const statusWatch = form.watch('status') ?? 'active';
    const nameWatch = form.watch('name');
    const documentWatch = form.watch('document');
    const imageUrlWatch = form.watch('imageUrl');
    const isPF = entityType === 'pessoa_fisica';
    const initials = (nameWatch || '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase() || '—';

    const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return;
        const reader = new FileReader();
        reader.onloadend = async () => {
            const compressed = await compressDataUrl(reader.result as string);
            form.setValue('imageUrl', compressed, { shouldDirty: true });
        };
        reader.readAsDataURL(file);
    };

    const handleNext = async () => {
        const fields: (keyof EntityFormValues)[] = ['name', 'document', ...(entityType === 'pessoa_juridica' ? (['fantasyName'] as (keyof EntityFormValues)[]) : [])];
        const valid = await form.trigger(fields);
        if (valid) setCurrentStep((s) => Math.min(ENTITY_WIZARD_STEPS.length, s + 1));
    };
    const handleBack = () => setCurrentStep((s) => Math.max(1, s - 1));
    const onInvalid = () => setCurrentStep(1);

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
        const payload: Omit<Entity, 'id'> = {
            type: values.type,
            name: values.name,
            fantasyName: values.fantasyName,
            nickname: values.nickname,
            document: values.document,
            address: {
                street: values.address?.street ?? '',
                number: values.address?.number ?? '',
                complement: values.address?.complement ?? '',
                neighborhood: values.address?.neighborhood ?? '',
                city: values.address?.city ?? '',
                state: values.address?.state ?? '',
                zipCode: values.address?.zipCode ?? '',
            },
            contact: {
                phone: values.contact?.phone,
                email: values.contact?.email,
            },
            responsible: values.responsible,
            status: values.status ?? 'active',
            rg: values.type === 'pessoa_fisica' ? values.rg : undefined,
            birthDate: values.type === 'pessoa_fisica' ? values.birthDate : undefined,
            notes: values.notes,
            imageUrl: values.imageUrl,
        };

        if (entityToEdit) {
            updateEntity({ ...entityToEdit, ...payload });
        } else {
            addEntity(payload);
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden">
                {/* Header */}
                <DialogHeader className="space-y-2 border-b px-6 py-4 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
                            <User className="h-3 w-3" /> {isPF ? 'Pessoa física' : 'Pessoa jurídica'}
                        </span>
                        {documentWatch && (
                            <span className="inline-flex items-center rounded-full border bg-background px-2.5 py-0.5 font-mono text-xs text-muted-foreground">{documentWatch}</span>
                        )}
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', statusWatch === 'active' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground')}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', statusWatch === 'active' ? 'bg-green-500' : 'bg-muted-foreground')} />
                            {statusWatch === 'active' ? 'Ativo' : 'Inativo'}
                        </span>
                    </div>
                    <DialogTitle className="text-2xl font-bold">{entityToEdit ? 'Editar pessoa' : 'Novo cadastro'}</DialogTitle>
                    <DialogDescription className="text-sm">{nameWatch || 'Diretório de pessoas e empresas. Apenas dados de identidade e contato.'}</DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
                        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
                            {/* Stepper */}
                            <aside className="border-r bg-muted/40 px-5 py-6">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStep} de {ENTITY_WIZARD_STEPS.length}</p>
                                <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${(currentStep / ENTITY_WIZARD_STEPS.length) * 100}%` }} />
                                </div>
                                <nav className="space-y-1">
                                    {ENTITY_WIZARD_STEPS.map((step) => {
                                        const isActive = step.id === currentStep;
                                        const isDone = step.id < currentStep;
                                        return (
                                            <button key={step.id} type="button" onClick={() => setCurrentStep(step.id)}
                                                className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted')}>
                                                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', isActive ? 'bg-indigo-500 text-white' : isDone ? 'bg-indigo-100 text-indigo-600' : 'bg-muted text-muted-foreground')}>
                                                    {isDone ? <Check className="h-4 w-4" /> : step.id}
                                                </span>
                                                <span className="truncate">{step.label}</span>
                                            </button>
                                        );
                                    })}
                                </nav>
                                <div className="mt-8 rounded-lg border bg-background/60 p-3">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold"><User className="h-3.5 w-3.5" /> {isPF ? 'Pessoa física' : 'Pessoa jurídica'}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">Diretório de pessoas e empresas. Apenas dados de identidade e contato — sem relação com usuários do sistema.</p>
                                </div>
                            </aside>

                            {/* Content */}
                            <ScrollArea className="h-[62vh]">
                                <div className="px-6 py-6">
                                    <div className="mb-5 flex items-start justify-between gap-4">
                                        <div className="flex items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                                {React.createElement(ENTITY_WIZARD_STEPS[currentStep - 1].icon, { className: 'h-4 w-4' })}
                                            </div>
                                            <div>
                                                <h3 className="font-semibold leading-tight">{ENTITY_WIZARD_STEPS[currentStep - 1].label}</h3>
                                                <p className="text-sm text-muted-foreground">{ENTITY_WIZARD_STEPS[currentStep - 1].description}</p>
                                            </div>
                                        </div>
                                        {currentStep === 1 && (
                                            <FormField control={form.control} name="status" render={({ field }) => (
                                                <div className="flex shrink-0 overflow-hidden rounded-full border text-xs font-medium">
                                                    <button type="button" onClick={() => field.onChange('active')} className={cn('flex items-center gap-1 px-3 py-1', field.value !== 'inactive' ? 'bg-green-100 text-green-700' : 'text-muted-foreground')}>
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', field.value !== 'inactive' ? 'bg-green-500' : 'bg-muted-foreground')} /> Ativo
                                                    </button>
                                                    <button type="button" onClick={() => field.onChange('inactive')} className={cn('px-3 py-1', field.value === 'inactive' ? 'bg-muted text-foreground' : 'text-muted-foreground')}>Inativo</button>
                                                </div>
                                            )}/>
                                        )}
                                    </div>

                                    {/* STEP 1 — Identificação */}
                                    {currentStep === 1 && (
                                        <div className="space-y-5">
                                            <FormField control={form.control} name="type" render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Tipo de cadastro <span className="text-rose-500">*</span></FormLabel>
                                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                        {([
                                                            { value: 'pessoa_fisica', icon: User, title: 'Pessoa física', sub: 'Indivíduo · CPF' },
                                                            { value: 'pessoa_juridica', icon: Building, title: 'Pessoa jurídica', sub: 'Empresa · CNPJ' },
                                                        ] as const).map((opt) => {
                                                            const selected = field.value === opt.value;
                                                            return (
                                                                <button key={opt.value} type="button" onClick={() => field.onChange(opt.value)}
                                                                    className={cn('flex items-center gap-3 rounded-xl border p-3 text-left transition-colors', selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'hover:border-muted-foreground/40')}>
                                                                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', selected ? 'bg-indigo-500 text-white' : 'bg-muted text-muted-foreground')}>
                                                                        {React.createElement(opt.icon, { className: 'h-4 w-4' })}
                                                                    </span>
                                                                    <span>
                                                                        <span className="block text-sm font-semibold">{opt.title}</span>
                                                                        <span className="block text-xs text-muted-foreground">{opt.sub}</span>
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>

                                            {/* Avatar */}
                                            <div className="space-y-2">
                                                <FormLabel>Foto / avatar</FormLabel>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                                                        {imageUrlWatch ? <Image src={imageUrlWatch} alt="avatar" width={64} height={64} className="h-full w-full object-cover" /> : initials}
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <Button type="button" variant="outline" size="sm" onClick={() => avatarInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" /> Enviar foto</Button>
                                                        <span className="text-xs text-muted-foreground">JPG ou PNG · até 5MB</span>
                                                        {imageUrlWatch && <button type="button" className="text-left text-xs text-destructive" onClick={() => form.setValue('imageUrl', '', { shouldDirty: true })}>Remover foto</button>}
                                                    </div>
                                                </div>
                                                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                                            </div>

                                            <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>{isPF ? 'Nome completo' : 'Razão social'} <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>

                                            {isPF ? (
                                                <>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="document" render={({ field }) => (<FormItem><FormLabel>CPF <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="rg" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>RG</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="birthDate" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Data de nascimento</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input type="date" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="nickname" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Apelido</FormLabel><span className="text-xs text-muted-foreground">busca interna</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="document" render={({ field }) => (<FormItem><FormLabel>CNPJ <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="fantasyName" render={({ field }) => (<FormItem><FormLabel>Nome fantasia <span className="text-rose-500">*</span></FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                        <FormField control={form.control} name="responsible" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Responsável</FormLabel><span className="text-xs text-muted-foreground">opcional</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                        <FormField control={form.control} name="nickname" render={({ field }) => (<FormItem><div className="flex items-center justify-between"><FormLabel>Apelido</FormLabel><span className="text-xs text-muted-foreground">busca interna</span></div><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* STEP 2 — Contato e endereço */}
                                    {currentStep === 2 && (
                                        <div className="space-y-5">
                                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                                <FormField control={form.control} name="contact.email" render={({ field }) => (<FormItem><FormLabel>E-mail</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="contact.phone" render={({ field }) => (<FormItem><FormLabel>Telefone / WhatsApp</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                            </div>

                                            <Separator />

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr_100px]">
                                                <FormField control={form.control} name="address.zipCode" render={({ field }) => (<FormItem><FormLabel>CEP</FormLabel><FormControl><Input {...field} value={field.value ?? ''} onBlur={e => handleZipCodeBlur(e.target.value)} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.street" render={({ field }) => (<FormItem><FormLabel>Logradouro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.number" render={({ field }) => (<FormItem><FormLabel>Número</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_1fr_100px]">
                                                <FormField control={form.control} name="address.complement" render={({ field }) => (<FormItem><FormLabel>Complemento</FormLabel><FormControl><Input {...field} value={field.value ?? ''}/></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.neighborhood" render={({ field }) => (<FormItem><FormLabel>Bairro</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.city" render={({ field }) => (<FormItem><FormLabel>Cidade</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                                <FormField control={form.control} name="address.state" render={({ field }) => (<FormItem><FormLabel>UF</FormLabel><FormControl><Input maxLength={2} {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>)}/>
                                            </div>

                                            <FormField control={form.control} name="notes" render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel>Observações</FormLabel>
                                                        <span className="text-xs text-muted-foreground">opcional</span>
                                                    </div>
                                                    <FormControl><Textarea {...field} value={field.value ?? ''} placeholder="Anotações sobre este cadastro..." /></FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}/>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* Footer */}
                        <DialogFooter className="flex flex-row items-center justify-between gap-4 border-t px-6 py-4 sm:justify-between">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <div className="hidden flex-col items-center text-center sm:flex">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Etapa {currentStep} de {ENTITY_WIZARD_STEPS.length}</span>
                                <span className="text-sm font-medium">{ENTITY_WIZARD_STEPS[currentStep - 1].label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {currentStep > 1 && (<Button type="button" variant="outline" onClick={handleBack}><ChevronLeft className="mr-1 h-4 w-4" /> Voltar</Button>)}
                                {currentStep < ENTITY_WIZARD_STEPS.length ? (
                                    <Button type="button" className="bg-indigo-500 hover:bg-indigo-600" onClick={handleNext}>Avançar <ChevronRight className="ml-1 h-4 w-4" /></Button>
                                ) : (
                                    <Button type="submit" className="bg-indigo-500 hover:bg-indigo-600">{entityToEdit ? 'Salvar alterações' : 'Adicionar'}</Button>
                                )}
                            </div>
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
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const filteredEntities = useMemo(() => {
    return entities.filter(entity => {
      const search = searchTerm.toLowerCase();
      const typeMatch = typeFilter === 'all' || entity.type === typeFilter;
      const searchMatch = entity.name.toLowerCase().includes(search) ||
                          (entity.fantasyName && entity.fantasyName.toLowerCase().includes(search)) ||
                          (entity.nickname && entity.nickname.toLowerCase().includes(search)) ||
                          (entity.document ?? '').includes(search);
      
      return typeMatch && searchMatch;
    });
  }, [entities, searchTerm, typeFilter]);

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
          <CardTitle>Pessoas e empresas</CardTitle>
          <CardDescription>Gerencie seus contatos, clientes e fornecedores.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Button onClick={handleAddNew} className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar novo cadastro
           </Button>

            <div className="flex flex-col sm:flex-row items-center gap-2 mt-4 p-3 border rounded-lg bg-muted/50">
                <div className="relative flex-grow w-full">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nome, fantasia ou documento..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full"
                    />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Filtrar por tipo" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os tipos</SelectItem>
                        <SelectItem value="pessoa_fisica">Pessoa física</SelectItem>
                        <SelectItem value="pessoa_juridica">Pessoa jurídica</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="ghost" onClick={() => { setSearchTerm(''); setTypeFilter('all'); }}>
                    <Eraser className="mr-2 h-4 w-4" />
                    Limpar
                </Button>
            </div>
           
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome / Razão social</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Documento</TableHead>
                            <TableHead>Contato</TableHead>
                            <TableHead>Cidade/UF</TableHead>
                            <TableHead className="w-24 text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            [...Array(5)].map((_, index) => (
                                <TableRow key={index}>
                                    <TableCell colSpan={6}><Skeleton className="h-10 w-full" /></TableCell>
                                </TableRow>
                            ))
                        ) : filteredEntities.length > 0 ? (
                            filteredEntities.map(entity => (
                                <TableRow key={entity.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                                                {entity.type === 'pessoa_juridica' ? <Building className="h-4 w-4" /> : <User className="h-4 w-4" />}
                                            </div>
                                            <div>
                                                <p className="font-semibold">{entity.fantasyName || entity.name}</p>
                                                {entity.fantasyName ? <p className="text-xs text-muted-foreground">{entity.name}</p> : null}
                                                {entity.nickname ? (
                                                    <Badge variant="secondary" className="mt-1 rounded-md px-1.5 py-0 text-[10px] font-medium">
                                                        {entity.nickname}
                                                    </Badge>
                                                ) : null}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {entity.type === 'pessoa_juridica' ? 'Pessoa jurídica' : 'Pessoa física'}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{entity.document}</TableCell>
                                    <TableCell>
                                        <div className="space-y-1 text-xs text-muted-foreground">
                                            {entity.contact?.email ? <p className="flex items-center gap-1"><Mail className="h-3 w-3" />{entity.contact.email}</p> : null}
                                            {entity.contact?.phone ? <p className="flex items-center gap-1"><Phone className="h-3 w-3" />{entity.contact.phone}</p> : null}
                                            {!entity.contact?.email && !entity.contact?.phone ? '-' : null}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {entity.address?.city ? (
                                            <span className="flex items-center gap-1 text-sm">
                                                <MapPin className="h-3 w-3 text-muted-foreground" />
                                                {entity.address.city}{entity.address.state ? `/${entity.address.state}` : ''}
                                            </span>
                                        ) : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(entity)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(entity)}><Trash2 className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                                    Nenhum cadastro encontrado.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
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
