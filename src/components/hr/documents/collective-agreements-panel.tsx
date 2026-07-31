"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Archive, BookOpenCheck, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";

type Agreement = {
  id: string;
  unitId: string;
  unitName: string;
  registryNumber: string;
  validFrom: string;
  validUntil: string;
  employeeUnion: string;
  employerUnion: string;
  status: "active" | "archived";
};

type Unit = { id: string; name: string; address?: string | null };

const EMPTY_FORM = {
  unitId: "",
  registryNumber: "",
  validFrom: "",
  validUntil: "",
  employeeUnion: "",
  employerUnion: "",
  notes: "",
};

function dateLabel(value: string) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function CollectiveAgreementsPanel({ canManage }: { canManage: boolean }) {
  const { firebaseUser } = useAuth();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const response = await fetch("/api/documents/collective-agreements", {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar as CCTs.");
      setAgreements(payload.agreements ?? []);
      setUnits(payload.units ?? []);
      setMessage(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar as CCTs.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!firebaseUser) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/documents/collective-agreements", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao cadastrar a CCT.");
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao cadastrar a CCT.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(agreement: Agreement) {
    if (!firebaseUser || !window.confirm(`Arquivar a CCT ${agreement.registryNumber} de ${agreement.unitName}?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/documents/collective-agreements/${agreement.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "archived" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao arquivar a CCT.");
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao arquivar a CCT.");
    } finally {
      setSaving(false);
    }
  }

  const activeAgreements = agreements.filter((agreement) => agreement.status !== "archived");

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
              <BookOpenCheck className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-black text-slate-900">Fonte automática · Convenção coletiva</h2>
              <p className="text-xs text-slate-500">
                Registro, sindicatos e vigência são resolvidos pela unidade e pela data de admissão.
              </p>
            </div>
          </div>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              Cadastrar vigência
            </Button>
          ) : null}
        </div>
        {message ? <p className="border-b bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700">{message}</p> : null}
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-5 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Carregando convenções…
          </div>
        ) : activeAgreements.length ? (
          <div className="divide-y">
            {activeAgreements.map((agreement) => (
              <div key={agreement.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.1fr_1fr_1fr_auto] md:items-center">
                <div>
                  <p className="font-bold text-slate-900">{agreement.unitName}</p>
                  <p className="text-xs text-slate-500">MTE {agreement.registryNumber}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Vigência</p>
                  <p className="font-medium text-slate-700">{dateLabel(agreement.validFrom)} a {dateLabel(agreement.validUntil)}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-600">{agreement.employeeUnion}</p>
                  <p className="truncate text-xs text-slate-600">{agreement.employerUnion}</p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="text-slate-400 hover:text-rose-700"
                    disabled={saving}
                    onClick={() => void archive(agreement)}
                    title="Arquivar esta vigência"
                  >
                    <Archive className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-5 text-sm text-amber-700">
            Nenhuma CCT ativa cadastrada. A geração de contratos que dependem desses dados será bloqueada.
          </p>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Cadastrar vigência da CCT</DialogTitle>
            <DialogDescription>
              O registro será imutável depois de usado. Para corrigir, arquive e crie uma nova vigência.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cct-unit">Unidade *</Label>
              <select
                id="cct-unit"
                value={form.unitId}
                onChange={(event) => setForm((current) => ({ ...current, unitId: event.target.value }))}
                required
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Selecione a unidade…</option>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cct-registry">Registro no MTE *</Label>
              <Input
                id="cct-registry"
                value={form.registryNumber}
                onChange={(event) => setForm((current) => ({ ...current, registryNumber: event.target.value }))}
                placeholder="Ex.: PA000123/2026"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cct-from">Início *</Label>
                <Input id="cct-from" type="date" value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cct-until">Fim *</Label>
                <Input id="cct-until" type="date" value={form.validUntil} onChange={(event) => setForm((current) => ({ ...current, validUntil: event.target.value }))} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cct-employee-union">Sindicato profissional *</Label>
              <Input id="cct-employee-union" value={form.employeeUnion} onChange={(event) => setForm((current) => ({ ...current, employeeUnion: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cct-employer-union">Sindicato patronal *</Label>
              <Input id="cct-employer-union" value={form.employerUnion} onChange={(event) => setForm((current) => ({ ...current, employerUnion: event.target.value }))} required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cct-notes">Observações internas</Label>
              <Textarea id="cct-notes" rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving} className="bg-violet-700 hover:bg-violet-800">
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Salvar vigência
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
