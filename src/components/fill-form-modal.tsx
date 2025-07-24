

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
import { type FormTemplate, type FormQuestion, type FormSubmission, type FormAnswer, type FormSection } from '@/types';
import { Progress } from './ui/progress';
import { Label } from './ui/label';
import { uploadFile } from '@/lib/storage';
import { Camera, File as FileIcon, Loader2, Paperclip, Trash2, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PhotoCaptureModal } from './photo-capture-modal';

const getAllQuestions = (sections: FormSection[]): FormQuestion[] => {
    return sections.flatMap(section => section.questions || []);
};

const getVisibleQuestionIds = (sections: FormSection[], formValues: Record<string, any>): Set<string> => {
    const visibleIds = new Set<string>();
    const allQuestions = getAllQuestions(sections);
    const questionMap = new Map(allQuestions.map(q => [q.id, q]));

    allQuestions.forEach(q => {
        // A question is visible by default unless a condition hides it (not implemented, but good practice)
        visibleIds.add(q.id);
    });

    // This logic needs to be enhanced if we add show/hide ramifications
    // For now, all questions are considered potentially visible.
    
    // A more advanced implementation would traverse the graph:
    // 1. Start with root questions.
    // 2. For each answered question, evaluate its ramifications.
    // 3. If a ramification shows a new question, add it to a "to-visit" queue.
    // 4. Continue until all visible paths are explored.

    return visibleIds;
};

