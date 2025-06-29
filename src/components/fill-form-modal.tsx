
"use client"

import React, { useState } from 'react';
import { useForm, useWatch, Control } from 'react-hook-form';
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
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/use-auth';
import { useKiosks } from '@/hooks/use-kiosks';
import { type FormTemplate, type FormQuestion, type FormSubmission, type FormSection } from '@/types';

// Helper to recursively get all question IDs from a set of questions
const getAllQuestionIds = (questions: FormQuestion[]): string[] => {
  let ids: string[] = [];
  questions.forEach(q => {
    ids.push(q.id);
    if (q.options) {
      q.options.forEach(opt => {
        if (opt.subQuestions) {
          ids = [...ids, ...getAllQuestionIds(opt.subQuestions)];
        }
      });
    }
  });
  return ids;
};

// Helper to recursively build Zod schema from template
const generateSchema = (sections: FormSection[]): z.ZodObject<any> => {
  let schemaObject: { [key: string]: z.ZodType<any, any> } = {};
  
  const buildSchemaPart = (question: FormQuestion) => {
    switch (question.type) {
      case 'text':
        schemaObject[question.id] = z.string().min(1, 'Este campo é obrigatório.');
        break;
      case 'number':
        schemaObject[question.id] = z.coerce.number({invalid_type_error: 'Deve ser um número'});
        break;
      case 'yes-no':
      case 'single-choice':
        schemaObject[question.id] = z.string({ required_error: 'Selecione uma opção.' });
        break;
      case 'multiple-choice':
        schemaObject[question.id] = z.array(z.string()).refine(value => value.some(item => item), {
          message: 'Você deve selecionar ao menos uma opção.',
        }).optional().default([]);
        break;
      default:
        break;
    }
    // Recursively add schemas for sub-questions
    question.options?.forEach(option => {
        if (option.subQuestions) {
            option.subQuestions.forEach(buildSchemaPart);
        }
    });
  }

  sections.forEach(section => section.questions.forEach(buildSchemaPart));

  const finalSchema = z.object(schemaObject);

  // This function will get all question IDs that should be visible based on the form data
  const getVisibleQuestionIds = (allQuestions: FormQuestion[], data: Record<string, any>): string[] => {
      let visibleIds: string[] = [];

      const recurse = (questions: FormQuestion[]) => {
          questions.forEach(q => {
              visibleIds.push(q.id);
              if (q.options) {
                  const answer = data[q.id];
                  if (answer) {
                       const selectedOptions = q.options.filter(opt => {
                          if (q.type === 'multiple-choice') return Array.isArray(answer) && answer.includes(opt.value);
                          return opt.value === answer;
                      });
                      selectedOptions.forEach(opt => {
                          if (opt.subQuestions) {
                              recurse(opt.subQuestions);
                          }
                      });
                  }
              }
          });
      };
      
      recurse(allQuestions);
      return visibleIds;
  };
  
  // We refine the schema to only validate visible fields
  return finalSchema.superRefine((data, ctx) => {
      const allQuestions = sections.flatMap(s => s.questions);
      const visibleIds = getVisibleQuestionIds(allQuestions, data);
      
      for (const key in data) {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
              if (!visibleIds.includes(key)) {
                  delete (data as any)[key];
              }
          }
      }
      
      const visibleSchema = finalSchema.pick(
        Object.fromEntries(visibleIds.map(id => [id, true]))
      );

      const result = visibleSchema.safeParse(data);
      if (!result.success) {
        result.error.issues.forEach(issue => ctx.addIssue(issue));
      }
  });
}

// ==================== Recursive Question Renderer ====================
type QuestionRendererProps = {
  questions: FormQuestion[];
  control: Control<any>;
}

