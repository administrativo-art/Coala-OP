"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Tags } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useDPBootstrap } from "@/hooks/use-dp-bootstrap";
import { activeOperationalUnits } from "@/lib/dp-units";
import { useToast } from "@/hooks/use-toast";
import {
  createAnalyticsTaxonomyEntry,
  fetchAnalyticsTaxonomy,
  seedAnalyticsTaxonomy,
  updateAnalyticsTaxonomyEntry,
  type AnalyticsTaxonomyEntry,
  type AnalyticsTaxonomyKind,
} from "@/features/forms/lib/client";

const KIND_LABELS: Record<AnalyticsTaxonomyKind, string> = {
  domains: "Domínios",
  criteria: "Quesitos",
  results: "Resultados",
  targets: "Alvos operacionais",
};

const POLARITY_LABELS: Record<string, string> = {
  positive: "Positiva",
  negative: "Negativa",
  neutral: "Neutra",
  corrective: "Corretiva",
};

type CreateFormState = {
  name: string;
  description: string;
  domain_id: string;
  polarity: string;
  counts_as_evaluation: boolean;
  counts_as_occurrence: boolean;
  counts_as_non_conformity: boolean;
  type: string;
  target_scope: string;
  unit_id: string;
};

const EMPTY_FORM: CreateFormState = {
  name: "",
  description: "",
  domain_id: "",
  polarity: "negative",
  counts_as_evaluation: true,
  counts_as_occurrence: true,
  counts_as_non_conformity: true,
  type: "location",
  target_scope: "unit",
  unit_id: "",
};

