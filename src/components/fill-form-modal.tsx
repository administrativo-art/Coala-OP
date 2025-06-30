
"use client"

import React, { useMemo, useEffect, useState } from 'react';
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


const getAllQuestions = (sections: FormSection[]): FormQuestion[] => {
    const questions: FormQuestion[] = [];
    const recurse = (qs: FormQuestion[] | undefined) => {
        if (!qs) return;
        qs.forEach(q => {
            questions.push(q);
            if (q.options) {
                q.options.forEach(opt => {
                    recurse(opt.subQuestions);
                });
            }
        });
    };
    sections.forEach(sec => recurse(sec.questions));
    return questions;
};

const getVisibleQuestionIds = (sections: FormSection[], formValues: Record<string, any>): Set<string> => {
    const visibleIds = new Set<string>();
    const recurse = (questions: FormQuestion[] | undefined, isVisible: boolean) => {
        if (!questions || !isVisible) return;
        questions.forEach(q => {
            visibleIds.add(q.id);
            const answer = formValues[q.id];
            if (q.options && answer) {
                const selectedValues = Array.isArray(answer) ? answer : [answer];
                q.options.forEach(opt => {
                    recurse(opt.subQuestions, selectedValues.includes(opt.value));
                });
            }
        });
    };
    sections.forEach(sec => recurse(sec.questions, true));
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
        }
    });
    return z.object(schemaObject);
}

function RenderedQuestion({ question, control }: { question: FormQuestion; control: Control<any> }) {
    const answer = useWatch({ control, name: question.id });
    
    const subQuestions = useMemo(() => {
        if (!question.options || !answer) return [];
        const selectedValues = Array.isArray(answer) ? answer : [answer];
        return question.options
            .filter(opt => selectedValues.includes(opt.value))
            .flatMap(opt => opt.subQuestions || []);
    }, [answer, question.options]);

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
                        default: return null;
                    }
                }}
            />
            {subQuestions.length > 0 && (
                <div className="pl-4 border-l-2 ml-2 space-y-6">
                    <QuestionRenderer questions={subQuestions} control={control} />
                </div>
            )}
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
  addSubmission: (submission: Omit<FormSubmission, 'id'>) => Promise<void>;
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
                subAnswers: []
            };

            if (q.options) {
                const selectedValues = Array.isArray(value) ? value : [value];
                q.options.forEach(opt => {
                    if (selectedValues.includes(opt.value) && opt.subQuestions && opt.subQuestions.length > 0) {
                        answer.subAnswers = (answer.subAnswers || []).concat(buildAnswers(opt.subQuestions, formValues));
                    }
                });
            }
            results.push(answer);
        }
    });

    return results;
};


export function FillFormModal({ open, onOpenChange, template, addSubmission }: FillFormModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
    
    const allQuestions = useMemo(() => getAllQuestions(template.sections), [template]);

    const defaultValues = useMemo(() => {
        const values: Record<string, any> = {};
        allQuestions.forEach(q => {
            values[q.id] = q.type === 'multiple-choice' ? [] : '';
        });
        return values;
    }, [allQuestions]);

    const formSchema = useMemo(() => {
        const baseSchema = generateSchema(allQuestions);
        return baseSchema.superRefine((data, ctx) => {
            const visibleIds = getVisibleQuestionIds(template.sections, data);
            allQuestions.forEach(question => {
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
    }, [template, allQuestions]);
    
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues,
        mode: 'onChange',
    });

    useEffect(() => {
        if (open) {
            form.reset(defaultValues);
            setCurrentSectionIndex(0);
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

    const onSubmit = (values: Record<string, any>) => {
        if (!user) return;
        const kiosk = kiosks.find(k => k.id === user.kioskId);

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
            userId: user.id,
            username: user.username,
            kioskId: kiosk?.id || 'N/A',
            kioskName: kiosk?.name || 'N/A',
            createdAt: new Date().toISOString(),
            answers: template.sections.flatMap(section => buildAnswers(section.questions, values))
        };

        addSubmission(submission);
        onOpenChange(false);
    };
  
    const renderSection = (section: FormSection, index: number) => {
        const hasMultipleSections = template.sections.length > 1;
        const sectionTitle = hasMultipleSections ? (section.name?.trim() || `Seção ${index + 1}`) : null;
        
        return (
            <div key={section.id} className="space-y-6">
                {sectionTitle && <h3 className="text-lg font-semibold border-b pb-2 text-primary">{sectionTitle}</h3>}
                <QuestionRenderer questions={section.questions} control={form.control} />
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
                    <Button type="button" variant="outline" onClick={handlePrevStep}>Voltar</Button>
                )}
              </div>
              <div className="flex-grow flex justify-end">
                {template.layout === 'stepped' && currentSectionIndex < template.sections.length - 1 ? (
                    <Button type="button" onClick={handleNextStep}>Próxima</Button>
                ) : (
                    <Button type="submit">Enviar formulário</Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
