
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parse, isValid } from 'date-fns';
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
import { PlusCircle, Edit, Trash2, Calendar, User, Warehouse, Clock, MessageSquare, AlertCircle, Save, Send, ArrowLeft } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { type DailyLog, type DiaryActivity } from '@/types';

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
  title: z.string().min(1, 'O título é obrigatório.'),
  description: z.string().optional(),
  occurrences: z.array(occurrenceSchema),
});

const diaryFormSchema = z.object({
  activities: z.array(activitySchema),
  generalObservations: z.string().optional(),
  supervisorSignatureUrl: z.string().optional(),
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
    const supervisorSignatureRef = React.useRef<SignatureCanvas>(null);

    const form = useForm<DiaryFormValues>({
        resolver: zodResolver(diaryFormSchema),
        defaultValues: { activities: [], generalObservations: '' }
    });
    
    const { fields: activityFields, append: appendActivity, remove: removeActivity } = useFieldArray({
        control: form.control,
        name: "activities",
    });

    useEffect(() => {
        const entry = getLogById(logId as string);
        if (entry) {
            setLogEntry(entry);
            form.reset({
                activities: entry.activities || [],
                generalObservations: entry.generalObservations || '',
                supervisorSignatureUrl: entry.signatures?.supervisorSignature?.dataUrl,
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
    
    const onSave = async (status: DailyLog['status']) => {
        if (!logEntry) return;

        const values = form.getValues();
        
        let supervisorSignatureData = logEntry.signatures?.supervisorSignature;
        if (supervisorSignatureRef.current && !supervisorSignatureRef.current.isEmpty()){
            supervisorSignatureData = {
                dataUrl: supervisorSignatureRef.current.toDataURL(),
                signedAt: new Date().toISOString()
            }
        }
        
        const updatedActivities = values.activities.map(act => ({
            ...act,
            durationMinutes: calculateDuration(act.startTime, act.endTime)
        }));

        const payload: Partial<DailyLog> = {
            activities: updatedActivities,
            generalObservations: values.generalObservations,
            status,
            signatures: { ...logEntry.signatures, supervisorSignature: supervisorSignatureData }
        };
        
        await updateLog(logEntry.id, payload);
        toast({ title: `Diário ${status === 'finalizado' ? 'finalizado' : 'salvo como rascunho'} com sucesso!` });
        if (status === 'finalizado') {
            router.push('/dashboard/manager-diary');
        }
    };

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
                    <CardTitle>Diário de {format(new Date(logEntry.logDate), 'dd/MM/yyyy', { timeZone: 'UTC' })}</CardTitle>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form className="space-y-6">
                             <Card>
                                <CardHeader>
                                    <CardTitle className="flex justify-between items-center">
                                        <span>Atividades ({activityFields.length})</span>
                                        {!isFinalized && (
                                            <Button type="button" size="sm" onClick={() => appendActivity({ id: `act-${Date.now()}`, kioskId: '', startTime: '08:00', endTime: '09:00', title: '', description: '', occurrences: [] })}>
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
                             
                             <Card>
                                <CardHeader><CardTitle>Observações gerais e sugestões de melhoria</CardTitle></CardHeader>
                                <CardContent>
                                    <FormField
                                        control={form.control}
                                        name="generalObservations"
                                        render={({ field }) => (
                                            <Textarea {...field} rows={5} placeholder="Descreva aqui pontos de atenção e ideias de melhoria..." disabled={isFinalized} />
                                        )}
                                    />
                                </CardContent>
                             </Card>

                             <Card>
                                 <CardHeader><CardTitle>Assinatura do Autor</CardTitle></CardHeader>
                                 <CardContent>
                                    <div className="border rounded-md">
                                        {logEntry.signatures?.supervisorSignature?.dataUrl && (
                                            <img src={logEntry.signatures.supervisorSignature.dataUrl} alt="Assinatura" className="w-full h-40 object-contain"/>
                                        )}
                                        {!isFinalized && (
                                            <SignatureCanvas ref={supervisorSignatureRef} canvasProps={{ className: 'w-full h-40' }} />
                                        )}
                                    </div>
                                    {!isFinalized && (
                                        <Button type="button" variant="ghost" size="sm" onClick={() => supervisorSignatureRef.current?.clear()}>Limpar</Button>
                                    )}
                                 </CardContent>
                             </Card>
                             
                             {!isFinalized && (
                                <div className="flex justify-end gap-2 sticky bottom-0 py-4 bg-background">
                                    <Button type="button" variant="outline" onClick={() => onSave('em andamento')}><Save className="mr-2"/> Salvar Rascunho</Button>
                                    <Button type="button" onClick={() => onSave('finalizado')}><Send className="mr-2"/> Finalizar Registro</Button>
                                </div>
                             )}
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}


function ActivityItem({ activityIndex, control, removeActivity, kiosks, isFinalized }: { activityIndex: number, control: any, removeActivity: (index: number) => void, kiosks: any[], isFinalized: boolean }) {
    const activity = useWatch({ control, name: `activities.${activityIndex}` });
    const duration = useMemo(() => {
        try {
            const start = parse(activity.startTime, 'HH:mm', new Date());
            const end = parse(activity.endTime, 'HH:mm', new Date());
            if (!isValid(start) || !isValid(end) || end < start) return '00:00';
            const diff = (end.getTime() - start.getTime()) / (1000 * 60);
            const hours = Math.floor(diff / 60).toString().padStart(2, '0');
            const minutes = (diff % 60).toString().padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch { return '00:00'; }
    }, [activity.startTime, activity.endTime]);
    
    return (
        <AccordionItem value={`activity-${activityIndex}`} className="border rounded-lg">
            <Card>
                <AccordionTrigger className="p-4 text-left hover:no-underline w-full">
                    <div className="flex justify-between items-center w-full">
                        <div className="space-y-1">
                            <p className="font-semibold">{activity.title || 'Nova Atividade'}</p>
                            <p className="text-sm text-muted-foreground flex items-center gap-2"><Clock className="h-4 w-4"/> {duration}</p>
                        </div>
                        {!isFinalized && <Button type="button" variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={(e) => { e.stopPropagation(); removeActivity(activityIndex); }}><Trash2 className="h-4 w-4"/></Button>}
                    </div>
                </AccordionTrigger>
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
                    </div>
                </AccordionContent>
            </Card>
        </AccordionItem>
    );
}