const generateSchema = (allQuestions: FormQuestion[]) => {
    let schemaObject: { [key: string]: z.ZodType<any, any> } = {};
    allQuestions.forEach(question => {
        switch (question.type) {
            case 'text':
                schemaObject[question.id] = z.string().optional();
                break;
            case 'number':
                schemaObject[question.id] = z.coerce.number().optional().or(z.literal(''));
                break;
            case 'yes-no':
            case 'single-choice':
                schemaObject[question.id] = z.string().optional();
                break;
            case 'multiple-choice':
                schemaObject[question.id] = z.array(z.string()).optional();
                break;
            case 'file-attachment':
                schemaObject[question.id] = z.array(z.object({
                    name: z.string(),
                    url: z.string(),
                    type: z.string(),
                })).optional();
                break;
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
                            return <FormItem><FormLabel>{question.label}{question.isRequired && <span className="text-destructive">*</span>}</FormLabel><FormControl><Input type="number" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}/></FormControl><FormMessage /></FormItem>;
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


function QuestionRenderer({ questions, control }: { questions: FormQuestion[]; control: Control<any> }) {
  if (!questions || questions.length === 0) return null;
  return <>{questions.map(q => <RenderedQuestion key={q.id} question={q} control={control} />)}</>;
}

type FillFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: FormTemplate;
  addSubmission: (submission: Omit<FormSubmission, 'id'>, template: FormTemplate) => Promise<void>;
};

const buildAnswers = (questions: FormQuestion[], formValues: Record<string, any>): FormAnswer[] => {
    const results: FormAnswer[] = [];

    questions.forEach(q => {
        const value = formValues[q.id];
        const hasValue = value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);

        if (hasValue) {
            const answer: FormAnswer = {
                questionId: q.id,
                questionLabel: q.label,
                value: value,
                subAnswers: [] // Sub-answers are not supported in this simplified model.
            };
            results.push(answer);
        }
    });

    return results;
};


export function FillFormModal({ open, onOpenChange, template, addSubmission }: FillFormModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Determine which questions should be included in the submission
    const visibleQuestions = useMemo(() => {
        const questionsInSections = new Set<string>();
        template.sections.forEach(section => {
            const sectionRect = {
                x: section.position.x,
                y: section.position.y,
                width: section.width || 400,
                height: section.height || 600,
            };
            section.questions.forEach(q => {
                // Check if the center of the question node is inside the section
                const qCenterX = q.position.x + 150; // Assuming card width of 300
                const qCenterY = q.position.y + 40; // Assuming card height of 80
                if (
                    qCenterX >= sectionRect.x &&
                    qCenterX <= sectionRect.x + sectionRect.width &&
                    qCenterY >= sectionRect.y &&
                    qCenterY <= sectionRect.y + sectionRect.height
                ) {
                    questionsInSections.add(q.id);
                }
            });
        });
        return getAllQuestions(template.sections).filter(q => questionsInSections.has(q.id));
    }, [template]);


    const defaultValues = useMemo(() => {
        const values: Record<string, any> = {};
        visibleQuestions.forEach(q => {
            values[q.id] = q.type === 'multiple-choice' || q.type === 'file-attachment' ? [] : '';
        });
        return values;
    }, [visibleQuestions]);

    const formSchema = useMemo(() => {
        const baseSchema = generateSchema(visibleQuestions);
        return baseSchema.superRefine((data, ctx) => {
            const visibleIds = getVisibleQuestionIds(template.sections, data);
            visibleQuestions.forEach(question => {
                if (question.isRequired && visibleIds.has(question.id)) {
                    const value = data[question.id];
                    const isEmpty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
                    if (isEmpty) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: [question.id],
                            message: "Campo obrigatório",
                        });
                    }
                }
            });
        });
    }, [template, visibleQuestions]);
    
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues,
        mode: 'onChange',
    });

    useEffect(() => {
        if (open) {
            form.reset(defaultValues);
            setCurrentSectionIndex(0);
            setIsSubmitting(false);
        }
    }, [open, form, defaultValues]);

    const handleNextStep = async () => {
        const currentSection = template.sections[currentSectionIndex];
        const questionIdsInStep = getAllQuestions([currentSection]).map(q => q.id);
        const isValid = await form.trigger(questionIdsInStep as any);

        if (isValid) {
            setCurrentSectionIndex(prev => prev + 1);
        }
    };

    const handlePrevStep = () => {
        setCurrentSectionIndex(prev => prev - 1);
    };

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
            templateId: template.id,
            templateName: template.name,
            title,
            status: 'completed',
            userId: user.id,
            username: user.username,
            kioskId: kiosk?.id || 'N/A',
            kioskName: kiosk?.name || 'N/A',
            createdAt: new Date().toISOString(),
            answers: template.sections.flatMap(section => buildAnswers(section.questions, values))
        };

        await addSubmission(submission, template);
        onOpenChange(false);
    };
  
    const renderSection = (section: FormSection, index: number) => {
        const hasMultipleSections = template.sections.length > 1;
        const sectionTitle = hasMultipleSections ? (section.name?.trim() || `Seção ${index + 1}`) : null;
        
        return (
            <div key={section.id} className="space-y-6">
                {sectionTitle && <h3 className="text-lg font-semibold border-b pb-2 text-primary">{sectionTitle}</h3>}
                <QuestionRenderer questions={visibleQuestions.filter(q => section.questions.some(sq => sq.id === q.id))} control={form.control} />
            </div>
        )
    }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          {template.layout === 'stepped' && template.sections.length > 1 && (
            <DialogDescription>
                Passo {currentSectionIndex + 1} de {template.sections.length}
            </DialogDescription>
          )}
        </DialogHeader>

        {template.layout === 'stepped' && template.sections.length > 1 && (
            <Progress value={((currentSectionIndex + 1) / template.sections.length) * 100} className="w-full" />
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="h-[60vh] p-4 -mx-4 pr-6">
              <div className="space-y-8 p-2">
                 {template.layout === 'stepped' && template.sections.length > 1 ? (
                    renderSection(template.sections[currentSectionIndex], currentSectionIndex)
                 ) : (
                    template.sections.map((section, index) => renderSection(section, index))
                 )}
              </div>
            </ScrollArea>
            <DialogFooter className="pt-6 border-t flex justify-between w-full">
              <div>
                {template.layout === 'stepped' && currentSectionIndex > 0 && (
                    <Button type="button" variant="outline" onClick={handlePrevStep} disabled={isSubmitting}>Voltar</Button>
                )}
              </div>
              <div className="flex-grow flex justify-end">
                {template.layout === 'stepped' && currentSectionIndex < template.sections.length - 1 ? (
                    <Button type="button" onClick={handleNextStep} disabled={isSubmitting}>Próxima</Button>
                ) : (
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
                        {isSubmitting ? 'Enviando...' : 'Enviar formulário'}
                    </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
