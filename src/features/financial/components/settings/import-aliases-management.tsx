"use client";

import { useMemo, useState } from "react";
import { addDoc, deleteDoc, Timestamp, updateDoc } from "firebase/firestore";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { financialCollection, financialDoc } from "@/features/financial/lib/repositories";
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

const aliasSchema = z.object({
  pattern: z.string().min(2, "O padrão deve ter pelo menos 2 caracteres."),
  matchType: z.enum(["contains", "startsWith", "endsWith", "exact"]),
  caseSensitive: z.boolean().default(false),
  accountPlanId: z.string().optional(),
  resultCenterId: z.string().optional(),
  supplier: z.string().optional(),
  descriptionOverride: z.string().optional(),
});

type AliasFormValues = z.infer<typeof aliasSchema>;

const MATCH_TYPE_LABELS: Record<string, string> = {
  contains: "Contém",
  startsWith: "Começa com",
  endsWith: "Termina com",
  exact: "Exato",
};

export default function ImportAliasesManagement({ canManage = true }: { canManage?: boolean }) {
  const { firebaseUser } = useAuth();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const { data: aliases, loading } = useFinancialCollection<any>(financialCollection("importAliases"));
  const { data: accountPlans } = useFinancialCollection<any>(financialCollection("accountPlans"));
  const units = useMemo(
    () => [...kiosks].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    [kiosks]
  );
  const [open, setOpen] = useState(false);
  const [editingAlias, setEditingAlias] = useState<any | null>(null);
  const [deletingAlias, setDeletingAlias] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<AliasFormValues>({
    resolver: zodResolver(aliasSchema),
    defaultValues: { pattern: "", matchType: "contains", caseSensitive: false },
  });

  function openNew() {
    setEditingAlias(null);
    form.reset({
      pattern: "",
      matchType: "contains",
      caseSensitive: false,
      accountPlanId: "",
      resultCenterId: "",
      supplier: "",
      descriptionOverride: "",
    });
    setOpen(true);
  }

  function openEdit(alias: any) {
    setEditingAlias(alias);
    form.reset({
      pattern: alias.pattern,
      matchType: alias.matchType,
      caseSensitive: alias.caseSensitive ?? false,
      accountPlanId: alias.accountPlanId || "",
      resultCenterId: alias.resultCenterId || "",
      supplier: alias.supplier || "",
      descriptionOverride: alias.descriptionOverride || "",
    });
    setOpen(true);
  }

  async function onSubmit(values: AliasFormValues) {
    if (!firebaseUser) return;
    setIsSaving(true);
    try {
      const plan = accountPlans?.find((item) => item.id === values.accountPlanId);
      const unit = units.find((item) => item.id === values.resultCenterId);

      const payload = {
        pattern: values.pattern,
        matchType: values.matchType,
        caseSensitive: values.caseSensitive,
        accountPlanId: values.accountPlanId || null,
        accountPlanName: plan?.name || null,
        resultCenterId: values.resultCenterId || null,
        resultCenterName: unit?.name || null,
        supplier: values.supplier || null,
        descriptionOverride: values.descriptionOverride || null,
      };

      if (editingAlias) {
        await updateDoc(financialDoc("importAliases", editingAlias.id), payload);
        toast({ title: "Alias atualizado." });
      } else {
        await addDoc(financialCollection("importAliases"), {
          ...payload,
          createdBy: firebaseUser.uid,
          createdAt: Timestamp.now(),
        });
        toast({ title: "Alias criado." });
      }
      setOpen(false);
      setEditingAlias(null);
    } catch {
      toast({ variant: "destructive", title: "Erro ao salvar o alias." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingAlias) return;
    try {
      await deleteDoc(financialDoc("importAliases", deletingAlias.id));
      toast({ title: "Alias removido." });
    } catch {
      toast({ variant: "destructive", title: "Erro ao remover o alias." });
    } finally {
      setDeletingAlias(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            Aliases de importação
          </CardTitle>
          <CardDescription>
            Regras automáticas usadas para pré-classificar transações de extratos bancários.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo alias
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-12 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : !aliases?.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nenhum alias cadastrado.
          </div>
        ) : (
          <div className="divide-y">
            {aliases.map((alias) => (
              <div key={alias.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{alias.pattern}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {MATCH_TYPE_LABELS[alias.matchType] || alias.matchType}
                    </Badge>
                    {alias.caseSensitive && (
                      <Badge variant="outline" className="text-[10px] text-amber-600">
                        Aa
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {alias.accountPlanName && <span>Conta: {alias.accountPlanName}</span>}
                    {alias.resultCenterName && <span>Unidade: {alias.resultCenterName}</span>}
                    {alias.supplier && <span>Fornecedor: {alias.supplier}</span>}
                    {alias.descriptionOverride && <span>Descrição: “{alias.descriptionOverride}”</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(alias)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-rose-500 hover:text-rose-600"
                      onClick={() => setDeletingAlias(alias)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setOpen(false);
            setEditingAlias(null);
          }
        }}
      >
        <DialogContent className="max-w-md" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingAlias ? "Editar alias" : "Novo alias"}</DialogTitle>
            <DialogDescription>Essa regra será aplicada automaticamente na revisão de importação.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="pattern"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Padrão</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: UBER, GOOGLE, IFOOD" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="matchType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de comparação</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(MATCH_TYPE_LABELS).map(([value, label]) => (
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
                control={form.control}
                name="caseSensitive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Diferenciar maiúsculas</FormLabel>
                      <p className="text-xs text-muted-foreground">Desative para comparação case-insensitive.</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountPlanId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plano de contas</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? "" : value)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o plano" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {accountPlans?.map((plan) => (
                          <SelectItem key={plan.id} value={plan.id}>
                            {plan.name}
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
                name="resultCenterId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? "" : value)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a unidade" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        {units.map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
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
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fornecedor</FormLabel>
                    <FormControl>
                      <Input placeholder="Fornecedor sugerido" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="descriptionOverride"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição sugerida</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Texto que substituirá a descrição original" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={isSaving}>
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingAlias} onOpenChange={(open) => !open && setDeletingAlias(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir alias?</AlertDialogTitle>
            <AlertDialogDescription>
              A regra <strong>{deletingAlias?.pattern}</strong> deixará de ser aplicada em futuras importações.
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
