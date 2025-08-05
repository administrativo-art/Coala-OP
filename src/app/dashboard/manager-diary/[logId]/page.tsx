
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parse, isValid, parseISO } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuthorBoardDiary } from '@/hooks/use-author-board-diary';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, Edit, Trash2, Calendar, User, Warehouse, Clock, MessageSquare, AlertCircle, Save, Send, ArrowLeft, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { type DailyLog, type DiaryActivity } from '@/types';
import { useDebounce } from 'use-debounce';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

const diaryFormSchema = z.object({
  activities: z.array(activitySchema),
});

type DiaryFormValues = z.infer<typeof diaryFormSchema>;

export default function EditDiaryPage() {
    const params = useParams();
    const router = useRouter();
    const { logId } = params;
    
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const { getLogById, updateLog, loading } = useAuthorBoardDiary();
    const { toast } = useToast();

    const [logEntry, setLogEntry] = useState<DailyLog | null>(null);

    const form = useForm<DiaryFormValues>({
        resolver: zodResolver(diaryFormSchema),
        defaultValues: { activities: [] }
    });
    
    const { fields: activityFields, append: appendActivity, remove: removeActivity } = useFieldArray({
        control: form.control,
        name: "activities",
    });

    const [debouncedFormValues] = useDebounce(form.watch(), 2000);

    useEffect(() => {
        const entry = getLogById(logId as string);
        if (entry) {
            setLogEntry(entry);
            form.reset({
                activities: entry.activities || [],
            });
        }
    }, [logId, getLogById, form]);

    const calculateDuration = (startTime: string, endTime: string) => {
        try {
            const start = parse(startTime, 'HH:mm', new Date());
            const end = parse(endTime, 'HH:mm', new Date());
            if (!isValid(start) || !isValid(end) || end < start) return 0;
            return (end.getTime() - start.getTime()) / (1000 * 60);
        } catch {
            return 0;
        }
    };
    
    const onFinalize = async () => {
        if (!logEntry) return;

        const values = form.getValues();
        
        const sortedAndUpdatedActivities = [...values.activities]
            .sort((a,b) => a.startTime.localeCompare(b.startTime))
            .map(act => ({
                ...act,
                durationMinutes: calculateDuration(act.startTime, act.endTime)
            }));

        const totalDuration = sortedAndUpdatedActivities.reduce((sum, act) => sum + act.durationMinutes, 0);

        const payload: Partial<DailyLog> = {
            activities: sortedAndUpdatedActivities,
            status: 'finalizado',
            totalActivities: sortedAndUpdatedActivities.length,
            totalDurationMinutes: totalDuration,
        };
        
        await updateLog(logEntry.id, payload);
        toast({ title: 'Diário finalizado com sucesso!' });
        router.push('/dashboard/manager-diary');
    };

    // Auto-save effect
    useEffect(() => {
        if (logEntry && logEntry.status !== 'finalizado' && form.formState.isDirty) {
            const values = form.getValues();
            const updatedActivities = values.activities.map(act => ({
                ...act,
                durationMinutes: calculateDuration(act.startTime, act.endTime)
            }));
            const payload: Partial<DailyLog> = {
                activities: updatedActivities,
                status: 'em andamento', // Always save as 'in progress'
            };
            updateLog(logEntry.id, payload);
            form.reset(values); // Reset dirty state
        }
    }, [debouncedFormValues, logEntry, form, updateLog]);


    if (loading) {
        return <Skeleton className="h-screen w-full" />
    }

    if (!logEntry) {
        return <div className="text-center p-8">Registro não encontrado.</div>;
    }
    
    const isFinalized = logEntry.status === 'finalizado';

    return (
        <div className="space-y-6">
            <Button variant="outline" onClick={() => router.push('/dashboard/manager-diary')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para o histórico
            </Button>
            <Card>
                <CardHeader>
                    <CardTitle>Diário de {format(parseISO(logEntry.logDate), 'dd/MM/yyyy', { timeZone: 'UTC' })}</CardTitle>
                     <CardDescription>
                        {isFinalized 
                            ? "Este registro foi finalizado e não pode ser alterado." 
                            : "As alterações são salvas automaticamente. Clique em 'Finalizar' ao concluir."
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form className="space-y-6">
                             <Card>
                                <CardHeader>
                                    <CardTitle className="flex justify-between items-center">
                                        <span>Atividades ({activityFields.length})</span>
                                        {!isFinalized && (
                                            <Button type="button" size="sm" onClick={() => appendActivity({ id: `act-${Date.now()}`, kioskId: '', startTime: '08:00', endTime: '09:00', title: '', description: '', occurrences: [], durationMinutes: 60 })}>
                                                <PlusCircle className="mr-2 h-4 w-4"/> Nova Atividade
                                            </Button>
                                        )}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Accordion type="multiple" className="w-full space-y-3">
                                        {activityFields.map((field, index) => (
                                            <ActivityItem key={field.id} activityIndex={index} control={form.control} removeActivity={removeActivity} kiosks={kiosks} isFinalized={isFinalized} />
                                        ))}
                                    </Accordion>
                                </CardContent>
                             </Card>
                             
                             {!isFinalized && (
                                <div className="flex justify-end gap-2 sticky bottom-0 py-4 bg-background">
                                    <Button type="button" onClick={onFinalize}><Send className="mr-2"/> Finalizar Registro</Button>
                                </div>
                             )}
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}

function OccurrenceItem({ activityIndex, occurrenceIndex, control, removeOccurrence, isFinalized }: { activityIndex: number, occurrenceIndex: number, control: any, removeOccurrence: (index: number) => void, isFinalized: boolean }) {
    const escalationWatch = useWatch({ control, name: `activities.${activityIndex}.occurrences.${occurrenceIndex}.requiresEscalation` });

    return (
        <div className="p-3 border rounded-lg bg-background/50 relative">
             <div className="absolute top-1 right-1">
                {!isFinalized && (
                    <Button type="button" variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => removeOccurrence(occurrenceIndex)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>
            <div className="space-y-3">
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.description`} render={({ field }) => ( <FormItem><FormLabel>Descrição da ocorrência</FormLabel><Textarea {...field} disabled={isFinalized} placeholder="Ex: Cliente reclamou de produto vencido." /></FormItem> )}/>
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.identifiedCause`} render={({ field }) => ( <FormItem><FormLabel>Causa identificada</FormLabel><Input {...field} disabled={isFinalized} placeholder="Ex: Falha na verificação de validade." /></FormItem> )}/>
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.actionTaken`} render={({ field }) => ( <FormItem><FormLabel>Ação tomada</FormLabel><Input {...field} disabled={isFinalized} placeholder="Ex: Produto substituído e lote retirado."/></FormItem> )}/>
                <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.result`} render={({ field }) => ( <FormItem><FormLabel>Resultado</FormLabel><Input {...field} disabled={isFinalized} placeholder="Ex: Cliente satisfeito."/></FormItem> )}/>
                <FormField
                    control={control}
                    name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.requiresEscalation`}
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
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
            const start = parse(activity.startTime, 'HH:mm', new Date());
            const end = parse(activity.endTime, 'HH:mm', new Date());
            if (!isValid(start) || !isValid(end) || end < start) return '00:00';
            const diff = (end.getTime() - start.getTime()) / (1000 * 60);
            const hours = Math.floor(diff / 60).toString().padStart(2, '0');
            const minutes = (diff % 60).toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch { return '00:00'; }
    }, [activity?.startTime, activity?.endTime]);
    
    if (!activity) {
        return null; 
    }

    return (
        <AccordionItem value={activity.id} className="border rounded-lg">
            <Card>
                <div className="flex items-center p-2 pr-4">
                    <AccordionTrigger className="p-2 text-left hover:no-underline w-full flex-grow">
                        <div className="space-y-1">
                            <p className="font-semibold">{activity.title || 'Nova Atividade'}</p>
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
                    <div className="space-y-4">
                        <FormField control={control} name={`activities.${activityIndex}.title`} render={({ field }) => ( <FormItem><FormLabel>Título</FormLabel><Input {...field} disabled={isFinalized} /></FormItem> )} />
                        <div className="grid grid-cols-3 gap-4">
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
                            <div className="flex justify-between items-center">
                                <h4 className="font-medium">Ocorrências ({fields.length})</h4>
                                {!isFinalized && (
                                    <Button type="button" variant="outline" size="sm" onClick={() => append({ id: `occ-${Date.now()}`, description: '', identifiedCause: '', actionTaken: '', result: '', escalatedTo: '', requiresEscalation: false })}>
                                        <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Ocorrência
                                    </Button>
                                )}
                            </div>
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
                        </div>
                    </div>
                </AccordionContent>
            </Card>
        </AccordionItem>
    );
}
