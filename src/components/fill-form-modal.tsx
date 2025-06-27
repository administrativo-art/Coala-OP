
"use client"

import { useForm, Controller } from 'react-hook-form';
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

type FillFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: FormTemplate;
  addSubmission: (submission: Omit<FormSubmission, 'id'>) => Promise<void>;
};

const isQuestionVisible = (question: FormQuestion, currentAnswers: Record<string, any>): boolean => {
    if (!question.condition?.questionId) {
        return true;
    }
    const sourceAnswer = currentAnswers[question.condition.questionId];
    if (sourceAnswer === undefined) {
        return false;
    }
    if (Array.isArray(sourceAnswer)) {
        return sourceAnswer.includes(question.condition.value);
    }
    return String(sourceAnswer) === question.condition.value;
};

export function FillFormModal({ open, onOpenChange, template, addSubmission }: FillFormModalProps) {
  const { user } = useAuth();
  const { kiosks } = useKiosks();

  const generateFormSchema = () => {
    const schemaObject: { [key: string]: z.ZodType<any, any> } = {};
    template.questions.forEach(q => {
      switch (q.type) {
        case 'text':
          schemaObject[q.id] = z.string().min(1, 'Este campo é obrigatório.');
          break;
        case 'number':
          schemaObject[q.id] = z.coerce.number({invalid_type_error: 'Deve ser um número'});
          break;
        case 'yes-no':
        case 'single-choice':
          schemaObject[q.id] = z.string({ required_error: 'Selecione uma opção.' });
          break;
        case 'multiple-choice':
          schemaObject[q.id] = z.array(z.string()).refine(value => value.some(item => item), {
            message: 'Você deve selecionar ao menos uma opção.',
          });
          break;
        default:
          break;
      }
    });
    return z.object(schemaObject);
  }
  
  const form = useForm({
    resolver: zodResolver(generateFormSchema()),
    defaultValues: template.questions.reduce((acc, q) => ({...acc, [q.id]: q.type === 'multiple-choice' ? [] : undefined}), {})
  });

  const watchedAnswers = form.watch();

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
        .filter(([_, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0))
        .map(([questionId, value]) => ({
          questionId,
          questionLabel: template.questions.find(q => q.id === questionId)?.label || '',
          value,
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
          <DialogDescription>Preencha o formulário abaixo. Os campos marcados com * são obrigatórios.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="h-[60vh] p-4">
              <div className="space-y-6">
                {template.questions.filter(q => isQuestionVisible(q, watchedAnswers)).map((question) => (
                  <FormField
                    key={question.id}
                    control={form.control}
                    name={question.id}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-base">{question.label}</FormLabel>
                        <FormControl>
                          <>
                            {question.type === 'text' && <Textarea {...field} />}
                            {question.type === 'number' && <Input type="number" {...field} />}
                            {(question.type === 'yes-no' || question.type === 'single-choice') && (
                              <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-1">
                                {(question.type === 'yes-no' ? ['Sim', 'Não'] : question.options)?.map(option => (
                                  <FormItem key={option} className="flex items-center space-x-3 space-y-0">
                                    <FormControl><RadioGroupItem value={option} /></FormControl>
                                    <FormLabel className="font-normal">{option}</FormLabel>
                                  </FormItem>
                                ))}
                              </RadioGroup>
                            )}
                            {question.type === 'multiple-choice' && (
                                <div>
                                    {question.options?.map(option => (
                                        <FormField
                                            key={option}
                                            control={form.control}
                                            name={question.id}
                                            render={({ field }) => (
                                                <FormItem key={option} className="flex flex-row items-start space-x-3 space-y-0">
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value?.includes(option)}
                                                            onCheckedChange={(checked) => {
                                                                return checked
                                                                    ? field.onChange([...(field.value || []), option])
                                                                    : field.onChange(field.value?.filter((value: string) => value !== option))
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormLabel className="font-normal">{option}</FormLabel>
                                                </FormItem>
                                            )}
                                        />
                                    ))}
                                </div>
                            )}
                          </>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </ScrollArea>
            <DialogFooter className="pt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Enviar formulário</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
