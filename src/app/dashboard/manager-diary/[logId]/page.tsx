
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parseISO, isValid } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuthorBoardDiary } from '@/hooks/use-author-board-diary';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PlusCircle, Edit, Trash2, Calendar, User, Warehouse, Clock, MessageSquare, AlertCircle, Save, Send, ArrowLeft, Info, Activity as ActivityIcon, Check, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { type DailyLog, type DiaryActivity } from '@/types';
import { useDebounce } from 'use-debounce';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';

// Zod Schemas
const occurrenceSchema = z.object({
  id: z.string(),
  description: z.string().min(1, 'A descrição é obrigatória.'),
  identifiedCause: z.string().optional(),
  actionTaken: z.string().optional(),
  result: z.string().optional(),
  requiresEscalation: z.boolean().default(false),
  escalatedTo: z.string().optional(),
});

const activitySchema = z.object({
  id: z.string(),
  kioskId: z.string().min(1, "Selecione uma unidade."),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato inválido."),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato inválido."),
  durationMinutes: z.number().default(0),
  title: z.string().min(1, 'O título é obrigatório.'),
  description: z.string().optional(),
  occurrences: z.array(occurrenceSchema),
});

const rejectionSchema = z.object({
    rejectionNotes: z.string().min(10, "A justificativa para rejeição deve ter pelo menos 10 caracteres."),
});

const diaryFormSchema = z.object({
  activities: z.array(activitySchema),
});

type DiaryFormValues = z.infer<typeof diaryFormSchema>;

const getStatusBadge = (status: DailyLog['status']) => {
    switch (status) {
        case 'draft': return <Badge variant="outline">Rascunho</Badge>;
        case 'submitted': return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Pendente de Validação</Badge>;
        case 'validated': return <Badge className="bg-green-100 text-green-800">Validado</Badge>;
        case 'aberto': return <Badge variant="outline">Aberto</Badge>;
        case 'em andamento': return <Badge variant="secondary" className="bg-blue-100 text-blue-800">Em Andamento</Badge>;
        case 'finalizado': return <Badge className="bg-green-100 text-green-800">Finalizado</Badge>;
        default: return <Badge variant="secondary">{status}</Badge>;
    }
}

