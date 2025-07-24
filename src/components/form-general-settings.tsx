
"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type FormTemplate } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';

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
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: template.name,
      type: template.type,
      moment: template.moment,
      submissionTitleFormat: template.submissionTitleFormat || '',
    },
  });

  React.useEffect(() => {
    const subscription = form.watch((values) => {
        onTemplateChange(values);
    });
    return () => subscription.unsubscribe();
  }, [form.watch, onTemplateChange]);

  const formType = form.watch('type');

  return (
    <Card>
        <CardHeader>
            <CardTitle>Configurações Gerais</CardTitle>
            <CardDescription>
                Defina o nome e o comportamento do formulário.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <Form {...form}>
                <form className="space-y-4">
                    <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Nome do Formulário</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )}/>
                    <FormField control={form.control} name="submissionTitleFormat" render={({ field }) => (
                        <FormItem><FormLabel>Formato do Título da Resposta (Opcional)</FormLabel><FormControl><Input {...field} placeholder="Ex: Checklist {kioskName} - {date}" /></FormControl><FormMessage /></FormItem>
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
        </CardContent>
    </Card>
  );
}
