
"use client"

import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useForm, useWatch, Control, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { type FormTemplate, type FormQuestion, type FormSubmission, type FormAnswer } from '@/types';
import { Progress } from './ui/progress';
import { Label } from './ui/label';
import { uploadFile } from '@/lib/storage';
import { Camera, File as FileIcon, Loader2, Paperclip, Trash2, Image as ImageIcon, Video as VideoIcon, DollarSign, Percent, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PhotoCaptureModal } from './photo-capture-modal';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { cn } from '@/lib/utils';


const getVisibleQuestionIds = (allQuestions: FormQuestion[], formValues: Record<string, any>): Set<string> => {
    const visibleIds = new Set<string>();
    const questionMap = new Map(allQuestions.map(q => [q.id, q]));
    
    // Always add top-level questions
    allQuestions.forEach(q => {
        if (!q.excluidaDoSumario) {
            visibleIds.add(q.id);
        }
    });

    const queue = [...allQuestions.filter(q => !q.excluidaDoSumario)];
    const processed = new Set<string>();

    while(queue.length > 0) {
        const question = queue.shift();
        if (!question || processed.has(question.id)) continue;
        processed.add(question.id);

        if (question.options) {
            const answer = formValues[question.id];
            
            question.options.forEach(opt => {
                const ramification = opt.ramification;
                let isConditionMet = false;

                if (Array.isArray(answer)) { // Multiple choice
                    isConditionMet = answer.includes(opt.value);
                } else { // Single choice / Yes-No
                    isConditionMet = answer === opt.value;
                }

                if (isConditionMet && ramification && ramification.targetQuestionId) {
                    const targetQuestion = questionMap.get(ramification.targetQuestionId);
                    if (targetQuestion) {
                        visibleIds.add(targetQuestion.id);
                        if (!processed.has(targetQuestion.id)) {
                            queue.push(targetQuestion);
                        }
                    }
                }
            });
        }
    }

    return visibleIds;
};

const generateSchema = (allQuestions: FormQuestion[], visibleIds: Set<string>) => {
    let schemaObject: { [key: string]: z.ZodType<any, any> } = {};
    allQuestions.forEach(question => {
        const isVisible = visibleIds.has(question.id);
        let validator: z.ZodType<any, any> | null = null;
        switch (question.type) {
            case 'text':
                validator = z.string();
                break;
            case 'number':
            case 'rating':
                validator = z.coerce.number();
                break;
            case 'range':
                validator = z.object({ min: z.coerce.number(), max: z.coerce.number() });
                break;
            case 'yes-no':
            case 'single-choice':
                validator = z.string();
                break;
            case 'multiple-choice':
                 validator = z.array(z.string());
                break;
            case 'file-attachment':
                validator = z.array(z.object({ name: z.string(), url: z.string(), type: z.string() }));
                break;
        }

        if(validator) {
            if (question.isRequired && isVisible) {
                if (validator instanceof z.ZodString) {
                    schemaObject[question.id] = validator.min(1, "Campo obrigatório");
                } else if (validator instanceof z.ZodArray) {
                    schemaObject[question.id] = validator.min(1, "Selecione ao menos uma opção");
                } else {
                     schemaObject[question.id] = validator;
                }
            } else {
                 schemaObject[question.id] = validator.optional().nullable();
            }
        }
    });
    return z.object(schemaObject);
}