export default function EditDiaryPage() {
    const params = useParams();
    const router = useRouter();
    const { logId } = params;
    
    const { user, permissions } = useAuth();
    const { kiosks } = useKiosks();
    const { getLogById, updateLog, loading } = useAuthorBoardDiary();
    const { toast } = useToast();

    const [logEntry, setLogEntry] = useState<DailyLog | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isRejectionModalOpen, setRejectionModalOpen] = useState(false);
    const [rejectionNotes, setRejectionNotes] = useState('');
    const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);

    const form = useForm<DiaryFormValues>({
        resolver: zodResolver(diaryFormSchema),
        defaultValues: { activities: [] }
    });
    
    const { fields: activityFields, append: appendActivity, remove: removeActivity, replace } = useFieldArray({
        control: form.control,
        name: "activities",
    });

    const [debouncedFormValues] = useDebounce(form.watch(), 2000);

    const calculateDuration = (startTime: string, endTime: string): number => {
        try {
            const start = parseISO(`1970-01-01T${startTime}:00`);
            const end = parseISO(`1970-01-01T${endTime}:00`);
            if (!isValid(start) || !isValid(end) || end < start) return 0;
            return (end.getTime() - start.getTime()) / (1000 * 60);
        } catch {
            return 0;
        }
    };
    
    useEffect(() => {
        const entry = getLogById(logId as string);
        if (entry) {
            setLogEntry(entry);
            const canEdit = (entry.status === 'draft' || entry.status === 'em andamento') && permissions.authorBoardDiary.create;
            setIsEditing(canEdit);
            
            replace(entry.activities || []);
        }
    }, [logId, getLogById, replace, permissions.authorBoardDiary.create]);
    
    const getPayload = (): Partial<DailyLog> => {
        const values = form.getValues();
        const sortedAndUpdatedActivities = [...values.activities]
            .sort((a,b) => a.startTime.localeCompare(b.startTime))
            .map(act => ({
                ...act,
                durationMinutes: calculateDuration(act.startTime, act.endTime)
            }));
        const totalDuration = sortedAndUpdatedActivities.reduce((sum, act) => sum + (act.durationMinutes || 0), 0);

        return {
            activities: sortedAndUpdatedActivities,
            totalActivities: sortedAndUpdatedActivities.length,
            totalDurationMinutes: totalDuration,
        };
    };

    const handleAddNewActivity = useCallback(() => {
        const newActivityId = `act-${Date.now()}`;
        appendActivity({ id: newActivityId, kioskId: '', startTime: '08:00', endTime: '09:00', title: '', description: '', occurrences: [], durationMinutes: 60 });
        setOpenAccordionItems(prev => [...prev, newActivityId]);
    }, [appendActivity]);

    const handleSubmitForValidation = async () => {
        if (!logEntry) return;
        const payload = getPayload();
        await updateLog(logEntry.id, { ...payload, status: 'submitted' });
        toast({ title: 'Diário enviado para validação!' });
        router.push('/dashboard/manager-diary');
    };
    
    const handleApprove = async () => {
        if (!logEntry) return;
        const payload = getPayload();
        await updateLog(logEntry.id, { ...payload, status: 'validated' });
        toast({ title: 'Diário validado com sucesso!' });
        router.push('/dashboard/manager-diary');
    };

    const handleReject = async () => {
        if (!logEntry || !rejectionNotes) return;
        await updateLog(logEntry.id, { 
            status: 'draft',
            notes: `Rejeitado por: ${user?.username}. Motivo: ${rejectionNotes}`
        });
        toast({ title: 'Diário rejeitado e devolvido para o autor.' });
        setRejectionModalOpen(false);
        router.push('/dashboard/manager-diary');
    };
    
    // Auto-save effect
    useEffect(() => {
        if (logEntry && (logEntry.status === 'draft' || logEntry.status === 'em andamento') && form.formState.isDirty && isEditing) {
            const payload: Partial<DailyLog> = {
                ...getPayload(),
                status: 'em andamento',
            };
            updateLog(logEntry.id, payload);
        }
    }, [debouncedFormValues, logEntry, isEditing]);


    if (loading) {
        return <Skeleton className="h-screen w-full" />
    }

    if (!logEntry) {
        return <div className="text-center p-8">Registro não encontrado.</div>;
    }
    
    const isLocked = logEntry.status === 'submitted' || logEntry.status === 'validated';
    const canValidate = permissions.authorBoardDiary.validate && logEntry.status === 'submitted';
    const canSubmit = (logEntry.status === 'draft' || logEntry.status === 'em andamento') && permissions.authorBoardDiary.create;

    return (
        <div className="space-y-6">
            <Button variant="outline" onClick={() => router.push('/dashboard/manager-diary')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para o histórico
            </Button>
            
            <Card>
                 <CardHeader>
                    <div className="flex justify-between items-start">
                        <div>
                            <CardTitle>Diário de {format(parseISO(logEntry.logDate), 'dd/MM/yyyy')}</CardTitle>
                             <CardDescription>
                                {isLocked ? "Este registro está bloqueado." : "As alterações são salvas automaticamente."}
                            </CardDescription>
                        </div>
                        <div className="text-right">
                             {getStatusBadge(logEntry.status)}
                             <p className="text-sm text-muted-foreground mt-1">
                                <strong>Total:</strong> {(logEntry.totalDurationMinutes || 0) > 60 ? `${Math.floor((logEntry.totalDurationMinutes || 0)/60)}h ${ (logEntry.totalDurationMinutes || 0)%60}min` : `${logEntry.totalDurationMinutes || 0} min`}
                            </p>
                        </div>
                    </div>
                </CardHeader>
            </Card>
            
             {logEntry.notes && (
                <Card className="bg-yellow-50 border-yellow-200">
                    <CardHeader>
                        <CardTitle className="text-yellow-800 text-lg">Notas da Rejeição</CardTitle>
                        <CardDescription className="text-yellow-700">{logEntry.notes}</CardDescription>
                    </CardHeader>
                </Card>
            )}

            <Form {...form}>
                <form className="space-y-6">
                     <Card>
                        <CardHeader>
                            <CardTitle className="flex justify-between items-center text-xl">
                                <div className="flex items-center gap-2">
                                    <ActivityIcon className="h-6 w-6"/>
                                    <span>Atividades ({activityFields.length})</span>
                                </div>
                                {isEditing && (
                                    <Button type="button" size="sm" onClick={handleAddNewActivity}>
                                        <PlusCircle className="mr-2 h-4 w-4"/> Nova Atividade
                                    </Button>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Accordion 
                                type="multiple" 
                                className="w-full space-y-3"
                                value={openAccordionItems}
                                onValueChange={setOpenAccordionItems}
                            >
                                {activityFields.map((field, index) => (
                                    <ActivityItem key={field.id} activityIndex={index} control={form.control} removeActivity={removeActivity} kiosks={kiosks} isFinalized={!isEditing} />
                                ))}
                                {activityFields.length === 0 && (
                                    <div className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">
                                        Nenhuma atividade adicionada ainda.
                                    </div>
                                )}
                            </Accordion>
                        </CardContent>
                     </Card>
                     
                     <div className="flex justify-end gap-2 sticky bottom-0 py-4 bg-background z-10">
                        {canSubmit && (
                             <Button type="button" onClick={handleSubmitForValidation}><Send className="mr-2"/> Enviar para Validação</Button>
                        )}
                        {canValidate && (
                            <>
                                <Button type="button" variant="destructive" onClick={() => setRejectionModalOpen(true)}><X className="mr-2"/> Rejeitar</Button>
                                <Button type="button" onClick={handleApprove}><Check className="mr-2"/> Validar Diário</Button>
                            </>
                        )}
                    </div>
                </form>
            </Form>
            
            <DeleteConfirmationDialog
                open={isRejectionModalOpen}
                onOpenChange={setRejectionModalOpen}
                onConfirm={handleReject}
                title="Rejeitar diário?"
                description={<Textarea placeholder="Descreva o motivo da rejeição aqui..." value={rejectionNotes} onChange={(e) => setRejectionNotes(e.target.value)} />}
                confirmButtonText="Confirmar rejeição"
                confirmButtonVariant="destructive"
            />
        </div>
    );
}

function OccurrenceItem({ activityIndex, occurrenceIndex, control, removeOccurrence, isFinalized }: { activityIndex: number, occurrenceIndex: number, control: any, removeOccurrence: (index: number) => void, isFinalized: boolean }) {
    const escalationWatch = useWatch({ control, name: `activities.${activityIndex}.occurrences.${occurrenceIndex}.requiresEscalation` });

    return (
        <div className="p-4 border rounded-lg bg-background/50 relative space-y-4">
             <div className="absolute top-2 right-2">
                {!isFinalized && (
                    <Button type="button" variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => removeOccurrence(occurrenceIndex)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>
            
            <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.description`} render={({ field }) => ( <FormItem><FormLabel>Descrição da ocorrência</FormLabel><Textarea {...field} disabled={isFinalized} placeholder="Ex: Cliente reclamou de produto vencido." /></FormItem> )}/>
            <div className="grid md:grid-cols-2 gap-4">
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.identifiedCause`} render={({ field }) => ( <FormItem><FormLabel>Causa identificada</FormLabel><Input {...field} disabled={isFinalized} placeholder="Ex: Falha na verificação de validade." /></FormItem> )}/>
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.actionTaken`} render={({ field }) => ( <FormItem><FormLabel>Ação tomada</FormLabel><Input {...field} disabled={isFinalized} placeholder="Ex: Produto substituído e lote retirado."/></FormItem> )}/>
            </div>
            <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.result`} render={({ field }) => ( <FormItem><FormLabel>Resultado</FormLabel><Input {...field} disabled={isFinalized} placeholder="Ex: Cliente satisfeito."/></FormItem> )}/>
            
            <FormField
                control={control}
                name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.requiresEscalation`}
                render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="flex items-center gap-2">
                            <FormLabel>Requer escalonamento?</FormLabel>
                            <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger type="button" onClick={e => e.preventDefault()}>
                                    <Info className="h-4 w-4 text-muted-foreground"/>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p className="max-w-xs">Marque esta opção se a ocorrência precisa da atenção de um gestor ou de outro setor para ser resolvida.</p>
                                </TooltipContent>
                            </Tooltip>
                            </TooltipProvider>
                        </div>
                        <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isFinalized} />
                        </FormControl>
                    </FormItem>
                )}
            />
             {escalationWatch && (
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.escalatedTo`} render={({ field }) => ( <FormItem><FormLabel>Escalonado para</FormLabel><Input {...field} disabled={isFinalized} placeholder="Nome do gerente ou setor" /></FormItem> )}/>
             )}
        </div>
    )
}


