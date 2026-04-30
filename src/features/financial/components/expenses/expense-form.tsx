"use client";

import { useEffect, useMemo, useState } from "react";
import { addMonths, addWeeks, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { addDoc, getDoc, Timestamp, updateDoc } from "firebase/firestore";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, Check, ChevronsUpDown, Loader2, Plus, PlusCircle, Trash2, UserRound } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useEntities } from "@/hooks/use-entities";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import {
  expenseFormSchema,
  type ExpenseFormValues,
} from "@/features/financial/lib/schemas";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { formatCurrency } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type InstallmentPreview = {
  number: number;
  dueDate: Date;
  value: number;
};

function buildAccountTree(items: any[], parentId: string | null = null): any[] {
  return items
    .filter((item) => item.parentId === parentId)
    .map((item) => ({ ...item, children: buildAccountTree(items, item.id) }));
}

function flattenAccountTree(nodes: any[], level = 0): any[] {
  return nodes.flatMap((node) => [
    { ...node, level, isParent: node.children.length > 0 },
    ...flattenAccountTree(node.children, level + 1),
  ]);
}

async function parseFinancialApiError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error || "Erro ao carregar despesa.";
  } catch {
    return "Erro ao carregar despesa.";
  }
}

function DatePickerField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <FormLabel>{label}</FormLabel>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("w-full justify-start pl-3 text-left font-normal", !value && "text-muted-foreground")}
            disabled={disabled}
          >
            {value ? format(value, "PPP", { locale: ptBR }) : "Selecione a data"}
            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={onChange} initialFocus />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function QuickAddEntityDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const { addEntity } = useEntities();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"pessoa_fisica" | "pessoa_juridica">("pessoa_juridica");

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addEntity({
        name: name.trim(),
        type,
        document: "",
        address: { street: "", number: "", neighborhood: "", city: "", state: "", zipCode: "" },
      });
      onCreated(name.trim());
      setName("");
      setType("pessoa_juridica");
      onClose();
    } catch {
      toast({ variant: "destructive", title: "Erro ao criar entidade." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar fornecedor</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <FormLabel>Nome</FormLabel>
            <Input
              autoFocus
              placeholder="Razão social ou nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleSave(); } }}
            />
          </div>
          <div className="space-y-1.5">
            <FormLabel>Tipo</FormLabel>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pessoa_juridica">Pessoa jurídica</SelectItem>
                <SelectItem value="pessoa_fisica">Pessoa física</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExpenseForm() {
  const { firebaseUser, users } = useAuth();
  const { entities } = useEntities();
  const { kiosks, loading: unitsLoading } = useKiosks();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingExpense, setIsLoadingExpense] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const { data: accountPlans, loading: accountPlansLoading } = useFinancialCollection<any>(
    financialCollection("accountPlans")
  );
  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );

  const flattenedAccounts = useMemo(() => {
    if (!accountPlans) return [];
    return flattenAccountTree(buildAccountTree(accountPlans));
  }, [accountPlans]);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      isApportioned: false,
      paymentMethod: "single",
      apportionments: [{ resultCenter: "", percentage: 100 }],
      variedInstallments: [],
      accountPlan: "",
      description: "",
      supplier: "",
      notes: "",
      resultCenter: "",
      totalValue: 0,
      installments: 2,
      installmentType: "equal",
      installmentPeriodicity: "monthly",
    },
    mode: "onChange",
  });

  const paymentMethod = form.watch("paymentMethod");
  const installmentType = form.watch("installmentType");
  const installmentsQty = form.watch("installments");
  const totalValue = form.watch("totalValue");
  const firstInstallmentDueDate = form.watch("firstInstallmentDueDate");
  const installmentPeriodicity = form.watch("installmentPeriodicity");
  const variedInstallments = form.watch("variedInstallments");
  const isApportioned = form.watch("isApportioned");
  const apportionments = form.watch("apportionments");

  const {
    fields: apportionmentFields,
    append: appendApportionment,
    remove: removeApportionment,
  } = useFieldArray({
    control: form.control,
    name: "apportionments",
  });

  const {
    fields: variedFields,
    append: appendVariedInstallment,
    remove: removeVariedInstallment,
    replace: replaceVariedInstallments,
  } = useFieldArray({
    control: form.control,
    name: "variedInstallments",
  });

  useEffect(() => {
    if (paymentMethod !== "installments" || installmentType !== "varied" || !installmentsQty) {
      return;
    }

    const current = variedInstallments || [];
    if (current.length === installmentsQty) return;

    const next = Array.from({ length: installmentsQty }, (_, index) => ({
      dueDate:
        current[index]?.dueDate ||
        (firstInstallmentDueDate
          ? installmentPeriodicity === "weekly"
            ? addWeeks(firstInstallmentDueDate, index)
            : installmentPeriodicity === "biweekly"
            ? addWeeks(firstInstallmentDueDate, index * 2)
            : addMonths(firstInstallmentDueDate, index)
          : undefined),
      value: current[index]?.value || Number.parseFloat(((totalValue || 0) / installmentsQty).toFixed(2)),
    }));
    replaceVariedInstallments(next as any);
  }, [
    firstInstallmentDueDate,
    installmentPeriodicity,
    installmentType,
    installmentsQty,
    paymentMethod,
    replaceVariedInstallments,
    totalValue,
    variedInstallments,
  ]);

  useEffect(() => {
    if (!editId) return;

    let active = true;

    async function loadExpense() {
      if (!editId) return;
      setIsLoadingExpense(true);
      try {
        let data: any = null;

        try {
          const snapshot = await getDoc(financialDoc("expenses", editId));
          if (!snapshot.exists() || !active) return;
          data = snapshot.data();
        } catch (clientReadError) {
          if (!firebaseUser) throw clientReadError;

          const token = await firebaseUser.getIdToken();
          const response = await fetchWithTimeout(
            `/api/financial/data?path=${encodeURIComponent(`expenses/${editId}`)}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
              cache: "no-store",
            },
            20000
          );

          if (!response.ok) {
            throw new Error(await parseFinancialApiError(response));
          }

          const payload = await response.json();
          data = payload?.doc ?? null;
          if (!data || !active) return;
        }

        const resetData: any = {
          accountPlan: data.accountPlan,
          description: data.description,
          supplier: data.supplier,
          notes: data.notes,
          totalValue: data.totalValue,
          competenceDate: data.competenceDate?.toDate?.() ?? new Date(data.competenceDate),
          paymentMethod: data.paymentMethod,
          isApportioned: data.isApportioned,
          resultCenter: data.resultCenter || "",
          apportionments: data.apportionments || [{ resultCenter: "", percentage: 100 }],
          installments: data.installments?.length || 2,
        };

        if (data.paymentMethod === "single") {
          resetData.dueDate = data.dueDate?.toDate?.() ?? new Date(data.dueDate);
        } else {
          const installments = data.installments || [];
          const equalValues = installments.every((installment: any) => installment.value === installments[0]?.value);
          resetData.installmentType = data.installmentType || (equalValues ? "equal" : "varied");
          if (resetData.installmentType === "equal" && installments[0]) {
            resetData.firstInstallmentDueDate =
              installments[0].dueDate?.toDate?.() ?? new Date(installments[0].dueDate);
          } else {
            resetData.variedInstallments = installments.map((installment: any) => ({
              dueDate: installment.dueDate?.toDate?.() ?? new Date(installment.dueDate),
              value: installment.value,
            }));
          }
        }

        form.reset(resetData);
      } catch (error) {
        console.error(error);
        toast({ variant: "destructive", title: "Erro ao carregar despesa." });
      } finally {
        if (active) setIsLoadingExpense(false);
      }
    }

    void loadExpense();

    return () => {
      active = false;
    };
  }, [editId, firebaseUser, form, toast]);

  const equalInstallments = useMemo<InstallmentPreview[]>(() => {
    if (
      paymentMethod !== "installments" ||
      installmentType !== "equal" ||
      !installmentsQty ||
      !firstInstallmentDueDate ||
      !totalValue
    ) {
      return [];
    }

    const baseValue = Number.parseFloat((totalValue / installmentsQty).toFixed(2));
    const diff = Number.parseFloat((totalValue - baseValue * installmentsQty).toFixed(2));

    return Array.from({ length: installmentsQty }, (_, index) => {
      const dueDate =
        installmentPeriodicity === "weekly"
          ? addWeeks(firstInstallmentDueDate, index)
          : installmentPeriodicity === "biweekly"
          ? addWeeks(firstInstallmentDueDate, index * 2)
          : addMonths(firstInstallmentDueDate, index);

      return {
        number: index + 1,
        dueDate,
        value: index === installmentsQty - 1 ? Number.parseFloat((baseValue + diff).toFixed(2)) : baseValue,
      };
    });
  }, [
    firstInstallmentDueDate,
    installmentPeriodicity,
    installmentType,
    installmentsQty,
    paymentMethod,
    totalValue,
  ]);

  const rateioTotal = useMemo(
    () => (apportionments || []).reduce((sum, item) => sum + (Number(item.percentage) || 0), 0),
    [apportionments]
  );

  const installmentsSummary = useMemo(() => {
    if (paymentMethod === "single") return null;
    if (installmentType === "equal") return equalInstallments;
    return (variedInstallments || [])
      .filter((installment) => installment?.dueDate)
      .map((installment, index) => ({
        number: index + 1,
        dueDate: installment.dueDate,
        value: installment.value || 0,
      }));
  }, [equalInstallments, installmentType, paymentMethod, variedInstallments]);

  async function onSubmit(values: ExpenseFormValues) {
    if (!firebaseUser) return;
    setIsSaving(true);

    try {
      const installmentsToSave =
        values.paymentMethod === "installments" && values.installmentType === "equal"
          ? equalInstallments.map((installment) => ({
              number: installment.number,
              dueDate: Timestamp.fromDate(installment.dueDate),
              value: installment.value,
              status: "pending",
            }))
          : values.paymentMethod === "installments" && values.installmentType === "varied"
          ? values.variedInstallments!.map((installment, index) => ({
              number: index + 1,
              dueDate: Timestamp.fromDate(installment.dueDate),
              value: installment.value,
              status: "pending",
            }))
          : [
              {
                number: 1,
                dueDate: Timestamp.fromDate(values.dueDate!),
                value: values.totalValue,
                status: "pending",
              },
            ];

      const accountPlan = accountPlans?.find((item) => item.id === values.accountPlan);
      const payload = {
        accountPlan: values.accountPlan,
        accountPlanName: accountPlan?.name || values.accountPlan,
        description: values.description,
        supplier: values.supplier ?? "",
        notes: values.notes ?? "",
        totalValue: values.totalValue,
        competenceDate: Timestamp.fromDate(values.competenceDate),
        dueDate: Timestamp.fromDate(
          values.paymentMethod === "installments"
            ? values.installmentType === "equal"
              ? values.firstInstallmentDueDate!
              : values.variedInstallments![0].dueDate
            : values.dueDate!
        ),
        paymentMethod: values.paymentMethod,
        installmentType: values.installmentType ?? null,
        installmentPeriodicity: values.installmentPeriodicity ?? null,
        isApportioned: values.isApportioned,
        resultCenter: values.isApportioned ? null : values.resultCenter ?? null,
        apportionments: values.isApportioned ? values.apportionments : null,
        installments: installmentsToSave,
        updatedAt: Timestamp.now(),
      };

      if (editId) {
        await updateDoc(financialDoc("expenses", editId), payload);
        toast({ title: "Despesa atualizada." });
      } else {
        await addDoc(financialCollection("expenses"), {
          ...payload,
          status: "pending",
          createdBy: firebaseUser.uid,
          createdAt: Timestamp.now(),
        });
        toast({ title: "Despesa lançada." });
      }

      router.push(FINANCIAL_ROUTES.expenses);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar despesa",
        description: "Não foi possível concluir a operação.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoadingExpense || accountPlansLoading || unitsLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 xl:grid-cols-[1.5fr,0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Classificação</CardTitle>
              <CardDescription>Defina conta, descrição e valor base da despesa.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="accountPlan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plano de contas</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o plano de contas" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {flattenedAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {"— ".repeat(account.level)}
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: aluguel da unidade, manutenção de freezer..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="totalValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor total</FormLabel>
                      <FormControl>
                        <CurrencyInput value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="competenceDate"
                  render={({ field }) => (
                    <FormItem>
                      <DatePickerField label="Competência" value={field.value} onChange={field.onChange} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pagamento</CardTitle>
              <CardDescription>Escolha se a despesa será paga em parcela única ou parcelada.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Forma de pagamento</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid gap-3 md:grid-cols-2"
                      >
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-4">
                          <RadioGroupItem value="single" />
                          <div>
                            <p className="font-medium">Pagamento único</p>
                            <p className="text-sm text-muted-foreground">Uma parcela com vencimento único.</p>
                          </div>
                        </label>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-4">
                          <RadioGroupItem value="installments" />
                          <div>
                            <p className="font-medium">Parcelado</p>
                            <p className="text-sm text-muted-foreground">Distribua em parcelas iguais ou variáveis.</p>
                          </div>
                        </label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {paymentMethod === "single" ? (
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <DatePickerField label="Vencimento" value={field.value} onChange={field.onChange} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="installments"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Quantidade de parcelas</FormLabel>
                          <FormControl>
                            <Input type="number" min="2" max="48" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="installmentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="equal">Parcelas iguais</SelectItem>
                              <SelectItem value="varied">Parcelas variáveis</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="installmentPeriodicity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Periodicidade</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="monthly">Mensal</SelectItem>
                              <SelectItem value="weekly">Semanal</SelectItem>
                              <SelectItem value="biweekly">Quinzenal</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {installmentType === "equal" ? (
                    <FormField
                      control={form.control}
                      name="firstInstallmentDueDate"
                      render={({ field }) => (
                        <FormItem>
                          <DatePickerField label="Primeiro vencimento" value={field.value} onChange={field.onChange} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Parcelas variáveis</p>
                          <p className="text-sm text-muted-foreground">Ajuste valor e vencimento de cada parcela.</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            appendVariedInstallment({
                              dueDate: firstInstallmentDueDate || new Date(),
                              value: 0,
                            } as any)
                          }
                        >
                          <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
                        </Button>
                      </div>

                      <div className="space-y-4">
                        {variedFields.map((field, index) => (
                          <div key={field.id} className="rounded-lg border border-dashed p-3">
                            <div className="grid gap-4 md:grid-cols-[1fr,220px,48px]">
                              <FormField
                                control={form.control}
                                name={`variedInstallments.${index}.dueDate`}
                                render={({ field }) => (
                                  <FormItem>
                                    <DatePickerField label={`Parcela ${index + 1}`} value={field.value} onChange={field.onChange} />
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name={`variedInstallments.${index}.value`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Valor</FormLabel>
                                    <FormControl>
                                      <CurrencyInput value={field.value ?? 0} onChange={field.onChange} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeVariedInstallment(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resultado e complemento</CardTitle>
              <CardDescription>Defina unidade, fornecedor e observações.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="isApportioned"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Ratear entre unidades</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Ative para dividir a despesa entre múltiplas unidades.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {isApportioned ? (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Rateio</p>
                      <p className="text-sm text-muted-foreground">A soma deve fechar em 100%.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => appendApportionment({ resultCenter: "", percentage: 0 })}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" /> Adicionar
                    </Button>
                  </div>

                  {apportionmentFields.map((field, index) => (
                    <div key={field.id} className="grid gap-4 md:grid-cols-[1fr,180px,48px]">
                      <FormField
                        control={form.control}
                        name={`apportionments.${index}.resultCenter`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unidade</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione a unidade" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {units.map((unit) => (
                                  <SelectItem key={unit.id} value={unit.name}>
                                    {unit.name}
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
                        name={`apportionments.${index}.percentage`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Percentual</FormLabel>
                            <FormControl>
                              <Input type="number" min="0" max="100" step="0.01" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex items-end">
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeApportionment(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <p className={cn("text-sm font-medium", rateioTotal === 100 ? "text-emerald-600" : "text-amber-600")}>
                    Rateio atual: {rateioTotal.toFixed(2)}%
                  </p>
                </div>
              ) : (
                <FormField
                  control={form.control}
                  name="resultCenter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidade</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione a unidade" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {units.map((unit) => (
                            <SelectItem key={unit.id} value={unit.name}>
                              {unit.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fornecedor</FormLabel>
                    <div className="flex gap-2">
                      <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={supplierOpen}
                              className={cn("flex-1 justify-between font-normal", !field.value && "text-muted-foreground")}
                            >
                              {field.value || "Fornecedor ou beneficiário"}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[340px] p-0" align="start">
                          <Command>
                            <CommandInput
                              placeholder="Buscar ou digitar..."
                              value={field.value ?? ""}
                              onValueChange={(v) => field.onChange(v)}
                            />
                            <CommandList>
                              <CommandEmpty>
                                <span className="text-sm text-muted-foreground">
                                  Nenhum cadastro encontrado. Use o texto digitado ou adicione via +.
                                </span>
                              </CommandEmpty>
                              {entities.length > 0 && (
                                <CommandGroup heading="Entidades">
                                  {entities.map((entity) => {
                                    const label = entity.fantasyName || entity.name;
                                    return (
                                      <CommandItem
                                        key={entity.id}
                                        value={label}
                                        onSelect={() => {
                                          field.onChange(label);
                                          setSupplierOpen(false);
                                        }}
                                      >
                                        <Check className={cn("mr-2 h-4 w-4", field.value === label ? "opacity-100" : "opacity-0")} />
                                        {label}
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              )}
                              {users && users.length > 0 && (
                                <CommandGroup heading="Usuários">
                                  {users.map((user) => {
                                    const label = user.username || user.email;
                                    return (
                                      <CommandItem
                                        key={user.id}
                                        value={label}
                                        onSelect={() => {
                                          field.onChange(label);
                                          setSupplierOpen(false);
                                        }}
                                      >
                                        <Check className={cn("mr-2 h-4 w-4", field.value === label ? "opacity-100" : "opacity-0")} />
                                        {label}
                                        <Badge variant="secondary" className="ml-auto text-[10px] py-0">
                                          <UserRound className="mr-1 h-2.5 w-2.5" />
                                          Usuário
                                        </Badge>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title="Adicionar novo fornecedor"
                        onClick={() => setQuickAddOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <QuickAddEntityDialog
                open={quickAddOpen}
                onClose={() => setQuickAddOpen(false)}
                onCreated={(name) => form.setValue("supplier", name)}
              />
              <FormField
                control={form.control}
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
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>Resumo financeiro</CardTitle>
              <CardDescription>Confira a estrutura antes de salvar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <span>Valor total</span>
                  <span className="font-semibold">{formatCurrency(totalValue || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Forma</span>
                  <span>{paymentMethod === "single" ? "Pagamento único" : "Parcelado"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Rateio</span>
                  <span>{isApportioned ? `${rateioTotal.toFixed(2)}%` : "Centro único"}</span>
                </div>
              </div>

              {installmentsSummary && installmentsSummary.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <p className="font-medium">Parcelas previstas</p>
                    <p className="text-sm text-muted-foreground">
                      {installmentsSummary.length} parcela(s) geradas a partir do preenchimento atual.
                    </p>
                  </div>
                  <ScrollArea className="h-56 rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Parcela</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {installmentsSummary.map((installment) => (
                          <TableRow key={installment.number}>
                            <TableCell>{installment.number}</TableCell>
                            <TableCell>{format(installment.dueDate, "dd/MM/yyyy")}</TableCell>
                            <TableCell className="text-right">{formatCurrency(installment.value)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => router.push(FINANCIAL_ROUTES.expenses)}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editId ? "Atualizar" : "Salvar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </Form>
  );
}