function RenderedQuestion({ question, control }: { question: FormQuestion; control: Control<any> }) {
    const { toast } = useToast();
    const [isUploading, setIsUploading] = useState(false);
    const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const handleFileChange = async (files: FileList | null) => {
        if (!files) return;
        setIsUploading(true);
        try {
            const uploadedFiles = await Promise.all(
                Array.from(files).map(async file => {
                    const url = await uploadFile(file, `form-attachments/${new Date().getTime()}-${file.name}`);
                    return { name: file.name, url, type: file.type };
                })
            );
            const currentFiles = control.getValues(question.id) || [];
            control.setValue(question.id, [...currentFiles, ...uploadedFiles], { shouldValidate: true });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Erro de Upload', description: 'Não foi possível enviar o arquivo.' });
        } finally {
            setIsUploading(false);
        }
    };
    
    const handlePhotoCaptured = async (dataUrl: string) => {
        setIsUploading(true);
        try {
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], `captura-${new Date().getTime()}.jpg`, { type: 'image/jpeg' });
            const url = await uploadFile(file, `form-attachments/${file.name}`);
            const currentFiles = control.getValues(question.id) || [];
            control.setValue(question.id, [...currentFiles, { name: file.name, url, type: file.type }], { shouldValidate: true });
        } catch (error) {
             toast({ variant: 'destructive', title: 'Erro de Upload', description: 'Não foi possível enviar a foto.' });
        } finally {
            setIsUploading(false);
        }
    };

    const removeFile = (index: number) => {
        const currentFiles = control.getValues(question.id) || [];
        const newFiles = currentFiles.filter((_: any, i: number) => i !== index);
        control.setValue(question.id, newFiles, { shouldValidate: true });
    };

    return (
        <div className="space-y-6">
            <FormField
                control={control}
                name={question.id}
                render={({ field }) => {
                    switch (question.type) {
                        case 'text':
                            return <FormItem><FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel><FormControl><Textarea {...field} value={field.value || ''} /></FormControl><FormMessage /></FormItem>;
                        case 'number':
                            const format = question.numberConfig?.format || 'default';
                            return <FormItem><FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel>
                                <div className="relative">
                                    {format === 'currency' && <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />}
                                    <FormControl><Input type="number"
                                        min={question.numberConfig?.min}
                                        max={question.numberConfig?.max}
                                        step={question.numberConfig?.step || 'any'}
                                        className={format === 'currency' ? 'pl-8' : format === 'percentage' ? 'pr-8' : ''}
                                        {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                    /></FormControl>
                                    {format === 'percentage' && <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />}
                                </div>
                                <FormMessage /></FormItem>;
                        case 'range':
                             return (
                                <FormItem>
                                    <FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel>
                                    <div className="flex items-center gap-4">
                                        <FormField
                                            control={control}
                                            name={`${question.id}.min`}
                                            render={({ field: minField }) => (
                                                <FormItem className="flex-1"><FormLabel className="text-sm text-muted-foreground">{question.rangeConfig?.minLabel || 'Mínimo'}</FormLabel><FormControl><Input type="number" {...minField} /></FormControl><FormMessage /></FormItem>
                                            )}
                                        />
                                         <FormField
                                            control={control}
                                            name={`${question.id}.max`}
                                            render={({ field: maxField }) => (
                                                <FormItem className="flex-1"><FormLabel className="text-sm text-muted-foreground">{question.rangeConfig?.maxLabel || 'Máximo'}</FormLabel><FormControl><Input type="number" {...maxField} /></FormControl><FormMessage /></FormItem>
                                            )}
                                        />
                                    </div>
                                </FormItem>
                             );
                        case 'rating':
                            const maxRating = question.ratingConfig?.max || 5;
                            return (
                                <FormItem>
                                    <FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel>
                                    <FormControl>
                                        <ToggleGroup type="single" value={String(field.value)} onValueChange={(value) => field.onChange(value ? Number(value) : '')} className="flex-wrap justify-start">
                                            {Array.from({ length: maxRating }, (_, i) => i + 1).map(val => (
                                                <ToggleGroupItem key={val} value={String(val)} className={cn("flex-col h-14 w-14", field.value === val && 'bg-primary/20')}>
                                                    <Star className="h-5 w-5 mb-1" />
                                                    {val}
                                                </ToggleGroupItem>
                                            ))}
                                        </ToggleGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            );
                        case 'yes-no':
                        case 'single-choice':
                            return <FormItem className="space-y-3"><FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel><FormControl><RadioGroup onValueChange={field.onChange} value={field.value} className="space-y-1">
                                {question.options?.map((option) => (
                                    <FormItem className="flex items-center space-x-3" key={option.id}>
                                        <FormControl>
                                            <RadioGroupItem value={option.value} id={`${question.id}-${option.id}`} />
                                        </FormControl>
                                        <Label htmlFor={`${question.id}-${option.id}`} className="font-normal">{option.value}</Label>
                                    </FormItem>
                                ))}
                                </RadioGroup></FormControl><FormMessage /></FormItem>;
                        case 'multiple-choice':
                             return <FormItem><div className="mb-4"><FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel></div>
                                {question.options?.map((option) => (
                                    <FormField key={option.id} control={control} name={question.id} render={({ field }) => (
                                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 mb-2">
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value?.includes(option.value)}
                                                    onCheckedChange={(checked) => {
                                                        const currentValue = field.value || [];
                                                        return checked
                                                            ? field.onChange([...currentValue, option.value])
                                                            : field.onChange(currentValue.filter((value: string) => value !== option.value));
                                                    }}
                                                />
                                            </FormControl>
                                            <FormLabel className="font-normal">{option.value}</FormLabel>
                                        </FormItem>
                                    )}/>
                                ))}
                                <FormMessage />
                            </FormItem>
                        case 'file-attachment':
                            return (
                                <FormItem>
                                    <FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel>
                                    <div className="p-3 border rounded-lg space-y-3">
                                        <div className="flex gap-2">
                                            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                                                {isUploading ? <Loader2 className="mr-2 animate-spin"/> : <Paperclip className="mr-2" />}
                                                Anexar
                                            </Button>
                                            {question.attachmentConfig?.allowCamera && (
                                                <Button type="button" variant="outline" size="sm" onClick={() => setIsPhotoModalOpen(true)} disabled={isUploading}>
                                                    <Camera className="mr-2" />
                                                    Tirar Foto
                                                </Button>
                                            )}
                                            <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFileChange(e.target.files)} multiple={question.attachmentConfig?.allowMultiple} />
                                        </div>
                                        {(field.value || []).map((file: {name: string, url: string, type: string}, index: number) => {
                                              let Icon = FileIcon;
                                              if (file.type?.startsWith('image')) Icon = ImageIcon;
                                              if (file.type?.startsWith('video')) Icon = VideoIcon;
                                            return (
                                            <div key={index} className="flex items-center justify-between text-sm p-2 rounded-md bg-muted">
                                                <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:underline text-primary">
                                                    <Icon className="h-4 w-4" />
                                                    <span className="truncate">{file.name}</span>
                                                </a>
                                                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeFile(index)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )})}
                                    </div>
                                    {isPhotoModalOpen && <PhotoCaptureModal open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen} onPhotoCaptured={handlePhotoCaptured} />}
                                    <FormMessage />
                                </FormItem>
                            );

                        default: return null;
                    }
                }}
            />
        </div>
    );
}