function ActivityItem({ activityIndex, control, removeActivity, kiosks, isFinalized }: { activityIndex: number; control: any; removeActivity: (index: number) => void; kiosks: any[]; isFinalized: boolean }) {
    const activity = useWatch({ control, name: `activities.${activityIndex}` });
    
    const { fields, append, remove } = useFieldArray({
        control,
        name: `activities.${activityIndex}.occurrences`,
    });

    const duration = useMemo(() => {
        try {
            if (!activity || !activity.startTime || !activity.endTime) return '00:00';
            const start = parseISO(`1970-01-01T${activity.startTime}:00`);
            const end = parseISO(`1970-01-01T${activity.endTime}:00`);
            if (!isValid(start) || !isValid(end) || end < start) return '00:00';
            const diff = (end.getTime() - start.getTime()) / (1000 * 60);
            const hours = Math.floor(diff / 60).toString().padStart(2, '0');
            const minutes = (diff % 60).toString().padStart(2, '0');
            return `${hours}h ${minutes}min`;
        } catch { return '00:00'; }
    }, [activity?.startTime, activity?.endTime]);
    
    if (!activity) {
        return null; 
    }

    return (
        <AccordionItem value={activity.id} className="border rounded-lg bg-muted/30">
            <div className="flex items-center p-2 pr-4">
                <AccordionTrigger className="p-2 text-left hover:no-underline w-full flex-grow">
                    <div className="space-y-1">
                        <p className="font-semibold text-base">{activity.title || 'Nova Atividade'}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4"/> {duration}</p>
                    </div>
                </AccordionTrigger>
                {!isFinalized && 
                    <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8 shrink-0" onClick={() => removeActivity(activityIndex)}>
                        <Trash2 className="h-4 w-4"/>
                    </Button>
                }
            </div>
            <AccordionContent className="p-4 pt-0">
                <div className="space-y-6">
                    <FormField control={control} name={`activities.${activityIndex}.title`} render={({ field }) => ( <FormItem><FormLabel>Título</FormLabel><Input {...field} disabled={isFinalized} /></FormItem> )} />
                    <div className="grid md:grid-cols-3 gap-4">
                        <FormField control={control} name={`activities.${activityIndex}.kioskId`} render={({ field }) => (
                            <FormItem><FormLabel>Unidade</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={isFinalized}>
                                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                    <SelectContent>{kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                                </Select><FormMessage />
                            </FormItem>
                        )}/>
                        <FormField control={control} name={`activities.${activityIndex}.startTime`} render={({ field }) => ( <FormItem><FormLabel>Início</FormLabel><Input type="time" {...field} disabled={isFinalized} /></FormItem> )} />
                        <FormField control={control} name={`activities.${activityIndex}.endTime`} render={({ field }) => ( <FormItem><FormLabel>Fim</FormLabel><Input type="time" {...field} disabled={isFinalized} /></FormItem> )} />
                    </div>
                    <FormField control={control} name={`activities.${activityIndex}.description`} render={({ field }) => ( <FormItem><FormLabel>Descrição</FormLabel><Textarea {...field} placeholder="Detalhes da atividade..." disabled={isFinalized} /></FormItem> )} />

                     <div className="space-y-3 pt-4 border-t">
                        <Accordion type="multiple" className="w-full">
                            <AccordionItem value="ocorrencias" className="border-none">
                                <AccordionTrigger className="p-2 -mx-2 hover:no-underline font-medium text-base">
                                     Ocorrências ({fields.length})
                                </AccordionTrigger>
                                <AccordionContent className="pt-2">
                                     <div className="space-y-4">
                                        {fields.map((field, index) => (
                                            <OccurrenceItem 
                                                key={field.id}
                                                activityIndex={activityIndex}
                                                occurrenceIndex={index}
                                                control={control}
                                                removeOccurrence={remove}
                                                isFinalized={isFinalized}
                                            />
                                        ))}
                                        {!isFinalized && (
                                            <Button type="button" variant="outline" size="sm" onClick={() => append({ id: `occ-${Date.now()}`, description: '', identifiedCause: '', actionTaken: '', result: '', escalatedTo: '', requiresEscalation: false })}>
                                                <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Ocorrência
                                            </Button>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                </div>
            </AccordionContent>
        </AccordionItem>
    );
}

    
