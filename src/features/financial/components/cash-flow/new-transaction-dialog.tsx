"use client";

import { useMemo, useState } from "react";
import { addDoc, Timestamp } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeftRight, CalendarIcon, Loader2, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { financialCollection } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { REVENUE_CATEGORY_LABELS } from "@/features/financial/types/transaction";
import type { Account } from "@/features/financial/types/account";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const baseSchema = z.object({
  accountId: z.string().min(1, "Selecione uma conta."),
  paymentMethodId: z.string().min(1, "Selecione a forma de pagamento."),
  amount: z.coerce.number().positive("Informe um valor maior que zero."),
  date: z.date({ required_error: "Informe a data." }),
  description: z.string().min(3, "Informe uma descrição."),
  notes: z.string().optional(),
});

const revenueSchema = baseSchema.extend({
  revenueCategory: z.string().min(1, "Selecione a categoria."),
  revenueSource: z.string().optional(),
  isRecurring: z.boolean().default(false),
  recurringDay: z.coerce.number().min(1).max(31).optional(),
});

const transferSchema = z
  .object({
    fromAccountId: z.string().min(1, "Selecione uma conta."),
    fromPaymentMethodId: z.string().min(1, "Selecione a forma de pagamento."),
    toAccountId: z.string().min(1, "Selecione a conta de destino."),
    toPaymentMethodId: z.string().min(1, "Selecione a forma de pagamento."),
    amount: z.coerce.number().positive("Informe um valor maior que zero."),
    date: z.date({ required_error: "Informe a data." }),
    description: z.string().min(3, "Informe uma descrição."),
    notes: z.string().optional(),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "Origem e destino não podem ser a mesma conta.",
    path: ["toAccountId"],
  });

const adjustmentSchema = baseSchema.extend({
  direction: z.enum(["in", "out"]),
  reason: z.string().min(5, "Descreva o motivo do ajuste."),
});

type RevenueValues = z.infer<typeof revenueSchema>;
type TransferValues = z.infer<typeof transferSchema>;
type AdjustmentValues = z.infer<typeof adjustmentSchema>;