function ThankYouScreen({ thanksMessage, showResetButton, onReset }: {
  thanksMessage?: string;
  showResetButton?: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 h-[60vh]">
      <div className="p-4 bg-green-100 dark:bg-green-900/30 rounded-full mb-4">
        <CheckIcon className="h-10 w-10 text-green-600 dark:text-green-400" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">Formulário enviado</h2>
      <p className="text-muted-foreground whitespace-pre-wrap mb-6 max-w-md">
        {thanksMessage || "Obrigado! Suas respostas foram recebidas com sucesso."}
      </p>

      {showResetButton && (
        <Button variant="outline" onClick={onReset}>
          Preencher novamente
        </Button>
      )}
    </div>
  );
}

function CheckIcon(props: React.ComponentProps<'svg'>) {
    return (
      <svg
        {...props}
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
}

type FillFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: FormTemplate;
  addSubmission: (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => Promise<void>;
};

const buildAnswers = (questions: FormQuestion[], formValues: Record<string, any>): FormAnswer[] => {
    const results: FormAnswer[] = [];
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const buildRecursive = (question: FormQuestion, currentValues: Record<string, any>): FormAnswer | null => {
        let value = currentValues[question.id];
        
        if (question.type === 'range') {
            value = (value?.min || value?.max) ? `${value.min || ''} - ${value.max || ''}` : '';
        }

        const hasValue = value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);

        if (hasValue) {
            const answer: FormAnswer = {
                questionId: question.id,
                questionLabel: question.label,
                value: value,
                subAnswers: []
            };

            if (question.options) {
                const answerValueArray = Array.isArray(value) ? value : [value];
                question.options.forEach(opt => {
                    if (answerValueArray.includes(opt.value) && opt.ramification?.targetQuestionId) {
                        const subQuestion = questionMap.get(opt.ramification.targetQuestionId);
                        if (subQuestion) {
                            const subAnswer = buildRecursive(subQuestion, currentValues);
                            if (subAnswer) {
                                answer.subAnswers!.push(subAnswer);
                            }
                        }
                    }
                });
            }
            return answer;
        }
        return null;
    };
    
    questions.filter(q => !q.excluidaDoSumario).forEach(q => {
        const answer = buildRecursive(q, formValues);
        if (answer) {
            results.push(answer);
        }
    });

    return results;
};


