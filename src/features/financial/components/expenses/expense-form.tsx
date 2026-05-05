"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { addMonths, addWeeks, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { addDoc, getDoc, Timestamp, updateDoc } from "firebase/firestore";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, CalendarIcon, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, CreditCard, FileText, Loader2, Plus, PlusCircle, Trash2, UserRound } from "lucide-react";
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

const ACCOUNT_GROUP_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#eab308",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

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

function buildAccountTree(items: any[], parentId: string | null = null): any[] {
  return items
    .filter((item) => item.parentId === parentId)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((item) => ({ ...item, children: buildAccountTree(items, item.id) }));
}

function flattenAccountTree(nodes: any[], level = 0, prefix = ""): any[] {
  return nodes.flatMap((node, index) => {
    const order = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    return [
      { ...node, level, order, isParent: node.children.length > 0 },
      ...flattenAccountTree(node.children, level + 1, order),
    ];
  });
}

function collectAccountParentPath(items: any[], targetId: string) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [];
  let current = byId.get(targetId);

  while (current?.parentId) {
    path.unshift(current.parentId);
    current = byId.get(current.parentId);
  }

  return path;
}

function filterAccountTree(nodes: any[], query: string): any[] {
  if (!query.trim()) return nodes;

  const normalizedQuery = query.trim().toLowerCase();

  return nodes.flatMap((node) => {
    const children = filterAccountTree(node.children ?? [], normalizedQuery);
    const matchesSelf = [node.order, node.name, node.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));

    if (!matchesSelf && children.length === 0) {
      return [];
    }

    return [
      {
        ...node,
        children: matchesSelf ? node.children ?? [] : children,
      },
    ];
  });
}

