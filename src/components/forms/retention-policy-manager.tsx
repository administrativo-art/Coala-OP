"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  createRetentionPolicy,
  fetchRetentionPolicies,
  updateRetentionPolicy,
  type AnalyticsRetentionPolicy,
} from "@/features/forms/lib/client";

const SUBJECT_LABELS: Record<string, string> = {
  collaborator: "Colaborador",
  customer: "Cliente",
  third_party: "Terceiro",
  any: "Qualquer",
};

type FormState = {
  name: string;
  subject_type: string;
  retention_days: string;
  keep_original_in_vault: boolean;
  is_default: boolean;
};

const EMPTY: FormState = {
  name: "",
  subject_type: "collaborator",
  retention_days: "365",
  keep_original_in_vault: false,
  is_default: false,
};

export function RetentionPolicyManager() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [policies, setPolicies] = useState<AnalyticsRetentionPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setPolicies(await fetchRetentionPolicies(firebaseUser));
    } catch (error) {
      toast({
        variant: "destructive",
        title:
          error instanceof Error ? error.message : "Falha ao carregar políticas.",
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(policy: AnalyticsRetentionPolicy) {
    if (!firebaseUser) return;
    setBusyId(policy.id);
    try {
      await updateRetentionPolicy(firebaseUser, policy.id, {
        is_active: !policy.is_active,
      });
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao atualizar.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(policy: AnalyticsRetentionPolicy) {
    if (!firebaseUser || policy.is_default) return;
    setBusyId(policy.id);
    try {
      await updateRetentionPolicy(firebaseUser, policy.id, { is_default: true });
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao definir padrão.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function submitCreate() {
    if (!firebaseUser) return;
    const days = Number(form.retention_days);
    if (!form.name.trim() || !Number.isInteger(days) || days < 1) {
      toast({ variant: "destructive", title: "Preencha nome e dias válidos." });
      return;
    }
    setCreating(true);
    try {
      await createRetentionPolicy(firebaseUser, {
        name: form.name.trim(),
        subject_type: form.subject_type,
        retention_days: days,
        keep_original_in_vault: form.keep_original_in_vault,
        is_default: form.is_default,
      });
      toast({ title: "Política criada." });
      setCreateOpen(false);
      setForm(EMPTY);
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao criar política.",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Políticas de retenção
            </CardTitle>
            <CardDescription>
              Definem quando ocorrências com dados pessoais são anonimizadas.
              Aplicadas na geração; o job de anonimização usa o prazo.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nova
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Sujeito</TableHead>
                <TableHead className="text-right">Retenção</TableHead>
                <TableHead>Cofre</TableHead>
                <TableHead className="text-right">Padrão</TableHead>
                <TableHead className="text-right">Ativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Nenhuma política. Sem política, usa o prazo do ambiente
                    (FORMS_ANALYTICS_PERSONAL_RETENTION_DAYS).
                  </TableCell>
                </TableRow>
              ) : (
                policies.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell className="font-medium">{policy.name}</TableCell>
                    <TableCell className="text-xs">
                      {SUBJECT_LABELS[policy.subject_type] ?? policy.subject_type}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {policy.retention_days} dias
                    </TableCell>
                    <TableCell>
                      {policy.keep_original_in_vault ? (
                        <Badge variant="outline">Guarda original</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {policy.is_default ? (
                        <Badge>Padrão</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === policy.id || !policy.is_active}
                          onClick={() => void setDefault(policy)}
                        >
                          Tornar padrão
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={policy.is_active}
                        disabled={busyId === policy.id}
                        onCheckedChange={() => void toggleActive(policy)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova política de retenção</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Sujeito</Label>
                <Select
                  value={form.subject_type}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, subject_type: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SUBJECT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Retenção (dias)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.retention_days}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      retention_days: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.keep_original_in_vault}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    keep_original_in_vault: checked === true,
                  }))
                }
              />
              Guardar texto original em cofre restrito (com log de acesso)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.is_default}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    is_default: checked === true,
                  }))
                }
              />
              Definir como política padrão
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Voltar
            </Button>
            <Button disabled={creating} onClick={() => void submitCreate()}>
              {creating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
