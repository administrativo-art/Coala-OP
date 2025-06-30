
"use client"

import React, { useMemo, useEffect } from 'react';
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

// Helper to recursively build Zod schema from template
// All fields are marked as optional at the schema level because their requirement
// is conditional on their visibility, which is handled during form submission.
const generateSchema = (sections: FormSection[]): z.ZodObject<any> => {
  let schemaObject: { [key: string]: z.ZodType<any, any> } = {};
  
  const buildSchemaPart = (question: FormQuestion) => {
    let fieldSchema: z.ZodType<any, any>;
    switch (question.type) {
      case 'text':
        fieldSchema = z.string().min(1, 'Este campo é obrigatório.');
        break;
      case 'number':
        fieldSchema = z.coerce.number({invalid_type_error: 'Deve ser um número.'});
        break;
      case 'yes-no':
      case 'single-choice':
        fieldSchema = z.string({ required_error: 'Selecione uma opção.' }).min(1, 'Selecione uma opção.');
        break;
      case 'multiple-choice':
        fieldSchema = z.array(z.string()).refine(value => value.length > 0, {
          message: 'Você deve selecionar ao menos uma opção.',
        });
        break;
      default:
        return; // Should not happen
    }
     schemaObject[question.id] = fieldSchema.optional();

    // Recursively add schemas for sub-questions
    question.options?.forEach(option => {
        if (option.subQuestions) {
            option.subQuestions.forEach(buildSchemaPart);
        }
    });
  }

  sections.forEach(section => section.questions.forEach(buildSchemaPart));
  
  return z.object(schemaObject);
}


// ==================== Recursive Question Renderer ====================

function RenderedQuestion({ question, control }: { question: FormQuestion; control: Control<any> }) {
  const answer = useWatch({ control, name: question.id });

  const subQuestions = useMemo(() => {
    if (!question.options || answer === undefined || answer === null || answer === '' || (Array.isArray(answer) && answer.length === 0)) {
      return [];
    }
    // For multiple choice, aggregate subquestions from all selected options
    if (question.type === 'multiple-choice' && Array.isArray(answer)) {
      return question.options
        .filter(opt => answer.includes(opt.value))
        .flatMap(opt => opt.subQuestions || []);
    }
    // For single choice, get subquestions from the selected option
    if (typeof answer === 'string') {
      const selectedOption = question.options.find(opt => opt.value === answer);
      return selectedOption?.subQuestions || [];
    }
    return [];
  }, [answer, question]);

  let inputComponent;

  switch (question.type) {
    case 'text':
        inputComponent = (
          <FormField control={control} name={question.id} render={({ field }) => (
            <FormItem><FormLabel className="text-base">{question.label}</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
          )} />
        );
        break;
    case 'number':
        inputComponent = (
          <FormField control={control} name={question.id} render={({ field }) => (
            <FormItem><FormLabel className="text-base">{question.label}</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
          )} />
        );
        break;
    case 'yes-no':
    case 'single-choice':
        inputComponent = (
          <FormField control={control} name={question.id} render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel className="text-base">{question.label}</FormLabel>
              <FormControl>
                <RadioGroup onValueChange={field.onChange} value={field.value ?? ''} className="flex flex-col space-y-1">
                  {question.options?.map(option => (
                     <FormItem key={option.id} className="flex items-center space-x-3 space-y-0">
                        <FormControl>
                            <RadioGroupItem value={option.value} id={`${question.id}-${option.id}`} />
                        </FormControl>
                        <FormLabel htmlFor={`${question.id}-${option.id}`} className="font-normal cursor-pointer">{option.value}</FormLabel>
                     </FormItem>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        );
        break;
    case 'multiple-choice':
        inputComponent = (
          <FormField
            control={control}
            name={question.id}
            render={({ field }) => (
              <FormItem>
                <div className="mb-4">
                  <FormLabel className="text-base">{question.label}</FormLabel>
                </div>
                {question.options?.map(option => (
                  <FormItem key={option.id} className="flex flex-row items-start space-x-3 space-y-0 mb-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value?.includes(option.value)}
                        onCheckedChange={checked => {
                          const currentValue = Array.isArray(field.value) ? field.value : [];
                          return checked
                            ? field.onChange([...currentValue, option.value])
                            : field.onChange(currentValue.filter((value: string) => value !== option.value));
                        }}
                        id={`${question.id}-${option.id}`}
                      />
                    </FormControl>
                    <FormLabel htmlFor={`${question.id}-${option.id}`} className="font-normal cursor-pointer">
                      {option.value}
                    </FormLabel>
                  </FormItem>
                ))}
                <FormMessage />
              </FormItem>
            )}
          />
        );
        break;
    default:
        inputComponent = null;
  }

  return (
    <div className="space-y-6">
      {inputComponent}
      {subQuestions.length > 0 && (
        <div className="pl-4 border-l-2 ml-2 space-y-6">
          <QuestionRenderer questions={subQuestions} control={control} />
        </div>
      )}
    </div>
  );
}

function QuestionRenderer({ questions, control }: { questions: FormQuestion[]; control: Control<any> }) {
  if (!questions || questions.length === 0) {
    return null;
  }
  return (
    <>
      {questions.map(q => <RenderedQuestion key={q.id} question={q} control={control} />)}
    </>
  );
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
  const [currentStep, setCurrentStep] = React.useState(0);
  
  const formSchema = useMemo(() => generateSchema(template.sections), [template]);
  
  const form = useForm({
    resolver: zodResolver(formSchema),
    mode: 'onTouched', 
  });

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

  useEffect(() => {
    if(open) {
      const allQuestionIds = template.sections.flatMap(s => getAllQuestionIds(s.questions));
      const defaultValues: Record<string, any> = {};
      allQuestionIds.forEach(id => {
        const question = findQuestionById(template.sections, id);
        if (question?.type === 'multiple-choice') {
            defaultValues[id] = [];
        } else {
            defaultValues[id] = '';
        }
      });

      form.reset(defaultValues);
      setCurrentStep(0);
    }
  }, [open, template, form]);

  const getQuestionLabel = (sections: FormSection[], questionId: string): string | undefined => {
      const question = findQuestionById(sections, questionId);
      return question?.label;
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
    
    // Manually trigger validation for visible fields
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