export function NewTransactionDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"revenue" | "transfer" | "adjustment">("revenue");
  const [isSaving, setIsSaving] = useState(false);
  const { data: accountsData } = useFinancialCollection<Account>(financialCollection("bankAccounts"));
  const activeAccounts = (accountsData || []).filter((account) => account.active);

  const revenueForm = useForm<RevenueValues>({
    resolver: zodResolver(revenueSchema),
    defaultValues: { date: new Date(), isRecurring: false, notes: "", revenueSource: "" },
  });
  const transferForm = useForm<TransferValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { date: new Date(), notes: "" },
  });
  const adjustmentForm = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { date: new Date(), direction: "in", notes: "" },
  });

  function getMethodsForAccount(accountId: string) {
    return activeAccounts.find((account) => account.id === accountId)?.paymentMethods ?? [];
  }

  function getAccountName(accountId: string) {
    return activeAccounts.find((account) => account.id === accountId)?.name ?? "";
  }

  function getMethodLabel(accountId: string, methodId: string) {
    return getMethodsForAccount(accountId).find((method: any) => method.id === methodId)?.label ?? "";
  }

  async function saveRevenue(values: RevenueValues) {
    if (!firebaseUser) return;
    setIsSaving(true);
    try {
      await addDoc(financialCollection("transactions"), {
        type: values.isRecurring ? "revenue_recurring" : "revenue",
        direction: "in",
        accountId: values.accountId,
        accountName: getAccountName(values.accountId),
        paymentMethodId: values.paymentMethodId,
        paymentMethodLabel: getMethodLabel(values.accountId, values.paymentMethodId),
        amount: values.amount,
        date: Timestamp.fromDate(values.date),
        description: values.description,
        revenueCategory: values.revenueCategory,
        revenueSource: values.revenueSource ?? "",
        isRecurring: values.isRecurring,
        recurringDay: values.isRecurring ? values.recurringDay : null,
        notes: values.notes ?? "",
        createdBy: firebaseUser.uid,
        createdAt: Timestamp.now(),
      });
      toast({ title: "Receita registrada com sucesso!" });
      revenueForm.reset({ date: new Date(), isRecurring: false, notes: "", revenueSource: "" });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ variant: "destructive", title: "Erro ao salvar receita." });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveTransfer(values: TransferValues) {
    if (!firebaseUser) return;
    setIsSaving(true);
    try {
      const now = Timestamp.now();
      const date = Timestamp.fromDate(values.date);

      await Promise.all([
        addDoc(financialCollection("transactions"), {
          type: "transfer_out",
          direction: "out",
          accountId: values.fromAccountId,
          accountName: getAccountName(values.fromAccountId),
          paymentMethodId: values.fromPaymentMethodId,
          paymentMethodLabel: getMethodLabel(values.fromAccountId, values.fromPaymentMethodId),
          toAccountId: values.toAccountId,
          toAccountName: getAccountName(values.toAccountId),
          amount: values.amount,
          date,
          description: values.description,
          notes: values.notes ?? "",
          createdBy: firebaseUser.uid,
          createdAt: now,
        }),
        addDoc(financialCollection("transactions"), {
          type: "transfer_in",
          direction: "in",
          accountId: values.toAccountId,
          accountName: getAccountName(values.toAccountId),
          paymentMethodId: values.toPaymentMethodId,
          paymentMethodLabel: getMethodLabel(values.toAccountId, values.toPaymentMethodId),
          toAccountId: values.fromAccountId,
          toAccountName: getAccountName(values.fromAccountId),
          amount: values.amount,
          date,
          description: values.description,
          notes: values.notes ?? "",
          createdBy: firebaseUser.uid,
          createdAt: now,
        }),
      ]);
      toast({ title: "Transferência registrada!" });
      transferForm.reset({ date: new Date(), notes: "" });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ variant: "destructive", title: "Erro ao registrar transferência." });
    } finally {
      setIsSaving(false);
    }
  }

  async function saveAdjustment(values: AdjustmentValues) {
    if (!firebaseUser) return;
    setIsSaving(true);
    try {
      await addDoc(financialCollection("transactions"), {
        type: "adjustment",
        direction: values.direction,
        accountId: values.accountId,
        accountName: getAccountName(values.accountId),
        paymentMethodId: values.paymentMethodId,
        paymentMethodLabel: getMethodLabel(values.accountId, values.paymentMethodId),
        amount: values.amount,
        date: Timestamp.fromDate(values.date),
        description: values.description,
        notes: values.reason,
        createdBy: firebaseUser.uid,
        createdAt: Timestamp.now(),
      });
      toast({ title: "Ajuste de saldo registrado!" });
      adjustmentForm.reset({ date: new Date(), direction: "in", notes: "" });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({ variant: "destructive", title: "Erro ao salvar ajuste." });
    } finally {
      setIsSaving(false);
    }
  }

  const renderDateField = <T extends RevenueValues | TransferValues | AdjustmentValues>(
    form: ReturnType<typeof useForm<T>>,
    name: "date"
  ) => (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem className="flex flex-col">
          <FormLabel>Data</FormLabel>
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
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo lançamento financeiro</DialogTitle>
          <DialogDescription>
            Registre receitas, transferências internas ou ajustes de saldo no banco dedicado do módulo financeiro.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="revenue">
              <TrendingUp className="mr-2 h-4 w-4" /> Receita
            </TabsTrigger>
            <TabsTrigger value="transfer">
              <ArrowLeftRight className="mr-2 h-4 w-4" /> Transferência
            </TabsTrigger>
            <TabsTrigger value="adjustment">
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Ajuste
            </TabsTrigger>
          </TabsList>

          <TabsContent value="revenue" className="pt-4">
            <Form {...revenueForm}>
              <form onSubmit={revenueForm.handleSubmit(saveRevenue)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={revenueForm.control}
                    name="accountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
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
                    control={revenueForm.control}
                    name="paymentMethodId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Forma de pagamento</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione a forma" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {getMethodsForAccount(revenueForm.watch("accountId")).map((method: any) => (
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

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={revenueForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="0.01" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {renderDateField(revenueForm, "date")}
                </div>

                <FormField
                  control={revenueForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Input placeholder="Descrição do lançamento" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={revenueForm.control}
                    name="revenueCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Categoria</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione a categoria" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.entries(REVENUE_CATEGORY_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={revenueForm.control}
                    name="revenueSource"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Origem</FormLabel>
                        <FormControl>
                          <Input placeholder="Cliente, contrato ou referência" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={revenueForm.control}
                  name="isRecurring"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>Receita recorrente</FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Marque para registrar a recorrência esperada dessa receita.
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {revenueForm.watch("isRecurring") && (
                  <FormField
                    control={revenueForm.control}
                    name="recurringDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dia de recorrência</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" max="31" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={revenueForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Observações</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Detalhes adicionais" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar receita
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="transfer" className="pt-4">
            <Form {...transferForm}>
              <form onSubmit={transferForm.handleSubmit(saveTransfer)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={transferForm.control}
                    name="fromAccountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta de origem</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
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
                    control={transferForm.control}
                    name="toAccountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta de destino</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
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
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={transferForm.control}
                    name="fromPaymentMethodId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Método de origem</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione a forma" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {getMethodsForAccount(transferForm.watch("fromAccountId")).map((method: any) => (
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
                  <FormField
                    control={transferForm.control}
                    name="toPaymentMethodId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Método de destino</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione a forma" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {getMethodsForAccount(transferForm.watch("toAccountId")).map((method: any) => (
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

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={transferForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="0.01" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {renderDateField(transferForm, "date")}
                </div>

                <FormField
                  control={transferForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Input placeholder="Descrição da transferência" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={transferForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Observações</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Detalhes adicionais" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar transferência
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="adjustment" className="pt-4">
            <Form {...adjustmentForm}>
              <form onSubmit={adjustmentForm.handleSubmit(saveAdjustment)} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={adjustmentForm.control}
                    name="accountId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Conta</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
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
                    control={adjustmentForm.control}
                    name="paymentMethodId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Forma de pagamento</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione a forma" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {getMethodsForAccount(adjustmentForm.watch("accountId")).map((method: any) => (
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

                <div className="grid gap-4 md:grid-cols-3">
                  <FormField
                    control={adjustmentForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Valor</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" step="0.01" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {renderDateField(adjustmentForm, "date")}
                  <FormField
                    control={adjustmentForm.control}
                    name="direction"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Direção</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="in">Entrada</SelectItem>
                            <SelectItem value="out">Saída</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={adjustmentForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Descrição</FormLabel>
                      <FormControl>
                        <Input placeholder="Descrição do ajuste" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={adjustmentForm.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Motivo</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Explique o motivo do ajuste" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar ajuste
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
