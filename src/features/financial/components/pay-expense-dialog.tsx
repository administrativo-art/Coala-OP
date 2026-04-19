"use client";

import { useMemo, useState } from "react";
import { addDoc, deleteDoc, doc, Timestamp, updateDoc } from "firebase/firestore";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CalendarIcon, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { formatCurrency } from "@/features/financial/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const splitSchema = z.object({
  accountId: z.string().min(1, "Selecione uma conta."),
  accountName: z.string(),
  paymentMethodId: z.string().min(1, "Selecione a forma de pagamento."),
  paymentMethodLabel: z.string(),
  amount: z.coerce.number().positive("Informe um valor maior que zero."),
});

const paySchema = z.object({
  paidAt: z.date({ required_error: "Informe a data do pagamento." }),
  interest: z.coerce.number().min(0).default(0),
  fine: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  splits: z.array(splitSchema).min(1, "Adicione ao menos uma forma de pagamento."),
});

type PayFormValues = z.infer<typeof paySchema>;

type ExpenseRecord = {
  id: string;
  description: string;
  totalValue: number;
  supplier?: string;
};

export function PayExpenseDialog({
  expense,
  open,
  onOpenChange,
  onSuccess,
}: {
  expense: ExpenseRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const { data: accountsData } = useFinancialCollection<any>(financialCollection("bankAccounts"));

  const activeAccounts = (accountsData || []).filter((account) => account.active);

  const form = useForm<PayFormValues>({
    resolver: zodResolver(paySchema),
    defaultValues: {
      paidAt: new Date(),
      interest: 0,
      fine: 0,
      notes: "",
      splits: [
        {
          accountId: "",
          accountName: "",
          paymentMethodId: "",
          paymentMethodLabel: "",
          amount: 0,
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "splits" });
  const splits = form.watch("splits");
  const interest = Number(form.watch("interest")) || 0;
  const fine = Number(form.watch("fine")) || 0;
  const baseValue = expense?.totalValue ?? 0;
  const totalDue = baseValue + interest + fine;
  const totalPaid = splits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
  const remaining = totalDue - totalPaid;
  const isOver = remaining < -0.01;

  function getMethodsForAccount(accountId: string) {
    return activeAccounts.find((account) => account.id === accountId)?.paymentMethods ?? [];
  }

  function handleAccountChange(index: number, accountId: string) {
    const account = activeAccounts.find((item) => item.id === accountId);
    if (!account) return;

    form.setValue(`splits.${index}.accountName`, account.name);
    form.setValue(`splits.${index}.paymentMethodId`, "");
    form.setValue(`splits.${index}.paymentMethodLabel`, "");
  }

  function handleMethodChange(index: number, accountId: string, methodId: string) {
    const method = getMethodsForAccount(accountId).find((item: any) => item.id === methodId);
    form.setValue(`splits.${index}.paymentMethodLabel`, method?.label || "");
  }

  function fillRemaining(index: number) {
    const otherTotal = splits
      .filter((_, currentIndex) => currentIndex !== index)
      .reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
    const rest = totalDue - otherTotal;
    if (rest > 0) {
      form.setValue(`splits.${index}.amount`, Number.parseFloat(rest.toFixed(2)));
    }
  }

  async function onSubmit(values: PayFormValues) {
    if (!expense || !firebaseUser) return;
    if (isOver) {
      toast({ variant: "destructive", title: "O valor total excede o valor a pagar." });
      return;
    }

    setIsSaving(true);
    try {
      const paidAt = Timestamp.fromDate(values.paidAt);
      const now = Timestamp.now();
      const basePayload = {
        expenseId: expense.id,
        paidAt,
        baseValue,
        interest: values.interest ?? 0,
        fine: values.fine ?? 0,
        charges: values.interest + values.fine,
        totalPaid,
        splits: values.splits,
        notes: values.notes ?? "",
        createdBy: firebaseUser.uid,
        createdAt: now,
      };

      await addDoc(financialCollection("payments"), basePayload);
      await updateDoc(financialDoc("expenses", expense.id), {
        status: "paid",
        paidAt,
      });

      if (values.interest + values.fine > 0.009) {
        await addDoc(financialCollection("expenses"), {
          description: `Juros/Multa — ${expense.description}`,
          accountPlanName: "Despesas Financeiras",
          accountPlan: "despesas-financeiras",
          totalValue: Number.parseFloat((values.interest + values.fine).toFixed(2)),
          status: "paid",
          type: "encargo",
          originExpenseId: expense.id,
          supplier: expense.supplier ?? "",
          dueDate: paidAt,
          competenceDate: paidAt,
          paidAt,
          createdBy: firebaseUser.uid,
          createdAt: now,
          interest: values.interest ?? 0,
          fine: values.fine ?? 0,
        });
      }

      toast({ title: "Pagamento registrado com sucesso!" });
      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao registrar pagamento." });
    } finally {
      setIsSaving(false);
    }
  }

  if (!expense) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) form.reset();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Registrar pagamento</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{expense.description}</span>
            <span className="mx-2 opacity-40">·</span>
            <span className="font-bold text-foreground">{formatCurrency(baseValue)}</span>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="paidAt"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Data do pagamento</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                        >
                          {field.value ? format(field.value, "PPP", { locale: ptBR }) : "Selecione a data"}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="interest"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Juros</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fine"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Multa</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Formas de pagamento</p>
                  <p className="text-xs text-muted-foreground">
                    Divida o pagamento entre contas e métodos, se necessário.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({
                      accountId: "",
                      accountName: "",
                      paymentMethodId: "",
                      paymentMethodLabel: "",
                      amount: 0,
                    })
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>

              <div className="space-y-4">
                {fields.map((field, index) => {
                  const accountId = form.watch(`splits.${index}.accountId`);
                  const methods = getMethodsForAccount(accountId);

                  return (
                    <div key={field.id} className="rounded-lg border border-dashed p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name={`splits.${index}.accountId`}
                          render={({ field: accountField }) => (
                            <FormItem>
                              <FormLabel>Conta</FormLabel>
                              <Select
                                value={accountField.value}
                                onValueChange={(value) => {
                                  accountField.onChange(value);
                                  handleAccountChange(index, value);
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione a conta" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {activeAccounts.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                      {account.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`splits.${index}.paymentMethodId`}
                          render={({ field: methodField }) => (
                            <FormItem>
                              <FormLabel>Forma de pagamento</FormLabel>
                              <Select
                                value={methodField.value}
                                onValueChange={(value) => {
                                  methodField.onChange(value);
                                  handleMethodChange(index, accountId, value);
                                }}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione a forma" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {methods.map((method: any) => (
                                    <SelectItem key={method.id} value={method.id}>
                                      {method.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="mt-3 flex items-end gap-3">
                        <FormField
                          control={form.control}
                          name={`splits.${index}.amount`}
                          render={({ field: amountField }) => (
                            <FormItem className="flex-1">
                              <FormLabel>Valor</FormLabel>
                              <FormControl>
                                <Input type="number" min="0" step="0.01" {...amountField} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="button" variant="outline" onClick={() => fillRemaining(index)}>
                          Preencher restante
                        </Button>
                        {fields.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span>Valor base</span>
                  <span>{formatCurrency(baseValue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Encargos</span>
                  <span>{formatCurrency(interest + fine)}</span>
                </div>
                <div className="flex items-center justify-between font-semibold">
                  <span>Total a pagar</span>
                  <span>{formatCurrency(totalDue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total informado</span>
                  <span>{formatCurrency(totalPaid)}</span>
                </div>
                <div
                  className={cn(
                    "mt-2 flex items-center justify-between rounded-md px-3 py-2 text-sm",
                    isOver
                      ? "bg-rose-500/10 text-rose-600"
                      : Math.abs(remaining) < 0.01
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-amber-500/10 text-amber-600"
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isOver ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    Saldo restante
                  </span>
                  <span>{formatCurrency(Math.abs(remaining))}</span>
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Informações adicionais sobre o pagamento" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving || isOver || totalPaid <= 0}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar pagamento
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
