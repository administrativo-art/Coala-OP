
"use client";

import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parse } from 'date-fns';
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
import { PlusCircle, Edit, Trash2, Calendar, User, Warehouse, Clock, MessageSquare, AlertCircle, Save, Send } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { Skeleton } from './ui/skeleton';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

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
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato de hora inválido (HH:mm)."),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Formato de hora inválido (HH:mm)."),
  title: z.string().min(1, 'O título é obrigatório.'),
  description: z.string().optional(),
  occurrences: z.array(occurrenceSchema),
});

const diaryFormSchema = z.object({
  activities: z.array(activitySchema),
  generalObservations: z.string().optional(),
  supervisorSignatureUrl: z.string().optional(),
  managerSignatureUrl: z.string().optional(),
});

type DiaryFormValues = z.infer<typeof diaryFormSchema>;

export function ManagerDiary() {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const { todayLog, createOrUpdateLog, loading } = useAuthorBoardDiary();
    
    const supervisorSignatureRef = React.useRef<SignatureCanvas>(null);
    const managerSignatureRef = React.useRef<SignatureCanvas>(null);

    const form = useForm<DiaryFormValues>({
        resolver: zodResolver(diaryFormSchema),
        defaultValues: {
            activities: [],
            generalObservations: '',
        }
    });

    const { fields: activityFields, append: appendActivity, remove: removeActivity } = useFieldArray({
        control: form.control,
        name: "activities",
    });

    useEffect(() => {
        if (todayLog) {
            form.reset({
                activities: todayLog.activities || [],
                generalObservations: todayLog.generalObservations || '',
                supervisorSignatureUrl: todayLog.signatures?.supervisorSignature?.dataUrl,
                managerSignatureUrl: todayLog.signatures?.managerSignature?.dataUrl,
            });
        } else {
             form.reset({
                activities: [],
                generalObservations: '',
            });
        }
    }, [todayLog, form]);
    
    if (loading) {
        return <Skeleton className="h-screen w-full" />
    }

    const onSave = async (values: DiaryFormValues, newStatus: 'draft' | 'submitted') => {
        const supervisorSignature = supervisorSignatureRef.current;
        let supervisorSignatureData = todayLog?.signatures?.supervisorSignature;
        if (supervisorSignature && !supervisorSignature.isEmpty()){
            supervisorSignatureData = {
                dataUrl: supervisorSignature.toDataURL(),
                signedAt: new Date().toISOString()
            }
        }
        
        const payload = { ...values, status: newStatus, signatures: { supervisorSignature: supervisorSignatureData } };
        await createOrUpdateLog(payload);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Diário Gerencial</h1>
                    <p className="text-muted-foreground">Registre as atividades e ocorrências do dia.</p>
                </div>
                 {/* This button could be used to select a date in the future */}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Metadados</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-3 gap-4">
                    <div className="flex items-center gap-3 p-3 border rounded-lg"><Calendar className="h-5 w-5 text-primary" /><div><p className="text-sm text-muted-foreground">Data</p><p className="font-semibold">{format(new Date(), 'dd/MM/yyyy')}</p></div></div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg"><User className="h-5 w-5 text-primary" /><div><p className="text-sm text-muted-foreground">Autor</p><p className="font-semibold">{user?.username}</p></div></div>
                    <div className="flex items-center gap-3 p-3 border rounded-lg"><Warehouse className="h-5 w-5 text-primary" /><div><p className="text-sm text-muted-foreground">Unidades</p><p className="font-semibold truncate">{user?.assignedKioskIds.map(id => kiosks.find(k => k.id === id)?.name).join(', ')}</p></div></div>
                </CardContent>
            </Card>

            <Form {...form}>
            <form className="space-y-6">
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex justify-between items-center">
                            <span>Atividades ({activityFields.length})</span>
                            <Button type="button" size="sm" onClick={() => appendActivity({ id: `act-${Date.now()}`, startTime: '', endTime: '', title: '', description: '', occurrences: [] })}>
                                <PlusCircle className="mr-2 h-4 w-4"/> Nova Atividade
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Accordion type="multiple" className="w-full space-y-3">
                            {activityFields.map((field, index) => (
                                <ActivityItem key={field.id} activityIndex={index} control={form.control} removeActivity={removeActivity} />
                            ))}
                        </Accordion>
                    </CardContent>
                 </Card>
                 
                 <Card>
                    <CardHeader><CardTitle>Observações gerais e sugestões de melhoria</CardTitle></CardHeader>
                    <CardContent>
                        <FormField
                            control={form.control}
                            name="generalObservations"
                            render={({ field }) => (
                                <Textarea {...field} rows={5} placeholder="Descreva aqui pontos de atenção e ideias de melhoria..."/>
                            )}
                        />
                    </CardContent>
                 </Card>

                 <div className="grid md:grid-cols-2 gap-6">
                     <Card>
                         <CardHeader><CardTitle>Assinatura do Autor</CardTitle></CardHeader>
                         <CardContent>
                            <div className="border rounded-md">
                                <SignatureCanvas ref={supervisorSignatureRef} canvasProps={{ className: 'w-full h-40' }} />
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => supervisorSignatureRef.current?.clear()}>Limpar</Button>
                         </CardContent>
                     </Card>
                     <Card>
                         <CardHeader><CardTitle>Assinatura do Gestor</CardTitle></CardHeader>
                         <CardContent>
                            <div className="border rounded-md h-40 bg-muted flex items-center justify-center">
                                <p className="text-sm text-muted-foreground">(Aguardando validação)</p>
                            </div>
                         </CardContent>
                     </Card>
                 </div>
                 
                 <div className="flex justify-end gap-2 sticky bottom-0 py-4 bg-background">
                     <Button type="button" variant="outline" onClick={form.handleSubmit(v => onSave(v, 'draft'))}><Save className="mr-2"/> Salvar Rascunho</Button>
                     <Button type="button" onClick={form.handleSubmit(v => onSave(v, 'submitted'))}><Send className="mr-2"/> Enviar Registro</Button>
                 </div>
            </form>
            </Form>
        </div>
    );
}