export function FormsAnalyticsTaxonomyManager() {
  const { firebaseUser } = useAuth();
  const { units } = useDPBootstrap();
  const { toast } = useToast();

  const [kind, setKind] = useState<AnalyticsTaxonomyKind>("domains");
  const [entries, setEntries] = useState<AnalyticsTaxonomyEntry[]>([]);
  const [domains, setDomains] = useState<AnalyticsTaxonomyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM);
  const [editingEntry, setEditingEntry] = useState<AnalyticsTaxonomyEntry | null>(
    null
  );
  const [editForm, setEditForm] = useState({ name: "", description: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const supportsOrder = kind !== "targets";

  const load = useCallback(
    async (target: AnalyticsTaxonomyKind) => {
      if (!firebaseUser) return;
      setLoading(true);
      try {
        const [list, domainList] = await Promise.all([
          fetchAnalyticsTaxonomy(firebaseUser, target),
          target === "criteria"
            ? fetchAnalyticsTaxonomy(firebaseUser, "domains")
            : Promise.resolve(domains),
        ]);
        setEntries(list);
        if (target === "criteria") setDomains(domainList);
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            error instanceof Error ? error.message : "Falha ao carregar taxonomia.",
        });
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firebaseUser, toast]
  );

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  async function toggleActive(entry: AnalyticsTaxonomyEntry) {
    if (!firebaseUser) return;
    setBusyId(entry.id);
    try {
      await updateAnalyticsTaxonomyEntry(firebaseUser, kind, entry.id, {
        is_active: !entry.is_active,
      });
      await load(kind);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao atualizar.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function submitEdit() {
    if (!firebaseUser || !editingEntry) return;
    const name = editForm.name.trim();
    if (!name) return;
    setSavingEdit(true);
    try {
      await updateAnalyticsTaxonomyEntry(firebaseUser, kind, editingEntry.id, {
        name,
        ...(kind !== "results"
          ? { description: editForm.description.trim() || undefined }
          : {}),
      });
      toast({ title: "Registro atualizado." });
      setEditingEntry(null);
      await load(kind);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao atualizar.",
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function reorder(index: number, direction: -1 | 1) {
    if (!firebaseUser) return;
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= entries.length) return;
    const a = entries[index];
    const b = entries[swapIndex];
    const orderA = a.order ?? index;
    const orderB = b.order ?? swapIndex;
    setBusyId(a.id);
    try {
      await Promise.all([
        updateAnalyticsTaxonomyEntry(firebaseUser, kind, a.id, { order: orderB }),
        updateAnalyticsTaxonomyEntry(firebaseUser, kind, b.id, { order: orderA }),
      ]);
      await load(kind);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao reordenar.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function runSeed() {
    if (!firebaseUser) return;
    setSeeding(true);
    try {
      await seedAnalyticsTaxonomy(firebaseUser);
      toast({ title: "Seed de taxonomia aplicado." });
      await load(kind);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao aplicar seed.",
      });
    } finally {
      setSeeding(false);
    }
  }

  function buildCreateBody(): Record<string, unknown> | null {
    const name = form.name.trim();
    if (!name) return null;

    if (kind === "domains") {
      return {
        name,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      };
    }
    if (kind === "criteria") {
      if (!form.domain_id) return null;
      return {
        name,
        domain_id: form.domain_id,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      };
    }
    if (kind === "results") {
      return {
        name,
        polarity: form.polarity,
        counts_as_evaluation: form.counts_as_evaluation,
        counts_as_occurrence: form.counts_as_occurrence,
        counts_as_non_conformity: form.counts_as_non_conformity,
      };
    }
    // targets
    if (form.target_scope !== "workspace" && !form.unit_id) return null;
    return {
      name,
      type: form.type,
      target_scope: form.target_scope,
      ...(form.target_scope === "workspace" ? {} : { unit_ids: [form.unit_id] }),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };
  }

  async function submitCreate() {
    if (!firebaseUser) return;
    const body = buildCreateBody();
    if (!body) {
      toast({ variant: "destructive", title: "Preencha os campos obrigatórios." });
      return;
    }
    setCreating(true);
    try {
      await createAnalyticsTaxonomyEntry(firebaseUser, kind, body);
      toast({ title: "Registro criado." });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      await load(kind);
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "Falha ao criar registro.",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="h-5 w-5" />
          Classificações de Analytics
        </CardTitle>
        <CardDescription>
          Domínios, quesitos, resultados e alvos usados na geração de
          ocorrências. Registros usados em histórico só podem ser desativados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={kind} onValueChange={(value) => setKind(value as AnalyticsTaxonomyKind)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList>
              {(Object.keys(KIND_LABELS) as AnalyticsTaxonomyKind[]).map((key) => (
                <TabsTrigger key={key} value={key}>
                  {KIND_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={seeding}
                onClick={() => void runSeed()}
              >
                {seeding ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Aplicar seed padrão
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Novo
              </Button>
            </div>
          </div>

          {(Object.keys(KIND_LABELS) as AnalyticsTaxonomyKind[]).map((key) => (
            <TabsContent key={key} value={key} className="mt-4">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      {key === "criteria" ? <TableHead>Domínio</TableHead> : null}
                      {key === "results" ? (
                        <>
                          <TableHead>Polaridade</TableHead>
                          <TableHead>Contagens</TableHead>
                        </>
                      ) : null}
                      {key === "targets" ? (
                        <>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Escopo</TableHead>
                        </>
                      ) : null}
                      <TableHead>Origem</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                      <TableHead className="text-right">Ativo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Nenhum registro. Use o seed padrão para começar.
                        </TableCell>
                      </TableRow>
                    ) : (
                      entries.map((entry, index) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <span className="font-medium">{entry.name}</span>
                            {entry.description ? (
                              <span className="block text-xs text-muted-foreground">
                                {entry.description}
                              </span>
                            ) : null}
                          </TableCell>
                          {key === "criteria" ? (
                            <TableCell className="text-xs">
                              {domains.find((domain) => domain.id === entry.domain_id)
                                ?.name ?? entry.domain_id}
                            </TableCell>
                          ) : null}
                          {key === "results" ? (
                            <>
                              <TableCell className="text-xs">
                                {POLARITY_LABELS[entry.polarity ?? ""] ??
                                  entry.polarity}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {[
                                  entry.counts_as_evaluation ? "avaliação" : null,
                                  entry.counts_as_occurrence ? "ocorrência" : null,
                                  entry.counts_as_non_conformity
                                    ? "não conformidade"
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </TableCell>
                            </>
                          ) : null}
                          {key === "targets" ? (
                            <>
                              <TableCell className="text-xs">{entry.type}</TableCell>
                              <TableCell className="text-xs">
                                {entry.target_scope === "workspace"
                                  ? "Global"
                                  : (entry.unit_ids ?? [])
                                      .map(
                                        (unitId) =>
                                          units.find((unit) => unit.id === unitId)
                                            ?.name ?? unitId
                                      )
                                      .join(", ")}
                              </TableCell>
                            </>
                          ) : null}
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="w-fit">
                                {entry.source === "system_seed" ? "Seed" : "Manual"}
                              </Badge>
                              {entry.is_deletable === false ? (
                                <span className="text-[11px] text-muted-foreground">
                                  em uso
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {supportsOrder ? (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    disabled={busyId === entry.id || index === 0}
                                    onClick={() => void reorder(index, -1)}
                                  >
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    disabled={
                                      busyId === entry.id ||
                                      index === entries.length - 1
                                    }
                                    onClick={() => void reorder(index, 1)}
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : null}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={entry.is_editable === false}
                                onClick={() => {
                                  setEditingEntry(entry);
                                  setEditForm({
                                    name: entry.name,
                                    description: entry.description ?? "",
                                  });
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Switch
                              checked={entry.is_active}
                              disabled={busyId === entry.id}
                              onCheckedChange={() => void toggleActive(entry)}
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>

      <Dialog
        open={editingEntry !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEntry(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar {KIND_LABELS[kind].toLowerCase()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={editForm.name}
                onChange={(event) =>
                  setEditForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            {kind !== "results" ? (
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input
                  value={editForm.description}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Editar o nome preserva o id do registro — o histórico não quebra.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingEntry(null)}>
              Voltar
            </Button>
            <Button
              disabled={savingEdit || !editForm.name.trim()}
              onClick={() => void submitEdit()}
            >
              {savingEdit ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo em {KIND_LABELS[kind]}</DialogTitle>
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
            {kind !== "results" ? (
              <div className="space-y-2">
                <Label>Descrição (opcional)</Label>
                <Input
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
            ) : null}
            {kind === "criteria" ? (
              <div className="space-y-2">
                <Label>Domínio</Label>
                <Select
                  value={form.domain_id}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, domain_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains
                      .filter((domain) => domain.is_active)
                      .map((domain) => (
                        <SelectItem key={domain.id} value={domain.id}>
                          {domain.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {kind === "results" ? (
              <>
                <div className="space-y-2">
                  <Label>Polaridade</Label>
                  <Select
                    value={form.polarity}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        polarity: value,
                        ...(value === "positive"
                          ? {
                              counts_as_occurrence: false,
                              counts_as_non_conformity: false,
                            }
                          : {}),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(POLARITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={form.counts_as_evaluation}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          counts_as_evaluation: checked === true,
                        }))
                      }
                    />
                    Conta como avaliação (denominador)
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={form.counts_as_occurrence}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          counts_as_occurrence: checked === true,
                        }))
                      }
                    />
                    Conta como ocorrência
                  </label>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={form.counts_as_non_conformity}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          counts_as_non_conformity: checked === true,
                        }))
                      }
                    />
                    Conta como não conformidade
                  </label>
                </div>
              </>
            ) : null}
            {kind === "targets" ? (
              <>
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={form.type}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, type: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="location">Local (porta, balcão...)</SelectItem>
                      <SelectItem value="free_target">Item livre</SelectItem>
                      <SelectItem value="process">Processo</SelectItem>
                      <SelectItem value="unit_area">Área da unidade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Escopo</Label>
                  <Select
                    value={form.target_scope}
                    onValueChange={(value) =>
                      setForm((current) => ({ ...current, target_scope: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unit">Por unidade</SelectItem>
                      <SelectItem value="workspace">Global (workspace)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.target_scope !== "workspace" ? (
                  <div className="space-y-2">
                    <Label>Unidade</Label>
                    <Select
                      value={form.unit_id}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, unit_id: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeOperationalUnits(units).map((unit) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </>
            ) : null}
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