export function FillFormModal({ open, onOpenChange, template, addSubmission }: FillFormModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);
    
    const allQuestions = useMemo(() => template.questions || [], [template]);
    
    const form = useForm({
        mode: 'onChange',
        resolver: (data, context, options) => {
            const visibleIds = getVisibleQuestionIds(allQuestions, data);
            const schema = generateSchema(allQuestions, visibleIds);
            return zodResolver(schema)(data, context, options);
        },
    });
    
    const formValues = useWatch({ control: form.control });

    // This useMemo is correct as it calculates the currently visible questions for rendering
    const visibleQuestions = useMemo(() => {
        const visibleIds = getVisibleQuestionIds(allQuestions, formValues);
        return allQuestions.filter(q => visibleIds.has(q.id)).sort((a,b) => a.order - b.order);
    }, [allQuestions, formValues]);
    
    // Trigger re-validation when formValues change
    useEffect(() => {
        form.trigger();
    }, [formValues, form]);


    const handleResetAndFillAgain = () => {
        form.reset();
        setIsSubmitted(false);
    };

    useEffect(() => {
        if (open) {
            form.reset();
            setIsSubmitting(false);
            setIsSubmitted(false);
        }
    }, [open, form]);
    
    const onSubmit = async (values: Record<string, any>) => {
        if (!user) return;
        setIsSubmitting(true);
        
        const primaryKioskId = user.assignedKioskIds?.[0] || 'N/A';
        const kiosk = kiosks.find(k => k.id === primaryKioskId);

        let title = template.submissionTitleFormat || template.name;
        if (template.submissionTitleFormat) {
            title = title.replace(/{kioskName}/g, kiosk?.name || 'N/A');
            title = title.replace(/{username}/g, user.username);
            title = title.replace(/{date}/g, new Date().toLocaleDateString('pt-BR'));
            
            const matches = title.match(/{([^{}]+)}/g) || [];
            matches.forEach(match => {
                const questionId = match.substring(1, match.length - 1);
                if (values[questionId]) {
                    const answerValue = Array.isArray(values[questionId]) ? values[questionId].join(', ') : values[questionId];
                    title = title.replace(match, String(answerValue));
                }
            });
        }
        
        const submission: Omit<FormSubmission, 'id'> = {
            templateId: template.id!,
            templateName: template.name,
            title,
            status: 'completed',
            userId: user.id,
            username: user.username,
            kioskId: kiosk?.id || 'N/A',
            kioskName: kiosk?.name || 'N/A',
            createdAt: new Date().toISOString(),
            answers: buildAnswers(allQuestions, values),
        };

        await addSubmission(submission, template);
        setIsSubmitting(false);
        setIsSubmitted(true);
        
        if (!template.showResetButton) {
            setTimeout(() => onOpenChange(false), 3000); 
        }
    };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        {isSubmitted ? (
             <ThankYouScreen 
                thanksMessage={template.thanksMessage}
                showResetButton={template.showResetButton}
                onReset={handleResetAndFillAgain}
             />
        ) : (
            <>
                <DialogHeader>
                <DialogTitle>{template.name}</DialogTitle>
                </DialogHeader>

                <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <ScrollArea className="h-[60vh] p-4 -mx-4 pr-6">
                        <div className="space-y-6">
                            {visibleQuestions.map(q => <RenderedQuestion key={q.id} question={q} control={form.control} />)}
                        </div>
                    </ScrollArea>
                    <DialogFooter className="pt-6 border-t flex justify-between w-full">
                    <div className="flex-grow flex justify-end">
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
                            {isSubmitting ? 'Enviando...' : 'Enviar formulário'}
                        </Button>
                    </div>
                    </DialogFooter>
                </form>
                </Form>
            </>
        )}
      </DialogContent>
    </Dialog>
  );
}
