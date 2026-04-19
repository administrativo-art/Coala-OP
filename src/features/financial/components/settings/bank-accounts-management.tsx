"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  Banknote,
  Building2,
  Check,
  ChevronsUpDown,
  CreditCard,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import {
  bankAccountSchema,
  type BankAccountFormValues,
} from "@/features/financial/lib/schemas";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type BrazilianBank = { ispb: string; name: string; code: number | null };

const PAYMENT_TYPES = [
  { value: "debit_card", label: "Cartão de débito", icon: CreditCard, color: "text-emerald-400" },
  { value: "credit_card", label: "Cartão de crédito", icon: CreditCard, color: "text-sky-400" },
  { value: "pix", label: "PIX", icon: Smartphone, color: "text-teal-400" },
  { value: "transfer", label: "Transferência", icon: Landmark, color: "text-violet-400" },
  { value: "cash", label: "Dinheiro", icon: Banknote, color: "text-amber-400" },
] as const;

function BankCombobox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [banks, setBanks] = useState<BrazilianBank[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("https://brasilapi.com.br/api/banks/v1")
      .then((response) => response.json())
      .then((data: BrazilianBank[]) =>
        setBanks(data.filter((bank) => bank.name).sort((a, b) => a.name.localeCompare(b.name)))
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return banks.slice(0, 40);
    const normalized = query.toLowerCase();
    return banks
      .filter(
        (bank) =>
          bank.name.toLowerCase().includes(normalized) || String(bank.code ?? "").includes(normalized)
      )
      .slice(0, 40);
  }, [banks, query]);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Input
          value={query}
          placeholder="Buscar banco ou instituição"
          onChange={(event) => {
            setQuery(event.target.value);
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.map((bank) => (
            <button
              key={bank.ispb}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(bank.name);
                setQuery(bank.name);
                setOpen(false);
              }}
            >
              {bank.code && <span className="w-8 shrink-0 text-xs text-muted-foreground">{bank.code}</span>}
              <span className="truncate">{bank.name}</span>
              {bank.name === value && <Check className="ml-auto h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentMethodIcon({ type }: { type: string }) {
  const config = PAYMENT_TYPES.find((item) => item.value === type);
  const Icon = config?.icon || Wallet;
  return <Icon className={`h-3.5 w-3.5 ${config?.color || "text-muted-foreground"}`} />;
}

export default function BankAccountsManagement({ canManage = true }: { canManage?: boolean }) {
  const { firebaseUser } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<any[] | null>(null);
  const [resultCenters, setResultCenters] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const accountsList = accounts ?? [];
  const resultCentersList = resultCenters ?? [];
  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );
  const linkOptions = useMemo(
    () =>
      resultCentersList.length > 0
        ? resultCentersList.map((resultCenter) => ({
            id: resultCenter.id,
            name: resultCenter.name,
            label: "Centro de resultado",
          }))
        : units.map((unit) => ({
            id: unit.id,
            name: unit.name,
            label: "Unidade",
          })),
    [resultCentersList, units]
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!auth.currentUser) {
      setError(new Error("Usuário não autenticado."));
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const token = await auth.currentUser.getIdToken();
      const [accountsResponse, resultCentersResponse] = await Promise.all([
        fetchWithTimeout("/api/financial/data?path=bankAccounts", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
        fetchWithTimeout("/api/financial/data?path=resultCenters", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        }),
      ]);

      const accountsPayload = await accountsResponse.json().catch(() => ({}));
      const resultCentersPayload = await resultCentersResponse.json().catch(() => ({}));

      if (!accountsResponse.ok) {
        throw new Error(accountsPayload?.error || "Falha ao carregar as contas bancárias.");
      }

      if (!resultCentersResponse.ok) {
        throw new Error(resultCentersPayload?.error || "Falha ao carregar os centros de resultado.");
      }

      setAccounts((accountsPayload.docs ?? []) as any[]);
      setResultCenters((resultCentersPayload.docs ?? []) as any[]);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError : new Error("Falha ao carregar as contas bancárias.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const form = useForm<BankAccountFormValues>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: {
      name: "",
      agency: "",
      accountNumber: "",
      active: true,
      resultCenterId: undefined,
      paymentMethods: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "paymentMethods" });

  function openCreate() {
    setEditTarget(null);
    form.reset({
      name: "",
      agency: "",
      accountNumber: "",
      active: true,
      paymentMethods: [{ id: crypto.randomUUID(), type: "pix", label: "PIX principal" }],
    });
    setDialogOpen(true);
  }

  function openEdit(account: any) {
    setEditTarget(account);
    form.reset({
      name: account.name,
      agency: account.agency || "",
      accountNumber: account.accountNumber || "",
      active: account.active,
      resultCenterId: account.resultCenterId || account.unitId || undefined,
      paymentMethods: account.paymentMethods || [],
    });
    setDialogOpen(true);
  }

  async function onSubmit(values: BankAccountFormValues) {
    if (!firebaseUser) return;
    setIsSaving(true);

    const clean = (entry: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));

    const payload = {
      ...clean(values as unknown as Record<string, unknown>),
      paymentMethods: values.paymentMethods.map((paymentMethod) =>
        clean(paymentMethod as unknown as Record<string, unknown>)
      ),
    };

    try {
      if (editTarget) {
        await updateDoc(financialDoc("bankAccounts", editTarget.id), payload);
        toast({ title: "Conta atualizada com sucesso!" });
      } else {
        await addDoc(financialCollection("bankAccounts"), {
          ...payload,
          createdBy: firebaseUser.uid,
          createdAt: Timestamp.now(),
        });
        toast({ title: "Conta criada com sucesso!" });
      }
      await refresh();
      setDialogOpen(false);
      setEditTarget(null);
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Erro ao salvar conta." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDoc(financialDoc("bankAccounts", deleteTarget.id));
      toast({ title: "Conta removida com sucesso." });
      await refresh();
    } catch {
      toast({ variant: "destructive", title: "Erro ao remover conta." });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Contas bancárias</CardTitle>
            <CardDescription>Gerencie instituições financeiras, carteiras e métodos de pagamento vinculados.</CardDescription>
          </div>
          {canManage && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nova conta
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Falha ao carregar as contas bancárias.</p>
                <p>{error.message}</p>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : accountsList.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nenhuma conta cadastrada.
          </div>
        ) : (
          accountsList.map((account) => {
            const linkedResultCenter = resultCentersList.find((item) => item.id === account.resultCenterId);
            const linkedUnit = units.find((item) => item.id === (account.unitId || account.resultCenterId));
            return (
              <div key={account.id} className="rounded-lg border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <p className="font-semibold">{account.name}</p>
                      {!account.active && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          Inativa
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Agência {account.agency || "—"} · Conta {account.accountNumber || "—"}
                    </p>
                    {linkedResultCenter && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Centro de resultado padrão: {linkedResultCenter.name}
                      </p>
                    )}
                    {!linkedResultCenter && linkedUnit && (
                      <p className="mt-1 text-xs text-muted-foreground">Unidade vinculada: {linkedUnit.name}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(account)}>
                        <Pencil className="mr-2 h-4 w-4" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteTarget(account)}>
                        <Trash2 className="mr-2 h-4 w-4" /> Excluir
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(account.paymentMethods || []).map((method: any) => (
                    <span key={method.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
                      <PaymentMethodIcon type={method.type} />
                      {method.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditTarget(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Editar conta" : "Nova conta bancária"}</DialogTitle>
            <DialogDescription>
              Cadastre a instituição financeira, o vínculo padrão e as formas de pagamento aceitas.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instituição</FormLabel>
                      <FormControl>
                        <BankCombobox value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="resultCenterId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{resultCentersList.length > 0 ? "Centro de resultado padrão" : "Unidade vinculada"}</FormLabel>
                      <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? undefined : value)}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={resultCentersList.length > 0 ? "Selecione o centro" : "Selecione a unidade"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Nenhuma (conta compartilhada)</SelectItem>
                          {linkOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                            </SelectItem>
                          ))}
                          {!linkOptions.length && !kiosksLoading && (
                            <SelectItem value="empty" disabled>
                              Nenhum vínculo disponível
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Deixe sem vínculo para contas compartilhadas ou contas sem centro padrão.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="agency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Agência</FormLabel>
                      <FormControl>
                        <Input placeholder="0001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Número da conta</FormLabel>
                      <FormControl>
                        <Input placeholder="12345-6" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Conta ativa</FormLabel>
                      <FormDescription>Contas inativas não aparecem para novos lançamentos.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Métodos de pagamento</p>
                    <p className="text-xs text-muted-foreground">Defina as opções vinculadas a esta conta.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({ id: crypto.randomUUID(), type: "pix", label: "Novo método" })
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border border-dashed p-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name={`paymentMethods.${index}.label`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rótulo</FormLabel>
                            <FormControl>
                              <Input placeholder="Ex: PIX principal" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`paymentMethods.${index}.type`}
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
                                {PAYMENT_TYPES.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <FormField
                        control={form.control}
                        name={`paymentMethods.${index}.lastDigits`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Últimos dígitos</FormLabel>
                            <FormControl>
                              <Input placeholder="1234" maxLength={4} {...field} value={field.value ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`paymentMethods.${index}.pixKey`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Chave PIX</FormLabel>
                            <FormControl>
                              <Input placeholder="Chave PIX" {...field} value={field.value ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`paymentMethods.${index}.limit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Limite</FormLabel>
                            <FormControl>
                              <Input type="number" min="0" step="0.01" {...field} value={field.value ?? ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                        <X className="mr-1 h-3.5 w-3.5" /> Remover método
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta bancária?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove a conta <strong>{deleteTarget?.name}</strong> do módulo financeiro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