const QuestionRenderer: React.FC<QuestionRendererProps> = ({ questions, control }) => {
  const formValues = useWatch({ control });

  const getSubQuestionsForQuestion = (question: FormQuestion): FormQuestion[] => {
      if (!question.options) return [];
      
      const answer = formValues[question.id];
      if (answer === undefined || answer === null || (Array.isArray(answer) && answer.length === 0)) {
          return [];
      }

      if (question.type === 'multiple-choice' && Array.isArray(answer)) {
          return question.options
              .filter(opt => answer.includes(opt.value))
              .flatMap(opt => opt.subQuestions || []);
      }
      
      if (typeof answer === 'string') {
          const selectedOption = question.options.find(opt => opt.value === answer);
          return selectedOption?.subQuestions || [];
      }

      return [];
  }

  if (!questions || questions.length === 0) {
    return null;
  }

  return (
    <>
      {questions.map(question => (
        <div key={question.id} className="space-y-6">
            {question.type === 'text' && (
                <FormField control={control} name={question.id} render={({ field }) => (
                    <FormItem><FormLabel className="text-base">{question.label}</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
                )} />
            )}
            {question.type === 'number' && (
                <FormField control={control} name={question.id} render={({ field }) => (
                    <FormItem><FormLabel className="text-base">{question.label}</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
            )}
            {(question.type === 'yes-no' || question.type === 'single-choice') && (
                <FormField control={control} name={question.id} render={({ field }) => (
                    <FormItem className="space-y-3">
                        <FormLabel className="text-base">{question.label}</FormLabel>
                        <FormControl>
                            <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-col space-y-1">
                                {question.options?.map(option => (
                                <FormItem key={option.id} className="flex items-center space-x-3 space-y-0">
                                    <FormControl>
                                        <RadioGroupItem value={option.value} />
                                    </FormControl>
                                    <FormLabel className="font-normal">{option.value}</FormLabel>
                                </FormItem>
                                ))}
                            </RadioGroup>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
            )}
            {question.type === 'multiple-choice' && (
                <FormField control={control} name={question.id} render={({ field }) => (
                    <FormItem>
                        <div className="mb-4">
                           <FormLabel className="text-base">{question.label}</FormLabel>
                        </div>
                        <div className="space-y-2">
                        {question.options?.map((option) => (
                            <FormItem key={option.id} className="flex flex-row items-center space-x-3 space-y-0">
                            <FormControl>
                                <Checkbox
                                    checked={field.value?.includes(option.value)}
                                    onCheckedChange={(checked) => {
                                        return checked
                                        ? field.onChange([...(field.value || []), option.value])
                                        : field.onChange(field.value?.filter((value: string) => value !== option.value));
                                    }}
                                />
                            </FormControl>
                            <FormLabel className="font-normal">{option.value}</FormLabel>
                            </FormItem>
                        ))}
                        </div>
                        <FormMessage />
                    </FormItem>
                )} />
            )}
            
            <div className="pl-4 border-l-2 ml-2 space-y-6">
                <QuestionRenderer questions={getSubQuestionsForQuestion(question)} control={control} />
            </div>
        </div>
      ))}
    </>
  );
};


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
  const [currentStep, setCurrentStep] = useState(0);
  
  const formSchema = React.useMemo(() => generateSchema(template.sections), [template]);
  
  const form = useForm({
    resolver: zodResolver(formSchema),
    mode: 'onChange', 
  });

  React.useEffect(() => {
    if(open) {
      const defaultValues: Record<string, any> = {};
      const allIds = getAllQuestionIds(template.sections.flatMap(s => s.questions));
      allIds.forEach(id => {
        defaultValues[id] = undefined;
      });

      form.reset(defaultValues);
      setCurrentStep(0);
    }
  }, [open, template, form]);


  const getQuestionLabel = (sections: FormSection[], questionId: string): string | undefined => {
      for (const section of sections) {
        const findInQuestions = (questions: FormQuestion[]): string | undefined => {
          for (const q of questions) {
            if (q.id === questionId) return q.label;
            if (q.options) {
              for (const opt of q.options) {
                if (opt.subQuestions) {
                    const label = findInQuestions(opt.subQuestions);
                    if (label) return label;
                }
              }
            }
          }
          return undefined;
        }
        const label = findInQuestions(section.questions);
        if (label) return label;
      }
      return undefined;
  }
  
  const getVisibleQuestionIdsForSection = (section: FormSection, formValues: Record<string, any>): string[] => {
    let ids: string[] = [];
    const recurse = (questions: FormQuestion[]) => {
      questions.forEach(q => {
        ids.push(q.id);
        const answer = formValues[q.id];
        if (q.options && answer) {
          const selectedOptions = q.options.filter(opt => {
            if (q.type === 'multiple-choice') return Array.isArray(answer) && answer.includes(opt.value);
            return opt.value === answer;
          });
          selectedOptions.forEach(opt => {
            if (opt.subQuestions) {
              recurse(opt.subQuestions);
            }
          });
        }
      });
    }
    recurse(section.questions);
    return ids;
  }

  const handleNext = async () => {
    const currentSection = template.sections[currentStep];
    const fieldsToValidate = getVisibleQuestionIdsForSection(currentSection, form.getValues());
    
    const isValid = await form.trigger(fieldsToValidate as any);

    if(isValid) {
      setCurrentStep(prev => prev + 1);
    }
  }

  const handlePrevious = () => {
    setCurrentStep(prev => prev - 1);
  }

  const onSubmit = (values: Record<string, any>) => {
    if (!user) return;
    const kiosk = kiosks.find(k => k.id === user.kioskId);

    const submission: Omit<FormSubmission, 'id'> = {
      templateId: template.id,
      templateName: template.name,
      userId: user.id,
      username: user.username,
      kioskId: kiosk?.id || 'N/A',
      kioskName: kiosk?.name || 'N/A',
      createdAt: new Date().toISOString(),
      answers: Object.entries(values)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0))
        .map(([questionId, value]) => ({
          questionId,
          questionLabel: getQuestionLabel(template.sections, questionId) || '',
          value,
        })),
    };

    addSubmission(submission);
    onOpenChange(false);
  };

  const progress = ((currentStep + 1) / template.sections.length) * 100;
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
           <div className="pt-2">
            <p className="text-sm text-muted-foreground text-center mb-2">
              Etapa {currentStep + 1} de {template.sections.length}: {template.sections[currentStep].name}
            </p>
            <Progress value={progress} className="w-full" />
           </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="h-[50vh] p-4">
              <div className="space-y-6">
                 <QuestionRenderer questions={template.sections[currentStep].questions} control={form.control} />
              </div>
            </ScrollArea>
            <DialogFooter className="pt-6 border-t">
              <div className="w-full flex justify-between">
                <Button type="button" variant="outline" onClick={handlePrevious} disabled={currentStep === 0}>
                  Anterior
                </Button>

                {currentStep < template.sections.length - 1 ? (
                  <Button type="button" onClick={handleNext}>
                    Próxima
                  </Button>
                ) : (
                  <Button type="submit">
                    Enviar formulário
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