function AccountPlanTreeRow({
  node,
  depth,
  topLevelIndex,
  expanded,
  selectedId,
  searching,
  onToggle,
  onSelect,
}: {
  node: any;
  depth: number;
  topLevelIndex: number;
  expanded: Set<string>;
  selectedId: string;
  searching: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isExpanded = searching || expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const color = ACCOUNT_GROUP_COLORS[topLevelIndex % ACCOUNT_GROUP_COLORS.length];

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:bg-muted/40",
          isSelected && "border-border bg-muted/30"
        )}
      >
        {depth === 0 ? (
          <>
            <button
              type="button"
              className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              onClick={() => hasChildren && onToggle(node.id)}
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <span className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          </>
        ) : (
          <div className="relative h-5 shrink-0" style={{ width: `${18 + (depth - 1) * 18}px` }}>
            <span
              className="absolute border-b border-l border-border/70"
              style={{
                left: `${8 + (depth - 1) * 18}px`,
                top: 0,
                height: 14,
                width: 12,
                borderBottomLeftRadius: 6,
              }}
            />
          </div>
        )}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelect(node.id)}
        >
          <span className={cn("shrink-0 font-mono text-xs", depth === 0 ? "text-foreground/80" : "text-muted-foreground")}>
            {node.order}
          </span>
          <span className={cn("truncate", depth === 0 ? "font-semibold" : "font-medium")}>{node.name}</span>
        </button>

        {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
      </div>

      {hasChildren && isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {node.children.map((child: any) => (
            <AccountPlanTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              topLevelIndex={topLevelIndex}
              expanded={expanded}
              selectedId={selectedId}
              searching={searching}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
  const { firebaseUser, users } = useAuth();
  const { entities } = useEntities();
  const { kiosks, loading: unitsLoading } = useKiosks();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingExpense, setIsLoadingExpense] = useState(false);
  const [loadedStatus, setLoadedStatus] = useState<string | null>(null);
  const [accountPlanOpen, setAccountPlanOpen] = useState(false);
  const [accountPlanSearch, setAccountPlanSearch] = useState("");
  const [expandedAccountPlans, setExpandedAccountPlans] = useState<Set<string>>(new Set());
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
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
  const accountTree = useMemo(() => buildAccountTree(accountPlans || []), [accountPlans]);

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
  const firstInstallmentDueDate = form.watch("firstInstallmentDueDate");
  const installmentPeriodicity = form.watch("installmentPeriodicity");
  const recurrenceFirstDueDate = form.watch("recurrenceFirstDueDate");
  const recurrenceEndDate = form.watch("recurrenceEndDate");
  const variedInstallments = form.watch("variedInstallments");
  const isApportioned = form.watch("isApportioned");
  const apportionments = form.watch("apportionments");
  const selectedAccountPlan = useMemo(
    () => flattenedAccounts.find((account) => account.id === accountPlanValue),
    [accountPlanValue, flattenedAccounts]
  );
  const filteredAccountTree = useMemo(
    () => filterAccountTree(accountTree, accountPlanSearch),
    [accountPlanSearch, accountTree]
  );

  useEffect(() => {
    if (!accountPlanOpen) {
      setAccountPlanSearch("");
      return;
    }

    if (!accountPlanValue || !accountPlans?.length) return;

    setExpandedAccountPlans(new Set(collectAccountParentPath(accountPlans, accountPlanValue)));
  }, [accountPlanOpen, accountPlanValue, accountPlans]);

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
    const accountPlan = accountPlans?.find((item) => item.id === values.accountPlan);
    const installmentsToSave = buildInstallmentsFromValues(values);

    return {
      accountPlan: values.accountPlan || "",
      accountPlanName: accountPlan?.name || values.accountPlan || "",
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

      const payload = {
        ...buildExpensePayload(values),
        status: "pending",
      };

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
        await addDoc(financialCollection("expenses"), {
          ...payload,
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="mx-auto max-w-5xl space-y-4">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-4">
            <SectionHeading
              icon={<FileText className="h-4 w-4 text-violet-600" />}
              iconClassName="bg-violet-100"
              title="Classificação"
              description="Plano de contas, descrição e valor base"
            />
          </CardHeader>
            <CardContent className="space-y-4">
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
                                {selectedAccountPlan.order} · {selectedAccountPlan.name}
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
                              {filteredAccountTree.length === 0 ? (
                                <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                                  Nenhum plano encontrado.
                                </div>
                              ) : (
                                filteredAccountTree.map((account, index) => (
                                  <AccountPlanTreeRow
                                    key={account.id}
                                    node={account}
                                    depth={0}
                                    topLevelIndex={index}
                                    expanded={expandedAccountPlans}
                                    selectedId={field.value}
                                    searching={accountPlanSearch.trim().length > 0}
                                    onToggle={(id) =>
                                      setExpandedAccountPlans((current) => {
                                        const next = new Set(current);
                                        if (next.has(id)) next.delete(id);
                                        else next.add(id);
                                        return next;
                                      })
                                    }
                                    onSelect={(id) => {
                                      field.onChange(id);
                                      setAccountPlanOpen(false);
                                    }}
                                  />
                                ))
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </PopoverContent>
                    </Popover>
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
                      <DatePickerField
                        label="Competência"
                        value={field.value}
                        onChange={field.onChange}
                        disabled={paymentMethod === "recurring"}
                      />
                      {paymentMethod === "recurring" ? (
                        <p className="text-xs text-muted-foreground">
                          Na recorrência, a competência acompanha automaticamente o mês de cada cobrança.
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-4">
            <SectionHeading
              icon={<CreditCard className="h-4 w-4 text-sky-600" />}
              iconClassName="bg-sky-100"
              title="Pagamento"
              description="Forma, data e parcelas"
            />
          </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Forma de pagamento</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid gap-3 md:grid-cols-3"
                      >
                        <label className={cn("flex cursor-pointer flex-col items-center rounded-lg border px-4 py-3 text-center", field.value === "single" && "border-primary bg-primary/5")}>
                          <RadioGroupItem value="single" />
                          <div>
                            <p className="font-medium">Pagamento único</p>
                            <p className="text-xs text-muted-foreground">Uma parcela</p>
                          </div>
                        </label>
                        <label className={cn("flex cursor-pointer flex-col items-center rounded-lg border px-4 py-3 text-center", field.value === "installments" && "border-primary bg-primary/5")}>
                          <RadioGroupItem value="installments" />
                          <div>
                            <p className="font-medium">Parcelado</p>
                            <p className="text-xs text-muted-foreground">Parcelas iguais ou variáveis</p>
                          </div>
                        </label>
                        <label className={cn("flex cursor-pointer flex-col items-center rounded-lg border px-4 py-3 text-center", field.value === "recurring" && "border-primary bg-primary/5")}>
                          <RadioGroupItem value="recurring" />
                          <div>
                            <p className="font-medium">Recorrente</p>
                            <p className="text-xs text-muted-foreground">Cobranças mensais</p>
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
              ) : paymentMethod === "installments" ? (
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

                  {installmentsSummary && installmentsSummary.length > 0 && (
                    <div className="rounded-lg border">
                      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Parcelas geradas</p>
                          <p className="text-sm text-muted-foreground">
                            {installmentsSummary.length} parcela(s) serão criadas a partir do preenchimento atual.
                          </p>
                        </div>
                        <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] font-medium text-primary">
                          {installmentsSummary.length} parcelas · {formatCurrency(installmentsPreviewTotal)}
                        </Badge>
                      </div>
                      <ScrollArea className="h-72">
                        <div className="grid gap-2 p-4 md:grid-cols-2">
                          {installmentsSummary.map((installment) => (
                            <div
                              key={installment.number}
                              className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5"
                            >
                              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                                {installment.number}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Parcela</p>
                                    <p className="text-sm font-medium">{installment.number}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Vencimento</p>
                                    <p className="text-sm font-medium">{format(installment.dueDate, "dd/MM/yyyy")}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="shrink-0 text-sm font-semibold text-primary">{formatCurrency(installment.value)}</div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
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

                  {recurringPreview.length > 0 && (
                    <div className="rounded-lg border">
                      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Cobranças geradas</p>
                          <p className="text-sm text-muted-foreground">
                            {recurringPreview.length} lançamento(s) serão criados, um por mês, com a competência correspondente.
                          </p>
                        </div>
                        <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] font-medium text-primary">
                          {recurringPreview.length} lançamentos · {formatCurrency(recurringPreviewTotal)}
                        </Badge>
                      </div>
                      <ScrollArea className="h-72">
                        <div className="grid gap-2 p-4 md:grid-cols-2">
                          {recurringPreview.map((occurrence) => (
                            <div
                              key={occurrence.number}
                              className="flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5"
                            >
                              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                                {occurrence.number}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Competência</p>
                                    <p className="text-sm font-medium">{format(occurrence.competenceDate, "MM/yyyy")}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Vencimento</p>
                                    <p className="text-sm font-medium">{format(occurrence.dueDate, "dd/MM/yyyy")}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="shrink-0 text-sm font-semibold text-primary">{formatCurrency(occurrence.value)}</div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-4">
            <SectionHeading
              icon={<Building2 className="h-4 w-4 text-emerald-600" />}
              iconClassName="bg-emerald-100"
              title="Resultado e complemento"
              description="Unidade, fornecedor e observações"
            />
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
                                        <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                          Entidades
                                        </p>
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
                                        <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                          Usuários
                                        </p>
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

        <div className="rounded-2xl border border-border/70 bg-background px-5 py-4 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Total</p>
                <p className="text-sm font-semibold text-primary">{formatCurrency(totalValue || 0)}</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Forma</p>
                <p className="text-sm font-medium">
                  {paymentMethod === "single"
                    ? "Pagamento único"
                    : paymentMethod === "installments"
                    ? "Parcelado"
                    : "Recorrente"}
                </p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Rateio</p>
                <p className="text-sm font-medium">{isApportioned ? `${rateioTotal.toFixed(2)}%` : "Centro único"}</p>
              </div>
            </div>
            <div className="ml-auto flex w-full justify-end text-right">
              <p className="text-sm font-extrabold uppercase tracking-[0.04em] text-red-600">Confira antes de salvar</p>
            </div>
          </div>
        </div>

        <div className={cn("grid gap-2", (!editId || loadedStatus === "draft") ? "md:grid-cols-3" : "md:grid-cols-2")}>
          <Button type="button" variant="outline" className="h-11" onClick={() => router.push(FINANCIAL_ROUTES.expenses)}>
            Cancelar
          </Button>
          {(!editId || loadedStatus === "draft") && (
            <Button type="button" variant="secondary" className="h-11" disabled={isSaving} onClick={() => void handleSaveDraft()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar rascunho
            </Button>
          )}
          <Button type="submit" className="h-11" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loadedStatus === "draft" ? "Concluir lançamento" : editId ? "Atualizar" : "Salvar"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
