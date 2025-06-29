
"use client"

import React, { useState } from 'react';
import { useForm, Controller, useWatch, Control } from 'react-hook-form';
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
        ids = [...ids, ...getAllQuestionIds(opt.subQuestions)];
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
        });
        break;
      default:
        break;
    }
    // Recursively add schemas for sub-questions
    question.options?.forEach(option => {
        option.subQuestions.forEach(buildSchemaPart);
    });
  }

  sections.forEach(section => section.questions.forEach(buildSchemaPart));
  return z.object(schemaObject);
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
      if (!answer) return [];

      if (question.type === 'multiple-choice' && Array.isArray(answer)) {
          return question.options.filter(opt => answer.includes(opt.value)).flatMap(opt => opt.subQuestions);
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
        <div key={question.id} className="space-y-4">
          <FormField
            control={control}
            name={question.id}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">{question.label}</FormLabel>
                <FormControl>
                  <div>
                    {question.type === 'text' && <Textarea {...field} />}
                    {question.type === 'number' && <Input type="number" {...field} />}
                    {(question.type === 'yes-no' || question.type === 'single-choice') && (
                      <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-col space-y-1">
                        {question.options?.map(option => (
                          <FormItem key={option.id} className="flex items-center space-x-3 space-y-0">
                            <FormControl><RadioGroupItem value={option.value} /></FormControl>
                            <FormLabel className="font-normal">{option.value}</FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    )}
                    {question.type === 'multiple-choice' && (
                        <div>
                            {question.options?.map(option => (
                                <FormField
                                    key={option.id}
                                    control={control}
                                    name={question.id}
                                    render={({ field: checkboxField }) => (
                                        <FormItem key={option.id} className="flex flex-row items-start space-x-3 space-y-0">
                                            <FormControl>
                                                <Checkbox
                                                    checked={checkboxField.value?.includes(option.value)}
                                                    onCheckedChange={(checked) => {
                                                        const currentValues = checkboxField.value || [];
                                                        return checked
                                                            ? checkboxField.onChange([...currentValues, option.value])
                                                            : checkboxField.onChange(currentValues.filter((v: string) => v !== option.value))
                                                    }}
                                                />
                                            </FormControl>
                                            <FormLabel className="font-normal">{option.value}</FormLabel>
                                        </FormItem>
                                    )}
                                />
                            ))}
                        </div>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="pl-4 border-l-2 ml-2">
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
  
  const formSchema = generateSchema(template.sections);
  const form = useForm({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
  });

  const getQuestionLabel = (sections: FormSection[], questionId: string): string | undefined => {
      for (const section of sections) {
        const findInQuestions = (questions: FormQuestion[]): string | undefined => {
          for (const q of questions) {
            if (q.id === questionId) return q.label;
            if (q.options) {
              for (const opt of q.options) {
                const label = findInQuestions(opt.subQuestions);
                if (label) return label;
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

  const handleNext = async () => {
    const currentSection = template.sections[currentStep];
    const fieldsToValidate = getAllQuestionIds(currentSection.questions);
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
            <DialogFooter className="pt-6">
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
