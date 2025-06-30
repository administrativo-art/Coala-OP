
"use client"

import React, { useMemo, useEffect } from 'react';
import { useForm, useWatch, Control, FieldPath, FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { type FormTemplate, type FormQuestion, type FormSubmission, type FormSection } from '@/types';

// Helper to get all possible question IDs, including nested ones
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

// Helper to get only the IDs of questions that are currently visible based on answers
const getVisibleQuestionIds = (sections: FormSection[], formValues: Record<string, any>): Set<string> => {
    const visibleIds = new Set<string>();
    const recurse = (questions: FormQuestion[] | undefined) => {
        if (!questions) return;
        questions.forEach(q => {
            visibleIds.add(q.id);
            const answer = formValues[q.id];
            if (q.options && answer) {
                const selectedOptions = Array.isArray(answer) ? answer : [answer];
                q.options.forEach(opt => {
                    if (selectedOptions.includes(opt.value)) {
                        recurse(opt.subQuestions);
                    }
                });
            }
        });
    };
    sections.forEach(sec => recurse(sec.questions));
    return visibleIds;
};

// Dynamically generate the Zod schema for validation
const generateSchema = (template: FormTemplate, allQuestions: FormQuestion[]) => {
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
    
    return z.object(schemaObject).superRefine((data, ctx) => {
        const visibleIds = getVisibleQuestionIds(template.sections, data);
        allQuestions.forEach(question => {
            if (visibleIds.has(question.id)) {
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
}

// ==================== Recursive Question Renderer ====================
function RenderedQuestion({ question, control }: { question: FormQuestion; control: Control<any> }) {
    const answer = useWatch({ control, name: question.id });
    
    const subQuestions = useMemo(() => {
        if (!question.options || !answer) return [];
        const selectedValues = Array.isArray(answer) ? answer : [answer];
        return question.options
            .filter(opt => selectedValues.includes(opt.value))
            .flatMap(opt => opt.subQuestions || []);
    }, [answer, question.options]);

    const renderInput = () => {
        switch (question.type) {
            case 'text':
                return (
                    <FormField
                        control={control}
                        name={question.id as FieldPath<FieldValues>}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{question.label}</FormLabel>
                                <FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                );
            case 'number':
                return (
                    <FormField
                        control={control}
                        name={question.id as FieldPath<FieldValues>}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{question.label}</FormLabel>
                                <FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                );
            case 'yes-no':
            case 'single-choice':
                return (
                    <FormField
                        control={control}
                        name={question.id as FieldPath<FieldValues>}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="font-semibold">{question.label}</FormLabel>
                                <FormControl>
                                    <RadioGroup onValueChange={field.onChange} value={field.value} className="space-y-1 pt-2">
                                        {question.options?.map(option => (
                                            <FormItem key={option.id} className="flex items-center space-x-3 space-y-0">
                                                <FormControl>
                                                    <RadioGroupItem value={option.value} id={`${question.id}-${option.id}`} />
                                                </FormControl>
                                                <Label htmlFor={`${question.id}-${option.id}`} className="font-normal cursor-pointer">{option.value}</Label>
                                            </FormItem>
                                        ))}
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                );
            case 'multiple-choice':
                return (
                    <FormField
                        control={control}
                        name={question.id as FieldPath<FieldValues>}
                        render={() => (
                            <FormItem>
                                <div className="mb-4">
                                    <FormLabel className="font-semibold">{question.label}</FormLabel>
                                </div>
                                {question.options?.map(option => (
                                    <FormField
                                        key={option.id}
                                        control={control}
                                        name={question.id as FieldPath<FieldValues>}
                                        render={({ field }) => (
                                            <FormItem
                                                key={option.id}
                                                className="flex flex-row items-start space-x-3 space-y-0 mb-2"
                                            >
                                                <FormControl>
                                                    <Checkbox
                                                        checked={field.value?.includes(option.value)}
                                                        onCheckedChange={(checked) => {
                                                            const currentValues = Array.isArray(field.value) ? field.value : [];
                                                            return checked
                                                                ? field.onChange([...currentValues, option.value])
                                                                : field.onChange(currentValues.filter((value: string) => value !== option.value));
                                                        }}
                                                    />
                                                </FormControl>
                                                <Label className="font-normal cursor-pointer">{option.value}</Label>
                                            </FormItem>
                                        )}
                                    />
                                ))}
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            {renderInput()}
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

// ==================== Main Modal Component ====================
type FillFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: FormTemplate;
  addSubmission: (submission: Omit<FormSubmission, 'id'>) => Promise<void>;
};

export function FillFormModal({ open, onOpenChange, template, addSubmission }: FillFormModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    
    const allQuestions = useMemo(() => getAllQuestions(template.sections), [template]);

    const defaultValues = useMemo(() => {
        const values: Record<string, any> = {};
        allQuestions.forEach(q => {
            values[q.id] = q.type === 'multiple-choice' ? [] : '';
        });
        return values;
    }, [allQuestions]);

    const formSchema = useMemo(() => generateSchema(template, allQuestions), [template, allQuestions]);
    
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues,
        mode: 'onChange',
    });

    useEffect(() => {
        if (open) {
            form.reset(defaultValues);
        }
    }, [open, form, defaultValues]);
    
    const onSubmit = (values: Record<string, any>) => {
        if (!user) return;
        const kiosk = kiosks.find(k => k.id === user.kioskId);

        const allQuestionsMap = new Map(allQuestions.map(q => [q.id, q]));
        const visibleIds = getVisibleQuestionIds(template.sections, values);

        const submission: Omit<FormSubmission, 'id'> = {
            templateId: template.id,
            templateName: template.name,
            userId: user.id,
            username: user.username,
            kioskId: kiosk?.id || 'N/A',
            kioskName: kiosk?.name || 'N/A',
            createdAt: new Date().toISOString(),
            answers: Array.from(visibleIds)
              .map(questionId => {
                  const question = allQuestionsMap.get(questionId);
                  const value = values[questionId];
                  if (!question || (value === '' || (Array.isArray(value) && value.length === 0))) return null;
                  return {
                      questionId,
                      questionLabel: question.label,
                      value: values[questionId],
                  };
              }).filter((a): a is NonNullable<typeof a> => a !== null),
        };

        addSubmission(submission);
        onOpenChange(false);
    };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>Preencha todos os campos obrigatórios para enviar.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="h-[60vh] p-4 -mx-4 pr-6">
              <div className="space-y-8 p-2">
                 {template.sections.map((section, sectionIndex) => (
                    <div key={section.id} className="space-y-6">
                        <h3 className="text-lg font-semibold border-b pb-2 text-primary">{section.name?.trim() || `Seção ${sectionIndex + 1}`}</h3>
                        <QuestionRenderer questions={section.questions} control={form.control} />
                    </div>
                 ))}
              </div>
            </ScrollArea>
            <DialogFooter className="pt-6 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Enviar formulário</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
