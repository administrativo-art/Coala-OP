
"use client";

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type FormTemplate } from '@/types';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from './ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { Info, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from './ui/scroll-area';

const settingsSchema = z.object({
  name: z.string().min(1, "O nome do formulário é obrigatório."),
  type: z.enum(['standard', 'operational_checklist']),
  moment: z.enum(['PRE_ABERTURA', 'ABERTURA', 'TROCA_FECHAMENTO', 'TROCA_ABERTURA', 'FECHAMENTO_FINAL']).nullable(),
  submissionTitleFormat: z.string().optional(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

interface FormGeneralSettingsProps {
  template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: Partial<FormTemplate>) => void;
}

export function FormGeneralSettings({ template, onTemplateChange }: FormGeneralSettingsProps) {
  const { toast } = useToast();
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: template.name,
      type: template.type,
      moment: template.moment,
      submissionTitleFormat: template.submissionTitleFormat || '',
    },
  });
  
  // UseEffect to reset form when the template prop changes
    useEffect(() => {
        form.reset({
            name: template.name,
            type: template.type,
            moment: template.moment,
            submissionTitleFormat: template.submissionTitleFormat || '',
        });
    }, [template, form]);


  useEffect(() => {
    const subscription = form.watch((values) => {
        onTemplateChange(values);
    });
    return () => subscription.unsubscribe();
  }, [form.watch, onTemplateChange]);

  const formType = form.watch('type');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `"${text}" copiado!` });
  };

  return (
    <Form {...form}>
        <form className="space-y-4 pt-4">
            <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nome do Formulário</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )}/>
            <FormField control={form.control} name="submissionTitleFormat" render={({ field }) => (
                <FormItem>
                    <FormLabel>Formato do Título da Resposta (Opcional)</FormLabel>
                    <div className="relative">
                        <FormControl>
                            <Input {...field} placeholder="Ex: Checklist {kioskName} - {date}" className="pr-10"/>
                        </FormControl>
                         <Popover>
                            <PopoverTrigger asChild>
                                <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground">
                                    <Info className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Chaves disponíveis</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Use estas chaves para montar um título dinâmico. Clique para copiar.
                                    </p>
                                </div>
                                <div className="mt-4 space-y-2">
                                    <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => copyToClipboard('{kioskName}')}><code>{'{kioskName}'}</code> - Nome do quiosque</Button>
                                    <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => copyToClipboard('{username}')}><code>{'{username}'}</code> - Nome do usuário</Button>
                                    <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => copyToClipboard('{date}')}><code>{'{date}'}</code> - Data do envio</Button>
                                </div>
                                {template.questions && template.questions.length > 0 && (
                                    <>
                                        <h5 className="font-medium text-sm mt-4">Respostas de perguntas:</h5>
                                        <ScrollArea className="h-32 mt-2 rounded-md border p-2">
                                            {template.questions.map(q => (
                                                <Button key={q.id} variant="ghost" size="sm" className="w-full justify-start text-left h-auto" onClick={() => copyToClipboard(`{${q.id}}`)}>
                                                    <code>{`{${q.id}}`}</code> - {q.label}
                                                </Button>
                                            ))}
                                        </ScrollArea>
                                    </>
                                )}
                            </PopoverContent>
                        </Popover>
                    </div>
                    <FormMessage />
                </FormItem>
            )}/>
            <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                    <FormLabel>Tipo de Formulário</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="standard">Padrão (On-Demand)</SelectItem>
                            <SelectItem value="operational_checklist">Checklist Operacional (Automático)</SelectItem>
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )}/>
            {formType === 'operational_checklist' && (
                <FormField control={form.control} name="moment" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Momento do Checklist</FormLabel>
                        <Select onValueChange={(value) => field.onChange(value as any)} value={field.value ?? undefined}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione o momento..."/></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="PRE_ABERTURA">Pré-Abertura</SelectItem>
                                <SelectItem value="ABERTURA">Abertura</SelectItem>
                                <SelectItem value="TROCA_FECHAMENTO">Troca (Fechamento)</SelectItem>
                                <SelectItem value="TROCA_ABERTURA">Troca (Abertura)</SelectItem>
                                <SelectItem value="FECHAMENTO_FINAL">Fechamento Final</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )}/>
            )}
        </form>
    </Form>
  );
}
