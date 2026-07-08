"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { addMonths, addWeeks, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { addDoc, getDoc, Timestamp, updateDoc } from "firebase/firestore";
import { useFieldArray, useForm } from "react-hook-form";
import type { FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, CalendarIcon, Check, ChevronLeft, ChevronRight, ChevronsUpDown, CreditCard, FileText, Loader2, Plus, PlusCircle, Trash2, UserRound, X } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useEntities } from "@/hooks/use-entities";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import {
  expenseDescriptionFormSchema,
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
import { CurrencyInput } from "@/components/ui/currency-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type InstallmentPreview = {
  number: number;
  dueDate: Date;
  value: number;
};

type RecurringPreview = InstallmentPreview & {
  competenceDate: Date;
};


function toOptionalDate(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value?.toDate === "function") {
    const parsed = value.toDate();
    return Number.isNaN(parsed?.getTime?.()) ? undefined : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeExpenseDescriptionLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

function buildRecurringOccurrences(
  firstDueDate: Date | undefined,
  endDate: Date | undefined,
  value: number
): RecurringPreview[] {
  if (!firstDueDate || !endDate || !value || endDate < firstDueDate) {
    return [];
  }

  const occurrences: RecurringPreview[] = [];
  let cursor = new Date(firstDueDate);
  let index = 0;

  while (cursor <= endDate && index < 120) {
    occurrences.push({
      number: index + 1,
      dueDate: new Date(cursor),
      competenceDate: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      value,
    });
    cursor = addMonths(firstDueDate, index + 1);
    index += 1;
  }

  return occurrences;
}

const ACCOUNT_GROUP_LABELS: Record<string, string> = {
  receita: "Receita",
  fiscal: "Impostos e Deduções",
  insumos: "Custos Variáveis Complementares",
  estoque: "Estoque / Compras de Insumos",
  rh: "Recursos Humanos",
  administrativo: "Administrativo",
  marketing: "Marketing",
  tecnologia: "Tecnologia",
  ocupacao: "Ocupação",
  financeiro: "Financeiro",
  nao_operacional: "Não Operacional",
  ir_csll: "IR / CSLL",
};

const ACCOUNT_GROUP_ORDER = ["fiscal", "insumos", "estoque", "rh", "administrativo", "marketing", "tecnologia", "ocupacao", "financeiro", "nao_operacional", "ir_csll", "receita"];

function SectionHeading({
  icon,
  iconClassName,
  title,
  description,
}: {
  icon: ReactNode;
  iconClassName: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b pb-4">
      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function flattenFormErrors(errors: FieldErrors<ExpenseFormValues>, prefix = ""): Array<{ path: string; message: string }> {
  return Object.entries(errors).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!value) return [];

    if (typeof value === "object" && "message" in value && typeof value.message === "string") {
      return [{ path, message: value.message }];
    }

    if (typeof value === "object") {
      return flattenFormErrors(value as FieldErrors<ExpenseFormValues>, path);
    }

    return [];
  });
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
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"day" | "month" | "year">("day");
  const [displayMonth, setDisplayMonth] = useState<Date>(value ?? new Date());

  useEffect(() => {
    if (open) {
      setView("day");
      setDisplayMonth(value ?? new Date());
    }
  }, [open, value]);

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const date = new Date(displayMonth.getFullYear(), index, 1);
        return {
          index,
          label: format(date, "MMMM", { locale: ptBR }).replace(/^\w/, (char) => char.toUpperCase()),
        };
      }),
    [displayMonth]
  );

  const yearRangeStart = Math.floor(displayMonth.getFullYear() / 12) * 12;
  const yearOptions = useMemo(
    () => Array.from({ length: 12 }, (_, index) => yearRangeStart + index),
    [yearRangeStart]
  );

  return (
    <div className="space-y-2">
      <FormLabel>{label}</FormLabel>
      <Popover open={open} onOpenChange={setOpen}>
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
          <div className="w-[320px]">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (view === "year") {
                    setDisplayMonth(new Date(displayMonth.getFullYear() - 12, displayMonth.getMonth(), 1));
                    return;
                  }
                  setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1));
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-sm font-medium"
                  onClick={() => setView("month")}
                >
                  {format(displayMonth, "MMMM", { locale: ptBR }).replace(/^\w/, (char) => char.toUpperCase())}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-sm font-medium"
                  onClick={() => setView("year")}
                >
                  {format(displayMonth, "yyyy")}
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (view === "year") {
                    setDisplayMonth(new Date(displayMonth.getFullYear() + 12, displayMonth.getMonth(), 1));
                    return;
                  }
                  setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1));
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {view === "day" ? (
              <Calendar
                mode="single"
                selected={value}
                onSelect={(nextValue) => {
                  onChange(nextValue);
                  setOpen(false);
                }}
                month={displayMonth}
                onMonthChange={setDisplayMonth}
                initialFocus
              />
            ) : view === "month" ? (
              <div className="grid grid-cols-3 gap-2 p-3">
                {monthOptions.map((monthOption) => (
                  <Button
                    key={monthOption.index}
                    type="button"
                    variant={displayMonth.getMonth() === monthOption.index ? "default" : "outline"}
                    className="justify-center"
                    onClick={() => {
                      setDisplayMonth(new Date(displayMonth.getFullYear(), monthOption.index, 1));
                      setView("day");
                    }}
                  >
                    {monthOption.label.slice(0, 3)}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 p-3">
                {yearOptions.map((year) => (
                  <Button
                    key={year}
                    type="button"
                    variant={displayMonth.getFullYear() === year ? "default" : "outline"}
                    className="justify-center"
                    onClick={() => {
                      setDisplayMonth(new Date(year, displayMonth.getMonth(), 1));
                      setView("month");
                    }}
                  >
                    {year}
                  </Button>
                ))}
              </div>
            )}
          </div>
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
  const { firebaseUser, users, permissions } = useAuth();
  const { entities } = useEntities();
  const { kiosks, loading: unitsLoading } = useKiosks();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const returnTo = searchParams.get("returnTo");
  const importTransactionId = searchParams.get("importTransaction");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingExpense, setIsLoadingExpense] = useState(false);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [importTransactionData, setImportTransactionData] = useState<any | null>(null);
  const [accountPlanOpen, setAccountPlanOpen] = useState(false);
  const [accountPlanSearch, setAccountPlanSearch] = useState("");
  const [descriptionFocused, setDescriptionFocused] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<"identification" | "classification" | "schedule" | "review">(
    "identification"
  );

  const { data: accounts, loading: accountPlansLoading } = useFinancialCollection<any>(
    financialCollection("accounts")
  );
  const { data: expenseDescriptions, refresh: refreshExpenseDescriptions } = useFinancialCollection<any>(
    financialCollection("expenseDescriptions")
  );
  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );

  const activeAccounts = useMemo(
    () => (accounts || []).filter((a: any) => a.active !== false),
    [accounts]
  );

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, any[]> = {};
    activeAccounts.forEach((a: any) => {
      const g = a.group || "outros";
      if (!groups[g]) groups[g] = [];
      groups[g].push(a);
    });
    return ACCOUNT_GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => ({
      group: g,
      label: ACCOUNT_GROUP_LABELS[g] ?? g,
      accounts: groups[g],
    }));
  }, [activeAccounts]);

  const filteredGroupedAccounts = useMemo(() => {
    const q = accountPlanSearch.trim().toLowerCase();
    if (!q) return groupedAccounts;
    return groupedAccounts
      .map((g) => ({
        ...g,
        accounts: g.accounts.filter((a: any) =>
          a.name.toLowerCase().includes(q) ||
          (ACCOUNT_GROUP_LABELS[a.group] || "").toLowerCase().includes(q) ||
          // Palavras-chave cadastradas no plano de contas.
          (Array.isArray(a.searchTerms) && a.searchTerms.some((term: string) => term.toLowerCase().includes(q)))
        ),
      }))
      .filter((g) => g.accounts.length > 0);
  }, [groupedAccounts, accountPlanSearch]);

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
      recurrenceFirstDueDate: undefined,
      recurrenceEndDate: undefined,
    },
    mode: "onChange",
  });

  const paymentMethod = form.watch("paymentMethod");
  const accountPlanValue = form.watch("accountPlan");
  const installmentType = form.watch("installmentType");
  const installmentsQty = form.watch("installments");
  const totalValue = form.watch("totalValue");
  const descriptionValue = form.watch("description");
  const supplierValue = form.watch("supplier");
  const resultCenterValue = form.watch("resultCenter");
  const dueDateValue = form.watch("dueDate");
  const notesValue = form.watch("notes");
  const competenceDateValue = form.watch("competenceDate");
  const firstInstallmentDueDate = form.watch("firstInstallmentDueDate");
  const installmentPeriodicity = form.watch("installmentPeriodicity");
  const recurrenceFirstDueDate = form.watch("recurrenceFirstDueDate");
  const recurrenceEndDate = form.watch("recurrenceEndDate");
  const variedInstallments = form.watch("variedInstallments");
  const isApportioned = form.watch("isApportioned");
  const apportionments = form.watch("apportionments");
  const selectedAccountPlan = useMemo(
    () => activeAccounts.find((a: any) => a.id === accountPlanValue),
    [accountPlanValue, activeAccounts]
  );
  const activeExpenseDescriptions = useMemo(
    () =>
      [...(expenseDescriptions || [])]
        .filter((item) => item.active !== false && typeof item.label === "string" && item.label.trim().length > 0)
        .sort((left, right) => left.label.localeCompare(right.label, "pt-BR", { sensitivity: "base" })),
    [expenseDescriptions]
  );
  const canManageExpenseDescriptions = !!permissions.financial?.settings?.manageExpenseDescriptions;
  const canQuickAddExpenseDescriptions =
    !!permissions.financial?.expenses?.create ||
    !!permissions.financial?.expenses?.edit ||
    canManageExpenseDescriptions;
  const normalizedDescriptionValue = useMemo(
    () => normalizeExpenseDescriptionLabel(descriptionValue || ""),
    [descriptionValue]
  );
  const hasMatchingExpenseDescription = useMemo(
    () =>
      activeExpenseDescriptions.some(
        (item) => normalizeExpenseDescriptionLabel(item.label) === normalizedDescriptionValue
      ),
    [activeExpenseDescriptions, normalizedDescriptionValue]
  );
  const filteredExpenseDescriptions = useMemo(() => {
    const normalizedSearch = descriptionValue.trim().toLowerCase();
    if (!normalizedSearch) return activeExpenseDescriptions;

    return activeExpenseDescriptions.filter((item) =>
      item.label.toLowerCase().includes(normalizedSearch)
    );
  }, [activeExpenseDescriptions, descriptionValue]);
  const visibleExpenseDescriptions = useMemo(
    () =>
      filteredExpenseDescriptions
        .filter((item) => normalizeExpenseDescriptionLabel(item.label) !== normalizedDescriptionValue)
        .slice(0, 6),
    [filteredExpenseDescriptions, normalizedDescriptionValue]
  );

  useEffect(() => {
    if (!accountPlanOpen) setAccountPlanSearch("");
  }, [accountPlanOpen]);

  async function handleQuickAddExpenseDescription() {
    if (!firebaseUser) return;

    if (!canQuickAddExpenseDescriptions) {
      toast({
        variant: "destructive",
        title: "Sem permissão para cadastrar sugestões.",
        description: "Seu perfil precisa poder lançar ou editar despesas para usar esse atalho.",
      });
      return;
    }

    const rawLabel = descriptionValue || "";
    const parsed = expenseDescriptionFormSchema.safeParse({
      label: rawLabel,
      active: true,
    });

    if (!parsed.success) {
      toast({
        variant: "destructive",
        title: "Descrição inválida.",
        description: parsed.error.issues[0]?.message || "Revise o texto antes de adicionar a sugestão.",
      });
      return;
    }

    if (hasMatchingExpenseDescription) {
      toast({
        title: "Sugestão já cadastrada.",
        description: "Essa descrição já está disponível na lista de sugestões.",
      });
      return;
    }

    try {
      const trimmedLabel = parsed.data.label.trim();
      await addDoc(financialCollection("expenseDescriptions"), {
        label: trimmedLabel,
        active: true,
        createdAt: Timestamp.now(),
        createdBy: firebaseUser.uid,
        updatedAt: Timestamp.now(),
        updatedBy: firebaseUser.uid,
      });
      await refreshExpenseDescriptions();
      toast({
        title: "Sugestão adicionada.",
        description: "A descrição foi salva e já pode ser reutilizada nos próximos lançamentos.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Erro ao adicionar sugestão.",
        description: "Não foi possível salvar a descrição no catálogo. Se a regra já deveria permitir isso, publique as regras financeiras atualizadas.",
      });
    }
  }

  const filteredEntities = useMemo(() => {
    const normalizedSearch = supplierSearch.trim().toLowerCase();
    if (!normalizedSearch) return entities;
    return entities.filter((entity) => {
      const label = entity.fantasyName || entity.name;
      return label.toLowerCase().includes(normalizedSearch);
    });
  }, [entities, supplierSearch]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = supplierSearch.trim().toLowerCase();
    if (!normalizedSearch) return users || [];
    return (users || []).filter((user) => {
      const label = user.username || user.email;
      return label.toLowerCase().includes(normalizedSearch);
    });
  }, [supplierSearch, users]);

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
    if (paymentMethod === "recurring") {
      form.clearErrors("competenceDate");
    }
  }, [form, paymentMethod]);

  useEffect(() => {
    if (editId || !importTransactionId) return;

    let active = true;
    const transactionId = importTransactionId;

    async function loadImportTransaction() {
      try {
        const snapshot = await getDoc(financialDoc("transactions", transactionId));
        if (!snapshot.exists() || !active) return;
        const data = snapshot.data();
        const transactionDate = toOptionalDate(data.date);
        const competenceDate =
          transactionDate ? new Date(transactionDate.getFullYear(), transactionDate.getMonth(), 1) : undefined;

        form.reset({
          ...form.getValues(),
          paymentMethod: "single",
          accountPlan: data.accountPlanId || "",
          description: data.description || "",
          supplier: data.supplier || "",
          resultCenter: data.resultCenterName || "",
          notes: data.rawBankDescription || "",
          totalValue: Number(data.amount) || 0,
          competenceDate,
          dueDate: transactionDate,
          isApportioned: false,
          apportionments: [{ resultCenter: "", percentage: 100 }],
        });
        setImportTransactionData({ id: snapshot.id, ...data });
      } catch (error) {
        console.error(error);
        toast({ variant: "destructive", title: "Erro ao carregar a transação importada." });
      }
    }

    void loadImportTransaction();

    return () => {
      active = false;
    };
  }, [editId, form, importTransactionId, toast]);

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
          competenceDate: toOptionalDate(data.competenceDate),
          paymentMethod: data.paymentMethod || "single",
          isApportioned: data.isApportioned,
          resultCenter: data.resultCenter || "",
          apportionments: data.apportionments || [{ resultCenter: "", percentage: 100 }],
          installments: data.installments?.length || 2,
        };

        if (data.paymentMethod === "single") {
          resetData.dueDate = toOptionalDate(data.dueDate);
        } else if (data.paymentMethod === "recurring") {
          resetData.recurrenceFirstDueDate = toOptionalDate(data.recurrenceFirstDueDate) ?? toOptionalDate(data.dueDate);
          resetData.recurrenceEndDate = toOptionalDate(data.recurrenceEndDate) ?? toOptionalDate(data.dueDate);
        } else {
          const installments = data.installments || [];
          const equalValues = installments.every((installment: any) => installment.value === installments[0]?.value);
          resetData.installmentType = data.installmentType || (equalValues ? "equal" : "varied");
          if (resetData.installmentType === "equal" && installments[0]) {
            resetData.firstInstallmentDueDate = toOptionalDate(installments[0].dueDate);
          } else {
            resetData.variedInstallments = installments.map((installment: any) => ({
              dueDate: toOptionalDate(installment.dueDate),
              value: installment.value,
            }));
          }
        }

        form.reset(resetData);
        setLoadedStatus(data.status ?? null);
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

  const recurringPreview = useMemo(
    () =>
      paymentMethod === "recurring"
        ? buildRecurringOccurrences(
            recurrenceFirstDueDate,
            recurrenceEndDate,
            totalValue || 0
          )
        : [],
    [paymentMethod, recurrenceEndDate, recurrenceFirstDueDate, totalValue]
  );
  const recurringPreviewTotal = useMemo(
    () => recurringPreview.reduce((sum, occurrence) => sum + (occurrence.value || 0), 0),
    [recurringPreview]
  );

  const rateioTotal = useMemo(
    () => (apportionments || []).reduce((sum, item) => sum + (Number(item.percentage) || 0), 0),
    [apportionments]
  );

  const installmentsSummary = useMemo(() => {
    if (paymentMethod === "single" || paymentMethod === "recurring") return null;
    if (installmentType === "equal") return equalInstallments;
    return (variedInstallments || [])
      .filter((installment) => installment?.dueDate)
      .map((installment, index) => ({
        number: index + 1,
        dueDate: installment.dueDate,
        value: installment.value || 0,
      }));
  }, [equalInstallments, installmentType, paymentMethod, variedInstallments]);
  const installmentsPreviewTotal = useMemo(
    () => (installmentsSummary || []).reduce((sum, installment) => sum + (installment.value || 0), 0),
    [installmentsSummary]
  );
  const steps = useMemo(
    () => [
      { id: "identification", label: "Identificação" },
      { id: "classification", label: "Classificação" },
      { id: "schedule", label: "Vencimento & parcelas" },
      { id: "review", label: "Revisão" },
    ] as const,
    []
  );
  const activeStepIndex = steps.findIndex((step) => step.id === currentStep);
  const previewDueDate =
    paymentMethod === "single"
      ? dueDateValue
      : paymentMethod === "installments"
      ? installmentsSummary?.[0]?.dueDate
      : recurringPreview[0]?.dueDate;
  const previewCompetence =
    paymentMethod === "recurring" ? recurringPreview[0]?.competenceDate : competenceDateValue;
  const validationItems = [
    { label: "Descrição", ok: (descriptionValue || "").trim().length >= 3 },
    { label: "Fornecedor", ok: (supplierValue || "").trim().length >= 3 },
    { label: "Plano de contas", ok: !!accountPlanValue },
    { label: "Unidade ou rateio", ok: isApportioned ? rateioTotal === 100 : !!resultCenterValue },
    { label: "Valor", ok: Number(totalValue || 0) > 0 },
    { label: "Vencimento", ok: !!previewDueDate },
  ];

  function buildInstallmentsFromValues(values: ExpenseFormValues) {
    if (values.paymentMethod === "installments" && values.installmentType === "equal") {
      return equalInstallments.map((installment) => ({
        number: installment.number,
        dueDate: Timestamp.fromDate(installment.dueDate),
        value: installment.value,
        status: "pending",
      }));
    }

    if (values.paymentMethod === "installments" && values.installmentType === "varied") {
      return (values.variedInstallments || [])
        .filter((installment) => installment?.dueDate && installment?.value)
        .map((installment, index) => ({
          number: index + 1,
          dueDate: Timestamp.fromDate(installment.dueDate),
          value: installment.value,
          status: "pending",
        }));
    }

    if (values.paymentMethod === "single" && values.dueDate) {
      return [
        {
          number: 1,
          dueDate: Timestamp.fromDate(values.dueDate),
          value: values.totalValue,
          status: "pending",
        },
      ];
    }

    if (values.paymentMethod === "recurring" && values.recurrenceFirstDueDate) {
      return [
        {
          number: 1,
          dueDate: Timestamp.fromDate(values.recurrenceFirstDueDate),
          value: values.totalValue,
          status: "pending",
        },
      ];
    }

    return [];
  }

  function buildExpensePayload(values: ExpenseFormValues) {
    const account = activeAccounts.find((item: any) => item.id === values.accountPlan);
    const installmentsToSave = buildInstallmentsFromValues(values);

    return {
      accountPlan: values.accountPlan || "",
      accountId: values.accountPlan || "",
      accountPlanName: account?.name || values.accountPlan || "",
      description: values.description || "",
      supplier: values.supplier ?? "",
      notes: values.notes ?? "",
      totalValue: values.totalValue || 0,
      competenceDate: values.competenceDate ? Timestamp.fromDate(values.competenceDate) : null,
      dueDate:
        values.paymentMethod === "installments"
          ? values.installmentType === "equal"
            ? values.firstInstallmentDueDate
              ? Timestamp.fromDate(values.firstInstallmentDueDate)
              : null
            : values.variedInstallments?.[0]?.dueDate
            ? Timestamp.fromDate(values.variedInstallments[0].dueDate)
            : null
          : values.paymentMethod === "recurring"
          ? values.recurrenceFirstDueDate
            ? Timestamp.fromDate(values.recurrenceFirstDueDate)
            : null
          : values.dueDate
          ? Timestamp.fromDate(values.dueDate)
          : null,
      paymentMethod: values.paymentMethod,
      installmentType: values.paymentMethod === "installments" ? values.installmentType ?? null : null,
      installmentPeriodicity:
        values.paymentMethod === "installments" ? values.installmentPeriodicity ?? null : null,
      isApportioned: values.isApportioned,
      resultCenter: values.isApportioned ? null : values.resultCenter ?? null,
      apportionments: values.isApportioned ? values.apportionments : null,
      installments: installmentsToSave,
      recurrenceFirstDueDate:
        values.paymentMethod === "recurring" && values.recurrenceFirstDueDate
          ? Timestamp.fromDate(values.recurrenceFirstDueDate)
          : null,
      recurrenceEndDate:
        values.paymentMethod === "recurring" && values.recurrenceEndDate
          ? Timestamp.fromDate(values.recurrenceEndDate)
          : null,
      updatedAt: Timestamp.now(),
    };
  }

  async function handleSaveDraft() {
    if (!firebaseUser) return;
    setIsSaving(true);

    try {
      const values = form.getValues();
      const payload = {
        ...buildExpensePayload(values),
        status: "draft",
        createdBy: firebaseUser.uid,
        draftSavedAt: Timestamp.now(),
      };

      if (editId) {
        await updateDoc(financialDoc("expenses", editId), payload);
      } else {
        await addDoc(financialCollection("expenses"), {
          ...payload,
          createdAt: Timestamp.now(),
        });
      }

      toast({ title: "Rascunho salvo." });
      router.push(`${FINANCIAL_ROUTES.expenses}?status=draft`);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar rascunho",
        description: "Não foi possível guardar o preenchimento atual.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function onSubmit(values: ExpenseFormValues) {
    if (!firebaseUser) return;
    setIsSaving(true);

    try {
      const recurringOccurrences =
        values.paymentMethod === "recurring"
          ? buildRecurringOccurrences(
              values.recurrenceFirstDueDate,
              values.recurrenceEndDate,
              values.totalValue
            )
          : [];

      const importPaymentMetadata =
        importTransactionId && importTransactionData
          ? {
              status: "paid",
              paidAt: importTransactionData.date,
              paidByImport: true,
              linkedBankTransactionId: importTransactionId,
              importedFrom: "bank_statement",
              rawBankDescription: importTransactionData.rawBankDescription || importTransactionData.description || "",
            }
          : {
              status: "pending",
            };

      const payload = {
        ...buildExpensePayload(values),
        ...importPaymentMetadata,
      };

      let savedExpenseId = editId || "";

      if (editId && values.paymentMethod !== "recurring") {
        await updateDoc(financialDoc("expenses", editId), payload);
        toast({ title: "Despesa atualizada." });
      } else if (values.paymentMethod === "recurring") {
        const recurrenceGroupId = crypto.randomUUID();
        const [firstOccurrence, ...remainingOccurrences] = recurringOccurrences;

        if (editId && firstOccurrence) {
          await updateDoc(financialDoc("expenses", editId), {
            ...payload,
            totalValue: firstOccurrence.value,
            competenceDate: Timestamp.fromDate(firstOccurrence.competenceDate),
            dueDate: Timestamp.fromDate(firstOccurrence.dueDate),
            installments: [
              {
                number: 1,
                dueDate: Timestamp.fromDate(firstOccurrence.dueDate),
                value: firstOccurrence.value,
                status: "pending",
              },
            ],
            recurrenceGroupId,
            recurrenceIndex: firstOccurrence.number,
            recurrenceTotal: recurringOccurrences.length,
          });
        }

        await Promise.all(
          (editId ? remainingOccurrences : recurringOccurrences).map((occurrence) =>
            addDoc(financialCollection("expenses"), {
              ...payload,
              totalValue: occurrence.value,
              competenceDate: Timestamp.fromDate(occurrence.competenceDate),
              dueDate: Timestamp.fromDate(occurrence.dueDate),
              installments: [
                {
                  number: 1,
                  dueDate: Timestamp.fromDate(occurrence.dueDate),
                  value: occurrence.value,
                  status: "pending",
                },
              ],
              recurrenceGroupId,
              recurrenceIndex: occurrence.number,
              recurrenceTotal: recurringOccurrences.length,
              recurrenceFirstDueDate: Timestamp.fromDate(values.recurrenceFirstDueDate!),
              recurrenceEndDate: Timestamp.fromDate(values.recurrenceEndDate!),
              status: "pending",
              createdBy: firebaseUser.uid,
              createdAt: Timestamp.now(),
            })
          )
        );
        toast({ title: "Despesas recorrentes lançadas." });
      } else {
        const createdExpense = await addDoc(financialCollection("expenses"), {
          ...payload,
          createdBy: firebaseUser.uid,
          createdAt: Timestamp.now(),
        });
        savedExpenseId = createdExpense.id;
        toast({ title: "Despesa lançada." });
      }

      if (importTransactionId && savedExpenseId) {
        await updateDoc(financialDoc("transactions", importTransactionId), {
          auditStatus: "resolved",
          linkedExpenseId: savedExpenseId,
        });
      }

      router.push(returnTo || FINANCIAL_ROUTES.expenses);
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

  async function handleFinalizeClick() {
    if (paymentMethod === "recurring") {
      form.clearErrors("competenceDate");
      form.setValue("competenceDate", undefined, { shouldDirty: false, shouldValidate: false });
    }

    await form.handleSubmit(
      onSubmit,
      (errors: FieldErrors<ExpenseFormValues>) => {
        const flattenedErrors = flattenFormErrors(errors);
        console.error("Expense form validation errors:", flattenedErrors, errors);
        toast({
          variant: "destructive",
          title: "Revise os campos obrigatórios.",
          description: flattenedErrors[0]?.message || "Há campos pendentes no formulário.",
        });
      }
    )();
  }

  if (isLoadingExpense || accountPlansLoading || unitsLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isDraftFlow = !editId || loadedStatus === "draft";
  const drawerTitle = editId ? "Editar despesa" : "Lançar nova despesa";
  const drawerSubtitle = "Provisione um compromisso financeiro do plano de contas.";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="min-h-[calc(100vh-5rem)]">
        <div className="flex min-h-[calc(100vh-5rem)] bg-black/25 backdrop-blur-[2px]">
          <div className="hidden flex-1 xl:block" />

          <div className="ml-auto flex w-full max-w-[1220px] overflow-hidden rounded-l-[32px] border border-border/70 bg-background shadow-2xl">
            <div className="flex min-w-0 flex-1 flex-col border-r">
              <div className="border-b px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Despesas / {editId ? "Editar" : "Lançar nova"}</p>
                    <h1 className="mt-2 text-[2rem] font-semibold leading-none">{drawerTitle}</h1>
                    <p className="text-sm text-muted-foreground">{drawerSubtitle}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px]">Rascunho · auto-save</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      onClick={() => router.push(returnTo || FINANCIAL_ROUTES.expenses)}
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Fechar</span>
                    </Button>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {steps.map((step, index) => {
                    const isActive = currentStep === step.id;
                    const isDone = activeStepIndex > index;

                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setCurrentStep(step.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          isActive
                            ? "border-foreground bg-foreground text-background"
                            : isDone
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/40"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                            isActive ? "bg-background/15 text-background" : isDone ? "bg-emerald-100 text-emerald-700" : "bg-muted text-foreground"
                          )}
                        >
                          {isDone ? <Check className="h-3 w-3" /> : index + 1}
                        </span>
                        {step.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-6 px-6 py-6">
                  {currentStep === "identification" && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold">Identificação</h2>
                        <p className="text-sm text-muted-foreground">Quem cobra, do que se trata e quanto.</p>
                      </div>

                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Descrição da despesa</FormLabel>
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <FormControl>
                                  <Input
                                    placeholder="Ex: aluguel — setembro/26"
                                    {...field}
                                    autoComplete="off"
                                    onFocus={() => setDescriptionFocused(true)}
                                    onBlur={() => window.setTimeout(() => setDescriptionFocused(false), 120)}
                                  />
                                </FormControl>
                                {descriptionFocused && visibleExpenseDescriptions.length > 0 ? (
                                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                                    <ScrollArea className="max-h-64">
                                      <div className="p-1">
                                        {visibleExpenseDescriptions.map((item) => (
                                          <button
                                            key={item.id}
                                            type="button"
                                            className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
                                            onMouseDown={(event) => {
                                              event.preventDefault();
                                              field.onChange(item.label);
                                              setDescriptionFocused(false);
                                            }}
                                          >
                                            <Check className="h-4 w-4 opacity-40" />
                                            <span className="truncate">{item.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </ScrollArea>
                                  </div>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                onClick={() => void handleQuickAddExpenseDescription()}
                                disabled={!descriptionValue?.trim() || hasMatchingExpenseDescription}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

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
                                      {field.value || "Buscar fornecedor"}
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-[340px] p-0" align="start">
                                  <div className="space-y-2 p-2">
                                    <Input
                                      placeholder="Buscar ou digitar..."
                                      value={supplierSearch || field.value || ""}
                                      onChange={(event) => {
                                        const nextValue = event.target.value;
                                        setSupplierSearch(nextValue);
                                        field.onChange(nextValue);
                                      }}
                                    />
                                    <ScrollArea className="h-64">
                                      <div className="space-y-3 pr-2">
                                        {filteredEntities.length === 0 && filteredUsers.length === 0 ? (
                                          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                                            Nenhum cadastro encontrado. Use o texto digitado ou adicione via +.
                                          </div>
                                        ) : (
                                          <>
                                            {filteredEntities.length > 0 && (
                                              <div className="space-y-1">
                                                <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Entidades</p>
                                                {filteredEntities.map((entity) => {
                                                  const label = entity.fantasyName || entity.name;
                                                  const isSelected = field.value === label;
                                                  return (
                                                    <button
                                                      key={entity.id}
                                                      type="button"
                                                      className={cn(
                                                        "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                                                        isSelected && "border-border bg-muted/30"
                                                      )}
                                                      onClick={() => {
                                                        field.onChange(label);
                                                        setSupplierSearch(label);
                                                        setSupplierOpen(false);
                                                      }}
                                                    >
                                                      <span className="truncate">{label}</span>
                                                      {isSelected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            )}
                                            {filteredUsers.length > 0 && (
                                              <div className="space-y-1">
                                                <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Usuários</p>
                                                {filteredUsers.map((user) => {
                                                  const label = user.username || user.email;
                                                  const isSelected = field.value === label;
                                                  return (
                                                    <button
                                                      key={user.id}
                                                      type="button"
                                                      className={cn(
                                                        "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                                                        isSelected && "border-border bg-muted/30"
                                                      )}
                                                      onClick={() => {
                                                        field.onChange(label);
                                                        setSupplierSearch(label);
                                                        setSupplierOpen(false);
                                                      }}
                                                    >
                                                      <span className="truncate">{label}</span>
                                                      <Badge variant="secondary" className="ml-auto text-[10px] py-0">
                                                        <UserRound className="mr-1 h-2.5 w-2.5" />
                                                        Usuário
                                                      </Badge>
                                                      {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                                                    </button>
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </ScrollArea>
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setQuickAddOpen(true)}>
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
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

                        <div className="space-y-2">
                          <FormLabel>Tipo de lançamento</FormLabel>
                          <Input value="Despesa manual" disabled />
                        </div>
                      </div>

                      <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Observações (opcional)</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Notas internas, número de boleto, contrato vinculado..." {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  {currentStep === "classification" && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold">Classificação contábil</h2>
                        <p className="text-sm text-muted-foreground">Plano de contas, centro de resultado e rateio.</p>
                      </div>

                      <FormField
                        control={form.control}
                        name="accountPlan"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plano de contas</FormLabel>
                            <Popover open={accountPlanOpen} onOpenChange={setAccountPlanOpen}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={accountPlanOpen}
                                    className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                                  >
                                    {selectedAccountPlan ? (
                                      <span className="truncate">
                                        <span className="mr-1 text-xs text-muted-foreground">{ACCOUNT_GROUP_LABELS[selectedAccountPlan.group] ?? selectedAccountPlan.group} ·</span>
                                        {selectedAccountPlan.name}
                                      </span>
                                    ) : (
                                      "Selecione o plano de contas"
                                    )}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-[440px] p-2" align="start">
                                <div className="space-y-2">
                                  <Input
                                    placeholder="Buscar plano de contas..."
                                    value={accountPlanSearch}
                                    onChange={(event) => setAccountPlanSearch(event.target.value)}
                                  />
                                  <ScrollArea className="h-80">
                                    <div className="space-y-1 pr-2">
                                      {filteredGroupedAccounts.length === 0 ? (
                                        <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                                          Nenhum plano encontrado.
                                        </div>
                                      ) : filteredGroupedAccounts.map((group) => (
                                        <div key={group.group}>
                                          <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                            {group.label}
                                          </div>
                                          {group.accounts.map((account: any) => (
                                            <button
                                              key={account.id}
                                              type="button"
                                              className={cn(
                                                "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40",
                                                field.value === account.id && "bg-muted/30 font-medium"
                                              )}
                                              onClick={() => { field.onChange(account.id); setAccountPlanOpen(false); }}
                                            >
                                              <span className="truncate">{account.name}</span>
                                              {field.value === account.id && <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />}
                                            </button>
                                          ))}
                                        </div>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </div>
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {!isApportioned && (
                        <FormField
                          control={form.control}
                          name="resultCenter"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Centro de resultado / Unidade</FormLabel>
                              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                {units.map((unit) => (
                                  <button
                                    key={unit.id}
                                    type="button"
                                    onClick={() => field.onChange(unit.name)}
                                    className={cn(
                                      "rounded-xl border px-3 py-3 text-left transition-colors hover:border-primary/40",
                                      field.value === unit.name && "border-primary bg-primary/5"
                                    )}
                                  >
                                    <p className="text-sm font-medium">{unit.name}</p>
                                  </button>
                                ))}
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      <FormField
                        control={form.control}
                        name="isApportioned"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-xl border p-4">
                            <div>
                              <FormLabel>Ratear entre unidades</FormLabel>
                              <p className="text-sm text-muted-foreground">Distribua o valor proporcionalmente entre centros de resultado.</p>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {isApportioned && (
                        <div className="space-y-4 rounded-xl border p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">Rateio</p>
                              <p className="text-sm text-muted-foreground">A soma deve fechar em 100%.</p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={() => appendApportionment({ resultCenter: "", percentage: 0 })}>
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
                      )}
                    </div>
                  )}

                  {currentStep === "schedule" && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold">Vencimento e parcelas</h2>
                        <p className="text-sm text-muted-foreground">Quando pagar e como dividir.</p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
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
                          <FormField
                            control={form.control}
                            name="firstInstallmentDueDate"
                            render={({ field }) => (
                              <FormItem>
                                <DatePickerField label="Vencimento" value={field.value} onChange={field.onChange} />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        <FormField
                          control={form.control}
                          name="competenceDate"
                          render={({ field }) => (
                            <FormItem>
                              <DatePickerField label="Competência" value={field.value} onChange={field.onChange} disabled={paymentMethod === "recurring"} />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="space-y-2">
                        <FormLabel>Parcelamento</FormLabel>
                        <div className="flex flex-wrap gap-2">
                          {[1, 2, 3, 4, 6, 12].map((qty) => {
                            const active = qty === 1 ? paymentMethod === "single" : paymentMethod === "installments" && Number(installmentsQty) === qty;
                            return (
                              <Button
                                key={qty}
                                type="button"
                                variant={active ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                  if (qty === 1) {
                                    form.setValue("paymentMethod", "single");
                                  } else {
                                    form.setValue("paymentMethod", "installments");
                                    form.setValue("installments", qty);
                                    form.setValue("installmentType", "equal");
                                  }
                                }}
                              >
                                {qty === 1 ? "à vista" : `${qty}x`}
                              </Button>
                            );
                          })}
                          <Button
                            type="button"
                            variant={paymentMethod === "recurring" ? "default" : "outline"}
                            size="sm"
                            onClick={() => form.setValue("paymentMethod", "recurring")}
                          >
                            recorrente
                          </Button>
                        </div>
                      </div>

                      {paymentMethod === "installments" && installmentsSummary && installmentsSummary.length > 0 && (
                        <div className="rounded-xl border">
                          <div className="border-b px-4 py-3">
                            <p className="text-sm font-medium">Pré-visualização das parcelas</p>
                          </div>
                          <div className="space-y-2 p-4">
                            {installmentsSummary.map((installment) => (
                              <div key={installment.number} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                                <span>{installment.number}/{installmentsSummary.length}</span>
                                <span>{format(installment.dueDate, "dd/MM/yyyy")}</span>
                                <span className="font-mono font-semibold">{formatCurrency(installment.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {paymentMethod === "recurring" && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField
                            control={form.control}
                            name="recurrenceFirstDueDate"
                            render={({ field }) => (
                              <FormItem>
                                <DatePickerField label="Primeira cobrança" value={field.value} onChange={field.onChange} />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="recurrenceEndDate"
                            render={({ field }) => (
                              <FormItem>
                                <DatePickerField label="Cobrar até" value={field.value} onChange={field.onChange} />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {currentStep === "review" && (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold">Revisão final</h2>
                        <p className="text-sm text-muted-foreground">Confira antes de salvar.</p>
                      </div>

                      <div className="rounded-xl border p-4">
                        <div className="flex items-start justify-between gap-4 border-b pb-4">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Descrição</p>
                            <p className="text-lg font-semibold">{descriptionValue || "—"}</p>
                            <p className="text-sm text-muted-foreground">{supplierValue || "—"}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Total</p>
                            <p className="font-mono text-2xl font-bold">{formatCurrency(totalValue || 0)}</p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-4">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Plano de contas</p>
                            <p className="text-sm font-medium">{selectedAccountPlan?.name || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Unidade</p>
                            <p className="text-sm font-medium">{isApportioned ? "Rateado" : resultCenterValue || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Vencimento</p>
                            <p className="text-sm font-medium">{previewDueDate ? format(previewDueDate, "dd/MM/yyyy") : "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Parcelamento</p>
                            <p className="text-sm font-medium">
                              {paymentMethod === "single"
                                ? "à vista"
                                : paymentMethod === "installments"
                                ? `${installmentsSummary?.length || installmentsQty}x`
                                : "recorrente"}
                            </p>
                          </div>
                        </div>

                        {notesValue ? (
                          <div className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Obs.:</span> {notesValue}
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                        Tudo certo. Ao salvar, a despesa entrará na fila {editId ? "atualizada" : "em aberto"} e ficará disponível para pagamento.
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t bg-background px-6 py-4">
                <div className={cn("flex flex-wrap items-center justify-between gap-3")}>
                  <Button type="button" variant="ghost" onClick={() => router.push(returnTo || FINANCIAL_ROUTES.expenses)}>
                    Cancelar
                  </Button>

                  <div className="flex flex-wrap items-center gap-2">
                    {activeStepIndex > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCurrentStep(steps[activeStepIndex - 1].id)}
                      >
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        Voltar
                      </Button>
                    )}
                    {isDraftFlow && (
                      <Button type="button" variant="secondary" disabled={isSaving} onClick={() => void handleSaveDraft()}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Salvar rascunho
                      </Button>
                    )}
                    {currentStep !== "review" ? (
                      <Button type="button" onClick={() => setCurrentStep(steps[activeStepIndex + 1].id)}>
                        Continuar
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : (
                      <Button type="button" disabled={isSaving} onClick={() => void handleFinalizeClick()}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {editId ? "Atualizar despesa" : "Provisionar despesa"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <aside className="w-[344px] shrink-0 bg-muted/20">
              <div className="border-b px-5 py-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pré-visualização</p>
                <h3 className="mt-1 text-sm font-semibold">Como aparecerá na fila</h3>
              </div>

              <div className="space-y-4 p-5">
                <div className="rounded-2xl border bg-background p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="mt-1 h-9 w-1 rounded-full bg-blue-500" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{descriptionValue || "Descrição da despesa"}</p>
                      <p className="truncate text-xs text-muted-foreground">{supplierValue || "Sem fornecedor"}</p>
                    </div>
                    <p className="font-mono text-lg font-bold">{formatCurrency(totalValue || 0)}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
                      {editId ? "Em aberto" : "Rascunho"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="font-medium text-muted-foreground">Vencimento</p>
                      <p className="mt-1">{previewDueDate ? format(previewDueDate, "dd/MM/yyyy") : "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Unidade</p>
                      <p className="mt-1">{isApportioned ? "Rateado" : resultCenterValue || "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Competência</p>
                      <p className="mt-1">{previewCompetence ? format(previewCompetence, "MM/yyyy") : "—"}</p>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Plano</p>
                      <p className="mt-1">{selectedAccountPlan?.order || "—"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border bg-background p-4 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Validações</p>
                  <div className="mt-3 space-y-2">
                    {validationItems.map((item) => (
                      <div key={item.label} className={cn("flex items-center gap-2 text-sm", item.ok ? "text-emerald-600" : "text-muted-foreground")}>
                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", item.ok ? "bg-emerald-50" : "bg-muted")}>
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span>{item.label} {item.ok ? "informado" : "pendente"}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground shadow-sm">
                  <p className="font-semibold text-foreground">Sugestão</p>
                  <p className="mt-2">
                    {paymentMethod === "recurring"
                      ? "Essa despesa parece recorrente. Confira o período antes de finalizar."
                      : "Se essa despesa se repete com frequência, considere salvar um rascunho modelo."}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <QuickAddEntityDialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onCreated={(name) => form.setValue("supplier", name)} />
      </form>
    </Form>
  );
}
