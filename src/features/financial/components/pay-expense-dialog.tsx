"use client";

import { apiErrorMessage } from '@/lib/api-error-message';
import { useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
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
import { useEntities } from "@/hooks/use-entities";
import { canManagePurchaseFinancials, canViewPurchasing } from "@/lib/purchasing-permissions";
import { maskBrazilianDocument, normalizeBrazilianDocument, validBrazilianTaxId } from "@/features/financial/beneficiaries/normalization";
import type { PaymentBeneficiaryReference } from "@/features/financial/beneficiaries/types";
import { purchasePixNeedsSync, supplierPixPrepareInput, type SupplierPixExpense } from "@/features/financial/lib/expense-supplier-pix-ui";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import type { PurchaseOrder } from "@/types";
import Link from "next/link";

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

type ExpenseRecord = SupplierPixExpense & {
  id: string;
  description: string;
  totalValue: number;
  netPayableValue?: number;
  supplier?: string;
  accountPlanName?: string;
  resultCenter?: string;
  generatedReceiptId?: string;
  beneficiaryReference?: PaymentBeneficiaryReference;
  paymentRequestId?: string | null;
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
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixEntityId, setPixEntityId] = useState("");
  const [pixEntitySearch, setPixEntitySearch] = useState("");
  const [pixIndicationConfirmed, setPixIndicationConfirmed] = useState(false);
  const [pixReason, setPixReason] = useState("");
  const [pixEvidence, setPixEvidence] = useState("");
  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrder | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const purchaseOrderCacheRef = useRef<{ id: string; order: PurchaseOrder } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const { entities, loading: entitiesLoading } = useEntities();
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
  const supplierPixInput = expense ? supplierPixPrepareInput(expense) : null;
  const needsPurchaseSync = expense ? purchasePixNeedsSync(expense) : false;
  const purchaseGoods = expense?.originModule === "purchasing" && Boolean(expense.purchaseOrderId)
    && (expense.purchaseExpenseRole === "goods" || expense.purchaseExpenseRole === "combined");
  const invoiceAccessKey = purchaseOrder?.invoiceAccessKey ?? "";
  const supplierEntity = entities.find(entity => entity.id === expense?.supplierId);
  const selectedEntityId = pixEntityId || expense?.supplierId || "";
  const selectedEntity = entities.find(entity => entity.id === selectedEntityId);
  const supplierDocument = normalizeBrazilianDocument(expense?.billingIdentity?.supplierTaxId);
  const selectedDocument = normalizeBrazilianDocument(selectedEntity?.document);
  const differentReceiver = Boolean(purchaseGoods && selectedEntity && selectedDocument !== supplierDocument);
  const canIndicate = isDefaultAdmin || Boolean(permissions.registration?.entities?.edit
    && permissions.financial?.expenses?.create);
  const canReadEntities = isDefaultAdmin || Boolean(permissions.registration?.view || canViewPurchasing(permissions));
  const canReadPurchase = isDefaultAdmin || canViewPurchasing(permissions);
  const canSyncPurchase = isDefaultAdmin || canManagePurchaseFinancials(permissions);
  const candidateEntities = entities.filter(entity => entity.status !== "inactive"
    && validBrazilianTaxId(entity.document)
    && `${entity.name} ${entity.fantasyName ?? ""} ${entity.document}`.toLocaleLowerCase("pt-BR")
      .includes(pixEntitySearch.trim().toLocaleLowerCase("pt-BR"))).slice(0, 60);
  const indicationReady = !differentReceiver || (canIndicate && purchaseOrder?.status === "confirmed"
    && expense?.purchaseExpenseRole === "goods" && /^\d{44}$/.test(invoiceAccessKey)
    && pixIndicationConfirmed && pixReason.trim().length >= 10 && pixEvidence.trim().length >= 10);
  const hasLinkedRequest = expense?.paymentRequestId != null;
  const pixNetMismatch = expense?.netPayableValue != null
    && Math.round(expense.netPayableValue * 100) !== Math.round(expense.totalValue * 100);
  const canPreparePix = isDefaultAdmin || Boolean(permissions.financial?.view && permissions.financial?.expenses?.view
    && permissions.financial?.expenses?.edit && permissions.financial?.paymentRequests?.view && permissions.financial?.paymentRequests?.create);
  const canRequestLegacyPix = Boolean(expense?.generatedReceiptId && expense.beneficiaryReference
    && permissions.financial?.paymentRequests?.create);
  const hasManualAdjustment = interest > 0.009 || fine > 0.009 || totalPaid > 0.009;
  useEffect(() => {
    setPixEntityId("");
    setPixEntitySearch("");
    setPixIndicationConfirmed(false);
    setPixReason("");
    setPixEvidence("");
    setPixError(null);
  }, [expense?.id]);
  useEffect(() => {
    setPurchaseOrder(null);
    setOrderError(null);
    if (!open) purchaseOrderCacheRef.current = null;
    if (!open || !purchaseGoods || !differentReceiver || !expense?.purchaseOrderId) {
      setOrdersLoading(false);
      return;
    }
    if (purchaseOrderCacheRef.current?.id === expense.purchaseOrderId) {
      setPurchaseOrder(purchaseOrderCacheRef.current.order);
      setOrdersLoading(false);
      return;
    }
    if (!canReadPurchase) {
      setOrdersLoading(false);
      setOrderError("Sem permissão para consultar a NF da compra.");
      return;
    }
    if (!firebaseUser) {
      setOrdersLoading(false);
      setOrderError("Sessão indisponível. Entre novamente para consultar a NF.");
      return;
    }
    const controller = new AbortController();
    setOrdersLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/purchasing/orders/${encodeURIComponent(expense.purchaseOrderId!)}`, {
          headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || payload.id !== expense.purchaseOrderId) {
          throw new Error(response.status === 403 ? "Sem permissão para consultar a NF da compra."
            : "Não foi possível carregar o pedido vinculado. Abra o pedido de compra para conferir a NF.");
        }
        if (!controller.signal.aborted) {
          purchaseOrderCacheRef.current = { id: expense.purchaseOrderId!, order: payload as PurchaseOrder };
          setPurchaseOrder(payload as PurchaseOrder);
        }
      } catch (error) {
        if (!controller.signal.aborted) setOrderError(error instanceof Error ? error.message : "Não foi possível consultar a NF da compra.");
      } finally {
        if (!controller.signal.aborted) setOrdersLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, purchaseGoods, differentReceiver, expense?.purchaseOrderId, canReadPurchase, firebaseUser]);
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
    if (!expense || !firebaseUser || (!isDefaultAdmin && !permissions.financial?.expenses?.pay)) return;
    if (hasLinkedRequest) {
      toast({ variant: "destructive", title: "Há uma solicitação bancária vinculada. Confira o painel de autorizações antes de registrar uma baixa manual." });
      return;
    }
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
    if (!target?.generatedReceiptId || !target.beneficiaryReference || !firebaseUser
      || !canRequestLegacyPix || hasLinkedRequest || pixNetMismatch || hasManualAdjustment) return;
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
      if (!response.ok) throw new Error(apiErrorMessage(payload, 'Falha ao criar solicitação bancária.'));
      toast({ title: 'Solicitação criada para autorização do Financeiro.', description: 'A despesa permanece pendente até a confirmação do Banco Inter.' });
      onOpenChange(false); onSuccess?.();
    } catch (error) {
      toast({ variant: 'destructive', title: error instanceof Error ? error.message : 'Falha ao solicitar pagamento.' });
    } finally { setIsSaving(false); }
  }

  async function requestSupplierPix() {
    if (!expense || !supplierPixInput || !firebaseUser || !canPreparePix || hasManualAdjustment || !indicationReady) return;
    if (purchaseGoods && selectedEntityId !== expense.supplierId && (!selectedEntity || !validBrazilianTaxId(selectedDocument))) {
      setPixError("Selecione uma pessoa ou empresa cadastrada para receber o Pix.");
      return;
    }
    setPixError(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/financial/expenses/${encodeURIComponent(expense.id)}/supplier-pix`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        body: JSON.stringify({
          ...supplierPixInput,
          supplierEntityId: selectedEntityId,
          ...(differentReceiver ? { purchaseBeneficiaryIndication: {
            confirmed: true, invoiceAccessKey, reason: pixReason.trim(), evidence: pixEvidence.trim(),
          } } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível preparar a solicitação Pix.");
      toast({ title: "Pix solicitado para autorização", description: "Confira a solicitação no painel de autorizações. O envio e a confirmação no Inter são etapas separadas; a despesa permanece em aberto até o extrato." });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      setPixError(error instanceof Error ? error.message : "Não foi possível preparar a solicitação Pix.");
    } finally {
      setIsSaving(false);
    }
  }

  async function syncPurchaseExpense() {
    if (!expense?.purchaseOrderId || !firebaseUser || !canSyncPurchase || !needsPurchaseSync) return;
    setPixError(null);
    setIsSaving(true);
    try {
      const response = await fetch(`/api/purchasing/orders/${encodeURIComponent(expense.purchaseOrderId)}/sync-expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível sincronizar a despesa da compra.");
      toast({ title: "Despesa sincronizada", description: "Abra novamente a despesa atualizada para preparar o Pix da mercadoria." });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      setPixError(error instanceof Error ? error.message : "Não foi possível sincronizar a despesa da compra.");
    } finally {
      setIsSaving(false);
    }
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
        className="flex h-[80vh] max-h-[640px] flex-col overflow-hidden rounded-ds-modal border-0 bg-ds-input p-0 shadow-ds-modal"
        style={{
          width: "min(820px, calc(100vw - 64px))",
          maxWidth: "calc(100vw - 64px)",
        }}
      >
        <DialogHeader className="shrink-0 border-b border-ds-border-footer px-6 py-3 text-left">
          <div className="pr-10">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Registrar pagamento</p>
            <DialogTitle className="mt-1.5 text-[1.35rem] font-extrabold leading-tight tracking-[-0.02em] text-ds-ink sm:text-[1.65rem]">{
              expense.description
            }</DialogTitle>
            <DialogDescription className="mt-1.5 text-sm text-ds-ink-muted">
              {expenseContext || formatCurrency(baseValue)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid min-h-full gap-0 md:grid-cols-[minmax(0,1fr)_270px]">
                <div className="px-4 py-3">
                <div className="space-y-3.5">
                  <div className="grid gap-3">
                    {provisionConsultation.status !== "not_applicable" && (
                      <div className={cn(
                        "rounded-2xl border p-3 text-sm",
                        provisionConsultation.status === "already_reconciled"
                          ? "border-ds-ok-bg bg-ds-ok-bg text-ds-ok"
                          : provisionConsultation.status === "matched"
                          ? "border-ds-warn-bg bg-ds-warn-bg text-ds-warn"
                          : provisionConsultation.status === "ambiguous"
                          ? "border-ds-danger-bg bg-ds-danger-bg text-ds-danger"
                          : "border-ds-border bg-ds-neutral-bg text-ds-neutral",
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
                            <Input type="number" min="0" step="0.01" className="h-10 rounded-ds-md border-ds-border-input bg-ds-input" {...field} />
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
                            <Input type="number" min="0" step="0.01" className="h-10 rounded-ds-md border-ds-border-input bg-ds-input" {...field} />
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
                                      <Input type="number" min="0" step="0.01" className="h-10 rounded-ds-md border-ds-border-input bg-ds-input" {...amountField} />
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

                <div className="border-t border-ds-border-footer bg-ds-surface px-3 py-3 md:border-l md:border-t-0">
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
                    <span className="shrink-0 font-mono text-[1.1rem] font-bold leading-none">
                      {formatCurrency(totalDue)}
                    </span>
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-2xl px-4 py-3 text-sm",
                      isOver
                        ? "bg-ds-danger-bg text-ds-danger"
                        : Math.abs(remaining) < 0.01
                        ? "bg-ds-ok-bg text-ds-ok"
                        : "bg-ds-warn-bg text-ds-warn"
                    )}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        {isOver ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                        <span className="whitespace-nowrap">Saldo restante</span>
                      </span>
                      <span className="shrink-0 font-mono">{formatCurrency(Math.abs(remaining))}</span>
                    </div>
                  </div>

                  <div className="mt-3 rounded-ds-btn-lg border border-ds-border bg-ds-surface p-3">
                    <p className="font-medium">Após confirmar:</p>
                    <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Check aria-hidden="true" className="h-4 w-4 text-ds-ok" />
                        Obrigação liquidada gerencialmente
                      </div>
                      <div className="flex items-center gap-2">
                        <Check aria-hidden="true" className="h-4 w-4 text-ds-ok" />
                        Saída informada no fluxo de caixa
                      </div>
                      <div className="flex items-center gap-2">
                        <Check aria-hidden="true" className="h-4 w-4 text-ds-ok" />
                        Confirmação bancária aguardará o extrato
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {purchaseGoods && canPreparePix && (supplierPixInput || needsPurchaseSync) ? (
              <section className="space-y-3 border-t border-ds-border-footer px-4 py-3 text-sm" aria-label="Favorecido do Pix da compra">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="font-medium">Fornecedor da nota/compra</p>
                    <p className="text-muted-foreground">{supplierEntity?.name || expense.supplier || "Cadastro do fornecedor indisponível"}</p>
                    <p className="text-xs text-muted-foreground">{maskBrazilianDocument(supplierDocument)} · vinculado à despesa</p>
                  </div>
                  <div>
                    <label className="font-medium" htmlFor="purchase-pix-receiver">Quem recebe o Pix</label>
                    {entitiesLoading ? <p role="status" className="text-muted-foreground">Carregando cadastros…</p> : !canReadEntities ? (
                      <p className="text-ds-danger">Sem acesso aos cadastros. Solicite permissão para escolher outro recebedor.</p>
                    ) : (
                      <>
                        <Input aria-label="Buscar pessoa ou empresa cadastrada" placeholder="Buscar pessoa ou empresa" value={pixEntitySearch}
                          onChange={event => setPixEntitySearch(event.target.value)} className="mt-1" />
                        <select id="purchase-pix-receiver" value={selectedEntityId}
                          onChange={event => { setPixEntityId(event.target.value); setPixIndicationConfirmed(false); setPixError(null); }}
                          className="mt-2 w-full rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-sm text-ds-ink dark:text-foreground">
                          {expense.supplierId && !candidateEntities.some(entity => entity.id === expense.supplierId) ? (
                            <option value={expense.supplierId}>Mesmo fornecedor da nota/compra</option>
                          ) : null}
                          {selectedEntity && !candidateEntities.some(entity => entity.id === selectedEntity.id) ? (
                            <option value={selectedEntity.id}>{selectedEntity.name} · {maskBrazilianDocument(selectedEntity.document)}</option>
                          ) : null}
                          {candidateEntities.filter(entity => entity.id === expense.supplierId
                            || normalizeBrazilianDocument(entity.document) !== supplierDocument).map(entity => (
                            <option key={entity.id} value={entity.id}>{entity.name} · {maskBrazilianDocument(entity.document)}</option>
                          ))}
                        </select>
                        {candidateEntities.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Nenhum cadastro encontrado. Cadastre ou revise a pessoa/empresa antes do Pix.</p> : null}
                      </>
                    )}
                  </div>
                </div>
                {differentReceiver ? (
                  <div className="space-y-2 rounded-ds-btn border border-ds-border bg-ds-surface p-3">
                    {!canIndicate ? <p role="alert" className="text-ds-danger">Sem permissão para confirmar um recebedor diferente. É necessária edição de cadastro e criação de despesa.</p> : null}
                    {ordersLoading ? <p role="status">Carregando nota da compra…</p> : orderError ? <p role="alert" className="text-ds-danger">{orderError}</p> : !purchaseOrder || purchaseOrder.status !== "confirmed" || !/^\d{44}$/.test(invoiceAccessKey) ? (
                      <p role="alert" className="text-ds-danger">A indicação exige compra confirmada e NF com chave de acesso. Confira o pedido antes de preparar o Pix.</p>
                    ) : <p className="text-xs text-muted-foreground">NF {purchaseOrder.invoiceNumber || purchaseOrder.fiscal?.number || "—"} · chave final {invoiceAccessKey.slice(-8)} · mercadoria {formatCurrency(expense.totalValue)}</p>}
                    <label className="block text-xs font-medium" htmlFor="purchase-pix-reason">Motivo da indicação</label>
                    <Textarea id="purchase-pix-reason" value={pixReason} maxLength={500} disabled={!canIndicate}
                      onChange={event => setPixReason(event.target.value)} placeholder="Descreva por que outra pessoa/empresa recebe o valor da mercadoria" />
                    <label className="block text-xs font-medium" htmlFor="purchase-pix-evidence">Evidência da NF</label>
                    <Textarea id="purchase-pix-evidence" value={pixEvidence} maxLength={500} disabled={!canIndicate}
                      onChange={event => setPixEvidence(event.target.value)} placeholder="Indique a referência fiscal concreta que sustenta a indicação" />
                    <label className="flex items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5" checked={pixIndicationConfirmed} disabled={!canIndicate}
                        onChange={event => setPixIndicationConfirmed(event.target.checked)} />
                      Confirmo expressamente que o recebedor cadastrado acima foi indicado para este Pix da mercadoria; conferi a NF, o valor, o motivo e a evidência.
                    </label>
                    <p className="text-xs text-muted-foreground">O frete separado tem despesa e pagamento próprios.</p>
                  </div>
                ) : null}
                {needsPurchaseSync ? <p className="text-xs text-muted-foreground">Esta despesa antiga ainda precisa dos dados canônicos da compra. Sincronize o pedido pelo fluxo de Compras; não altere o documento fiscal da despesa manualmente.</p> : null}
              </section>
            ) : null}
            {(supplierPixInput && canPreparePix) || needsPurchaseSync || pixError || hasLinkedRequest || ((canPreparePix || canRequestLegacyPix) && pixNetMismatch) || (canRequestLegacyPix && hasManualAdjustment) ? <div className="border-t border-ds-border-footer px-4 py-2 text-xs text-muted-foreground">
              {pixError ? <p role="alert" className="text-ds-danger">{pixError}</p> : null}
              {hasLinkedRequest ? <p>Esta despesa tem uma solicitação bancária vinculada. A baixa manual fica bloqueada enquanto o vínculo constar aqui. Consulte o pedido e a conciliação no <Link className="underline" href={FINANCIAL_ROUTES.paymentRequests}>painel de autorizações</Link>.</p> : null}
              {(canPreparePix || canRequestLegacyPix) && pixNetMismatch ? <p>Pix indisponível: o valor líquido {formatCurrency(expense.netPayableValue!)} difere do total {formatCurrency(expense.totalValue)} da despesa. Revise o desconto antes de solicitar o valor integral.</p> : null}
              {canRequestLegacyPix && hasManualAdjustment ? <p>Limpe juros, multa e valores de baixa manual antes de solicitar o Pix do recibo.</p> : null}
              {supplierPixInput && canPreparePix ? <p>O Pix solicita exatamente {formatCurrency(expense.totalValue)} da despesa salva, sem juros, multa ou rateio manual. A data acima vale apenas para a baixa manual. {hasManualAdjustment ? "Limpe os valores manuais para solicitar Pix." : ""} <Link className="underline" href={FINANCIAL_ROUTES.paymentRequests}>Ver autorizações</Link></p> : null}
            </div> : null}
            </div>
            <DialogFooter className="border-t border-ds-border-footer bg-ds-input px-4 py-3 sm:justify-between">
              <Button type="button" variant="ds-ghost" size="md" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <div className="flex flex-wrap gap-2">
                {needsPurchaseSync && canSyncPurchase ? <Button type="button" variant="ds-secondary" size="md" disabled={isSaving} onClick={() => void syncPurchaseExpense()}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sincronizar despesa da compra</Button> : null}
                {needsPurchaseSync && !canSyncPurchase ? <p className="text-xs text-ds-danger">Sem permissão para sincronizar a compra.</p> : null}
                {supplierPixInput && canPreparePix ? <Button type="button" variant="ds-secondary" size="md" disabled={isSaving || hasManualAdjustment || !indicationReady || entitiesLoading || (purchaseGoods && selectedEntityId !== expense.supplierId && !selectedEntity)} onClick={() => void requestSupplierPix()}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Solicitar Pix de {formatCurrency(expense.totalValue)}</Button> : null}
                {canRequestLegacyPix ? <Button type="button" variant="ds-secondary" size="md" disabled={isSaving || hasLinkedRequest || pixNetMismatch || hasManualAdjustment} onClick={() => void requestInterPayment()}>{isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Solicitar Pix via Banco Inter</Button> : null}
                <Button type="submit" variant="primary-modal" size="md" disabled={isSaving || isOver || totalPaid <= 0 || !!expense.generatedReceiptId || hasLinkedRequest || (!isDefaultAdmin && !permissions.financial?.expenses?.pay)} title={hasLinkedRequest ? 'Há uma solicitação bancária vinculada a esta despesa.' : expense.generatedReceiptId ? 'Recibos gerados pelo Coala são baixados somente após confirmação bancária.' : undefined}>
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
