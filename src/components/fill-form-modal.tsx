
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


const getAllQuestionIds = (sections: FormSection[]): FormQuestion[] => {
    const questions: FormQuestion[] = [];
    const recurse = (qs: FormQuestion[]) => {
        qs.forEach(q => {
            questions.push(q);
            if (q.options) {
                q.options.forEach(opt => {
                    if(opt.subQuestions) recurse(opt.subQuestions);
                });
            }
        });
    };
    sections.forEach(sec => recurse(sec.questions));
    return questions;
};

const getVisibleQuestionIds = (sections: FormSection[], formValues: Record<string, any>): Set<string> => {
    const visibleIds = new Set<string>();
    const recurse = (questions: FormQuestion[]) => {
        questions.forEach(q => {
            visibleIds.add(q.id);
            const answer = formValues[q.id];
            if (q.options && answer) {
                const selectedOptions = q.options.filter(opt =>
                    q.type === 'multiple-choice'
                        ? Array.isArray(answer) && answer.includes(opt.value)
                        : opt.value === answer
                );
                selectedOptions.forEach(opt => {
                    if (opt.subQuestions) {
                        recurse(opt.subQuestions);
                    }
                });
            }
        });
    };
    sections.forEach(sec => recurse(sec.questions));
    return visibleIds;
};

const generateSchema = (template: FormTemplate) => {
    const allQuestions = getAllQuestionIds(template.sections);
    let schemaObject: { [key: string]: z.ZodType<any, any> } = {};

    allQuestions.forEach(question => {
        switch (question.type) {
            case 'text':
                schemaObject[question.id] = z.string();
                break;
            case 'number':
                schemaObject[question.id] = z.coerce.number();
                break;
            case 'yes-no':
            case 'single-choice':
                schemaObject[question.id] = z.string();
                break;
            case 'multiple-choice':
                schemaObject[question.id] = z.array(z.string());
                break;
            default:
                schemaObject[question.id] = z.any();
        }
    });

    return z.object(schemaObject).superRefine((data, ctx) => {
        const visibleIds = getVisibleQuestionIds(template.sections, data);
        visibleIds.forEach(id => {
            const value = data[id];
            if (value === '' || value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [id],
                    message: "Campo obrigatório",
                });
            }
        });
    });
}


// ==================== Recursive Question Renderer ====================
function RenderedQuestion({ question, control }: { question: FormQuestion; control: Control<any> }) {
    const answer = useWatch({ control, name: question.id });
    
    const subQuestions = useMemo(() => {
        if (!question.options || answer === undefined || answer === null || answer === '') {
            return [];
        }
        if (question.type === 'multiple-choice' && Array.isArray(answer)) {
            return question.options.filter(opt => answer.includes(opt.value)).flatMap(opt => opt.subQuestions || []);
        }
        if (typeof answer === 'string') {
            const selectedOption = question.options.find(opt => opt.value === answer);
            return selectedOption?.subQuestions || [];
        }
        return [];
    }, [answer, question]);

    return (
        <div className="space-y-6">
            <FormField
                control={control}
                name={question.id as FieldPath<FieldValues>}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-base">{question.label}</FormLabel>
                        <FormControl>
                             {question.type === 'text' && <Textarea {...field} value={field.value ?? ''} />}
                             {question.type === 'number' && <Input type="number" {...field} value={field.value ?? ''} />}
                             {(question.type === 'yes-no' || question.type === 'single-choice') && (
                                <RadioGroup onValueChange={field.onChange} value={field.value ?? ''} className="flex flex-col space-y-1">
                                    {question.options?.map(option => (
                                        <div key={option.id} className="flex items-center space-x-3 space-y-0">
                                            <RadioGroupItem value={option.value} id={`${question.id}-${option.id}`} />
                                            <Label htmlFor={`${question.id}-${option.id}`} className="font-normal cursor-pointer">{option.value}</Label>
                                        </div>
                                    ))}
                                </RadioGroup>
                             )}
                             {question.type === 'multiple-choice' && (
                                <div className="space-y-2">
                                    {question.options?.map(option => (
                                        <div key={option.id} className="flex flex-row items-start space-x-3 space-y-0">
                                            <Checkbox
                                                checked={field.value?.includes(option.value)}
                                                onCheckedChange={(checked) => {
                                                    const currentValues = field.value || [];
                                                    const newValues = checked
                                                        ? [...currentValues, option.value]
                                                        : currentValues.filter((value: string) => value !== option.value);
                                                    field.onChange(newValues);
                                                }}
                                                id={`${question.id}-${option.id}`}
                                            />
                                            <Label htmlFor={`${question.id}-${option.id}`} className="font-normal cursor-pointer">{option.value}</Label>
                                        </div>
                                    ))}
                                </div>
                             )}
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
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

    const allQuestions = useMemo(() => getAllQuestionIds(template.sections), [template]);
    
    const formSchema = useMemo(() => generateSchema(template), [template]);
    
    const defaultValues = useMemo(() => {
        const values: Record<string, any> = {};
        allQuestions.forEach(q => {
            values[q.id] = q.type === 'multiple-choice' ? [] : '';
        });
        return values;
    }, [allQuestions]);

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
    
    const findQuestionById = (sections: FormSection[], questionId: string): FormQuestion | null => {
      for (const section of sections) {
          const findInQuestions = (questions: FormQuestion[]): FormQuestion | null => {
              for (const q of questions) {
                  if (q.id === questionId) return q;
                  if (q.options) {
                      for (const opt of q.options) {
                          if (opt.subQuestions) {
                              const found = findInQuestions(opt.subQuestions);
                              if (found) return found;
                          }
                      }
                  }
              }
              return null;
          };
          const found = findInQuestions(section.questions);
          if (found) return found;
      }
      return null;
    };

    const getQuestionLabel = (questionId: string): string => {
        const question = allQuestions.find(q => q.id === questionId);
        return question?.label || '';
    }

    const onSubmit = (values: Record<string, any>) => {
        if (!user) return;
        const kiosk = kiosks.find(k => k.id === user.kioskId);

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
              .map(questionId => ({
                  questionId,
                  questionLabel: getQuestionLabel(questionId),
                  value: values[questionId],
              })),
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
                 {template.sections.map(section => (
                    <div key={section.id} className="space-y-6">
                        <h2 className="text-xl font-semibold border-b pb-2">{section.name}</h2>
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