// Sub-componentes
function ActivityItem({ activityIndex, control, removeActivity }: { activityIndex: number, control: any, removeActivity: (index: number) => void }) {
    const { fields, append, remove } = useFieldArray({
        control,
        name: `activities.${activityIndex}.occurrences`,
    });
    
    const startTime = useForm().watch(`activities.${activityIndex}.startTime`);
    const endTime = useForm().watch(`activities.${activityIndex}.endTime`);
    
    const duration = React.useMemo(() => {
        try {
            const start = parse(startTime, 'HH:mm', new Date());
            const end = parse(endTime, 'HH:mm', new Date());
            const diff = end.getTime() - start.getTime();
            if (diff > 0) {
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
        } catch {}
        return '00:00';
    }, [startTime, endTime]);

    return (
        <AccordionItem value={`activity-${activityIndex}`} className="border rounded-lg">
            <Card>
            <AccordionTrigger className="p-4 text-left hover:no-underline">
                <div className="flex justify-between items-center w-full">
                    <div className="space-y-1">
                        <p className="font-semibold"><FormField control={control} name={`activities.${activityIndex}.title`} render={({ field }) => ( <Input {...field} className="inline-block w-auto h-7 p-1" placeholder="Título da atividade" onClick={e => e.stopPropagation()} /> )}/></p>
                        <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4"/> {duration}</p>
                    </div>
                </div>
            </AccordionTrigger>
            <AccordionContent className="p-4 pt-0">
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <FormField control={control} name={`activities.${activityIndex}.startTime`} render={({ field }) => ( <FormItem><FormLabel>Início</FormLabel><Input type="time" {...field} /></FormItem> )} />
                        <FormField control={control} name={`activities.${activityIndex}.endTime`} render={({ field }) => ( <FormItem><FormLabel>Fim</FormLabel><Input type="time" {...field} /></FormItem> )} />
                    </div>
                    <FormField control={control} name={`activities.${activityIndex}.description`} render={({ field }) => ( <FormItem><FormLabel>Descrição</FormLabel><Textarea {...field} placeholder="Detalhes da atividade..." /></FormItem> )} />
                    
                    <div className="pt-4 border-t">
                        <h4 className="font-semibold flex justify-between items-center">
                            <span>Ocorrências ({fields.length})</span>
                            <Button type="button" size="sm" variant="outline" onClick={() => append({ id: `occ-${Date.now()}`, description: '', identifiedCause: '', actionTaken: '', result: '', requiresEscalation: false, escalatedTo: '' })}>
                                <PlusCircle className="mr-2 h-4 w-4"/> Ocorrência
                            </Button>
                        </h4>
                        <div className="space-y-2 mt-2">
                            {fields.map((field, index) => (
                                <OccurrenceItem key={field.id} activityIndex={activityIndex} occurrenceIndex={index} control={control} remove={remove} />
                            ))}
                        </div>
                    </div>
                </div>
            </AccordionContent>
            </Card>
        </AccordionItem>
    );
}

function OccurrenceItem({ activityIndex, occurrenceIndex, control, remove }: { activityIndex: number, occurrenceIndex: number, control: any, remove: (index: number) => void }) {
    return (
        <div className="p-3 border rounded-md bg-background space-y-3">
             <div className="flex justify-end">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => remove(occurrenceIndex)}><Trash2 className="h-4 w-4" /></Button>
             </div>
             <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.description`} render={({ field }) => ( <FormItem><FormLabel>Descrição</FormLabel><Textarea {...field} /></FormItem> )} />
             <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.identifiedCause`} render={({ field }) => ( <FormItem><FormLabel>Causa</FormLabel><Input {...field} /></FormItem> )} />
             <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.actionTaken`} render={({ field }) => ( <FormItem><FormLabel>Ação</FormLabel><Input {...field} /></FormItem> )} />
             <FormField control={control} name={`activities.${activityIndex}.occurrences.${occurrenceIndex}.result`} render={({ field }) => ( <FormItem><FormLabel>Resultado</FormLabel><Input {...field} /></FormItem> )} />
        </div>
    )
}

    