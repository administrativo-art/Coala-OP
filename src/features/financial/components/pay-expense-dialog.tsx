"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CalendarIcon, Check, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { financialCollection } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { formatCurrency } from "@/features/financial/lib/utils";
import { consultExpenseProvision } from "@/features/financial/lib/expense-provisions";
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
import type { PaymentBeneficiaryReference } from "@/features/financial/beneficiaries/types";

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
  chargesAccountPlanId: z.string().optional(),
  splits: z.array(splitSchema).min(1, "Adicione ao menos uma forma de pagamento."),
}).superRefine((value, context) => {
  if (value.interest + value.fine > 0.009 && !value.chargesAccountPlanId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["chargesAccountPlanId"],
      message: "Selecione o plano dos encargos.",
    });
  }
});

type PayFormValues = z.infer<typeof paySchema>;

type ExpenseRecord = {
  id: string;
  description: string;
  totalValue: number;
  netPayableValue?: number;
  supplier?: string;
  accountPlanName?: string;
  resultCenter?: string;
  generatedReceiptId?: string;
  beneficiaryReference?: PaymentBeneficiaryReference;
  paymentRequestId?: string;
  accountPlan?: string;
  competenceDate?: unknown;
  provisionCompetence?: string;
  provisionSeriesKey?: string;
  provisionType?: string;
  reconciledProvisionId?: string;
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
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const { data: accountsData } = useFinancialCollection<any>(financialCollection("bankAccounts"));
  const { data: accountPlansData } = useFinancialCollection<any>(financialCollection("accounts"));
  const { data: expensesData } = useFinancialCollection<any>(financialCollection("expenses"));

  const activeAccounts = (accountsData || []).filter((account) => account.active);

  const form = useForm<PayFormValues>({
    resolver: zodResolver(paySchema),
    defaultValues: {
      paidAt: new Date(),
      interest: 0,
      fine: 0,
      notes: "",
      chargesAccountPlanId: "",
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
  const chargesAccountPlanId = form.watch("chargesAccountPlanId") || "";
  const baseValue = expense?.netPayableValue ?? expense?.totalValue ?? 0;
  const totalDue = baseValue + interest + fine;
  const totalPaid = splits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
  const remaining = totalDue - totalPaid;
  const isOver = remaining < -0.01;
  const provisionConsultation = useMemo(
    () => expense ? consultExpenseProvision(expense, expensesData || []) : { status: "not_applicable" as const },
    [expense, expensesData],
  );
  const financialChargePlans = useMemo(() => (accountPlansData || []).filter((plan) => {
    if (plan.active === false || plan.isGroup === true) return false;
    const normalized = String(plan.name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return plan.dre_position === "despesas_financeiras" || /juros|multa|despesas financeiras/.test(normalized);
  }), [accountPlansData]);

  useEffect(() => {
    if (interest + fine <= 0.009 || chargesAccountPlanId || financialChargePlans.length !== 1) return;
    form.setValue("chargesAccountPlanId", financialChargePlans[0].id);
  }, [chargesAccountPlanId, financialChargePlans, fine, form, interest]);

  if (!expense) return null;

  const expenseContext = [expense.supplier, expense.accountPlanName, expense.resultCenter].filter(Boolean).join(" . ");

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
      if (provisionConsultation.status === "ambiguous") {
        throw new Error("Há mais de uma provisão para esta série e competência. Revise-as antes do pagamento.");
      }
      const token = await firebaseUser.getIdToken();
      idempotencyKeyRef.current ||= crypto.randomUUID();
      const response = await fetch(`/api/financial/expenses/${encodeURIComponent(expense.id)}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          idempotencyKey: idempotencyKeyRef.current,
          paidAt: values.paidAt.toISOString(),
          forecastExpenseId: provisionConsultation.status === "matched"
            ? provisionConsultation.provision.id
            : null,
          interest: values.interest ?? 0,
          fine: values.fine ?? 0,
          notes: values.notes ?? "",
          splits: values.splits,
          chargesAccountPlanId: values.chargesAccountPlanId || null,
          chargesAccountPlanName: financialChargePlans.find((plan) => plan.id === values.chargesAccountPlanId)?.name || null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao informar o pagamento.");

      toast({
        title: "Pagamento informado com sucesso.",
        description: "A despesa foi baixada gerencialmente e ficará aguardando a confirmação no extrato.",
      });
      idempotencyKeyRef.current = null;
      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Erro ao registrar pagamento.",
        description: error instanceof Error ? error.message : "Revise os dados e tente novamente.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function requestInterPayment() {
    const target = expense;
    if (!target?.generatedReceiptId || !target.beneficiaryReference || !firebaseUser) return;
    setIsSaving(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/financial/payment-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sourceType: 'generated_receipt', sourceId: target.generatedReceiptId, expenseId: target.id,
          beneficiaryReference: target.beneficiaryReference, amount: target.totalValue,
          description: target.description,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Falha ao criar solicitação bancária.');
      toast({ title: 'Solicitação criada para autorização do Financeiro.', description: 'A despesa permanece pendente até a confirmação do Banco Inter.' });
      onOpenChange(false); onSuccess?.();
    } catch (error) {
      toast({ variant: 'destructive', title: error instanceof Error ? error.message : 'Falha ao solicitar pagamento.' });
    } finally { setIsSaving(false); }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) form.reset();
      }}
    >
      <DialogContent
        className="h-[80vh] max-h-[640px] overflow-hidden p-0"
        style={{
          width: "min(820px, calc(100vw - 64px))",
          maxWidth: "calc(100vw - 64px)",
        }}
      >
        <DialogHeader className="border-b px-6 py-3 text-left">
          <div className="pr-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Registrar pagamento</p>
            <DialogTitle className="mt-1.5 text-[1.35rem] leading-tight sm:text-[1.65rem]">{
              expense.description
            }</DialogTitle>
            <DialogDescription className="mt-1.5 text-sm">
              {expenseContext || formatCurrency(baseValue)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex h-[calc(80vh-74px)] max-h-[566px] flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid min-h-full gap-0 md:grid-cols-[minmax(0,1fr)_250px]">
                <div className="px-4 py-3">
                <div className="space-y-3.5">
                  <div className="grid gap-3">
                    {provisionConsultation.status !== "not_applicable" && (
                      <div className={cn(
                        "rounded-2xl border p-3 text-sm",
                        provisionConsultation.status === "already_reconciled"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : provisionConsultation.status === "matched"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : provisionConsultation.status === "ambiguous"
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : "border-slate-200 bg-slate-50 text-slate-700",
                      )}>
                        <div className="flex items-start gap-2">
                          {provisionConsultation.status === "already_reconciled"
                            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                          <div>
                            <p className="font-semibold">Consulta automática da provisão</p>
                            {provisionConsultation.status === "matched" || provisionConsultation.status === "already_reconciled" ? (
                              <p className="mt-1 leading-5">
                                Competência {provisionConsultation.competence.slice(5, 7)}/{provisionConsultation.competence.slice(0, 4)}:
                                previsto {formatCurrency(provisionConsultation.provisionedValue)}, real {formatCurrency(provisionConsultation.actualValue)}.
                                Diferença {formatCurrency(provisionConsultation.variance)}.
                                {provisionConsultation.status === "matched"
                        ? " A previsão será conciliada na mesma operação do registro."
                                  : " Conciliação já registrada."}
                              </p>
                            ) : provisionConsultation.status === "ambiguous" ? (
                              <p className="mt-1 leading-5">Há mais de uma previsão para a mesma competência; o pagamento ficará bloqueado até a revisão.</p>
                            ) : (
                              <p className="mt-1 leading-5">
                                Nenhuma previsão foi encontrada para {provisionConsultation.competence
                                  ? `${provisionConsultation.competence.slice(5, 7)}/${provisionConsultation.competence.slice(0, 4)}`
                                  : "esta competência"}. O pagamento pode seguir, mas a ausência fica visível para conferência.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
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
                                  className={cn("h-9 rounded-xl pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                                >
                                  {field.value ? format(field.value, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "Selecione a data"}
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
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="interest"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Juros</FormLabel>
                          <FormControl>
                            <Input type="number" min="0" step="0.01" className="h-9 rounded-xl" {...field} />
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
                            <Input type="number" min="0" step="0.01" className="h-9 rounded-xl" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {interest + fine > 0.009 && (
                    <FormField
                      control={form.control}
                      name="chargesAccountPlanId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Plano de contas dos encargos</FormLabel>
                          <Select value={field.value || ""} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="h-9 rounded-xl">
                                <SelectValue placeholder="Selecione juros e multas" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {financialChargePlans.map((plan) => (
                                <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="rounded-2xl border border-border/70 p-3">
                    <div className="mb-3 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold">Formas de pagamento</p>
                        <p className="max-w-sm text-sm leading-5 text-muted-foreground">
                          Divida o pagamento entre contas e m&eacute;todos, se necess&aacute;rio.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl px-3"
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

                    <div className="space-y-2.5">
                      {fields.map((field, index) => {
                        const accountId = form.watch(`splits.${index}.accountId`);
                        const methods = getMethodsForAccount(accountId);

                        return (
                          <div key={field.id} className="rounded-2xl border border-dashed border-border/70 p-2.5">
                            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
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
                                        <SelectTrigger className="h-9 rounded-xl">
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
                                        <SelectTrigger className="h-9 rounded-xl">
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

                            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                              <FormField
                                control={form.control}
                                name={`splits.${index}.amount`}
                                render={({ field: amountField }) => (
                                  <FormItem className="flex-1">
                                    <FormLabel>Valor</FormLabel>
                                    <FormControl>
                                      <Input type="number" min="0" step="0.01" className="h-9 rounded-xl" {...amountField} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <Button type="button" variant="outline" className="h-9 rounded-xl self-end" onClick={() => fillRemaining(index)}>
                                Preencher restante
                              </Button>
                              {fields.length > 1 && (
                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-xl self-end" onClick={() => remove(index)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Observa&ccedil;&otilde;es</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Informações adicionais sobre o pagamento"
                            className="min-h-14 rounded-2xl"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                </div>

                <div className="border-t bg-muted/20 px-3 py-3 md:border-l md:border-t-0">
                  <div className="min-w-0 overflow-hidden rounded-[20px] border border-border/60 bg-background/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Resumo</p>
                  <div className="mt-2.5 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Valor original</span>
                      <span className="font-mono">{formatCurrency(baseValue)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Juros / multa</span>
                      <span className="font-mono">{formatCurrency(interest + fine)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Total informado</span>
                      <span className="font-mono">{formatCurrency(totalPaid)}</span>
                    </div>
                  </div>

                  <div className="my-3 border-t border-border/70" />

                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="text-base font-semibold">Total a debitar</span>
                    <span className="truncate font-mono text-[1.15rem] font-bold leading-none sm:text-[1.35rem]">
                      {formatCurrency(totalDue)}
                    </span>
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-2xl px-4 py-3 text-sm",
                      isOver
                        ? "bg-rose-500/10 text-rose-600"
                        : Math.abs(remaining) < 0.01
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-amber-500/10 text-amber-700"
                    )}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {isOver ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        <span className="truncate">Saldo restante</span>
                      </span>
                      <span className="truncate font-mono">{formatCurrency(Math.abs(remaining))}</span>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border/70 bg-background p-3">
                    <p className="font-medium">Após confirmar:</p>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-600" />
                        Obrigação liquidada gerencialmente
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-600" />
                        Saída informada no fluxo de caixa
                      </div>
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-600" />
                        Confirmação bancária aguardará o extrato
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>

            <DialogFooter className="border-t px-4 py-2.5 sm:justify-between">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <div className="flex flex-wrap gap-2">
                {expense.generatedReceiptId && expense.beneficiaryReference && permissions.financial?.paymentRequests?.create ? <Button type="button" variant="secondary" className="rounded-xl" disabled={isSaving || !!expense.paymentRequestId} onClick={() => void requestInterPayment()}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Solicitar Pix via Banco Inter</Button> : null}
                <Button type="submit" className="rounded-xl" disabled={isSaving || isOver || totalPaid <= 0 || !!expense.generatedReceiptId} title={expense.generatedReceiptId ? 'Recibos gerados pelo Coala são baixados somente após confirmação bancária.' : undefined}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar pagamento manual
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
