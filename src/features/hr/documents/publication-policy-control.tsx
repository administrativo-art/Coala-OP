"use client";

import { useMemo, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { ChevronDown, Loader2, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { EMPLOYEE_DOCUMENT_CATEGORIES } from "@/lib/hr/employee-document-options";
import type { DocumentPublicationPolicy } from "@/lib/hr/employee-document-publication";

type PolicyRow = { code: string; label: string; category: string; policy: DocumentPublicationPolicy; customized: boolean };
const categoryName = new Map<string, string>(EMPLOYEE_DOCUMENT_CATEGORIES.map((category) => [category.id, category.label]));

export function PublicationPolicyControl({ firebaseUser }: { firebaseUser: FirebaseUser | null }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getIdToken = () => firebaseUser?.getIdToken() ?? Promise.resolve(null);
  const serialized = JSON.stringify(rows.map(({ code, policy }) => [code, policy]));
  const dirty = Boolean(initial) && serialized !== initial;
  const groups = useMemo(() => Object.entries(rows.reduce<Record<string, PolicyRow[]>>((result, row) => {
    (result[row.category] ??= []).push(row);
    return result;
  }, {})), [rows]);

  async function show() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedApiRequest<{ policies: PolicyRow[] }>("/api/hr/employee-documents/publication-policy", {
        getIdToken, fallbackError: "Não foi possível carregar a política de publicação.",
      });
      setRows(response.policies);
      setInitial(JSON.stringify(response.policies.map(({ code, policy }) => [code, policy])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a política de publicação.");
    } finally {
      setLoading(false);
    }
  }

  function update(code: string, patch: Partial<DocumentPublicationPolicy>) {
    setRows((current) => current.map((row) => row.code === code
      ? { ...row, policy: { ...row.policy, ...patch } }
      : row));
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const policies = Object.fromEntries(rows.map((row) => [row.code, row.policy]));
      const response = await authenticatedApiRequest<{ policies: PolicyRow[] }>("/api/hr/employee-documents/publication-policy", {
        method: "PUT", json: { policies }, getIdToken, fallbackError: "Não foi possível salvar a política de publicação.",
      });
      setRows(response.policies);
      setInitial(JSON.stringify(response.policies.map(({ code, policy }) => [code, policy])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a política de publicação.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Button size="sm" variant="outline" className="h-9 gap-2 rounded-lg text-xs" onClick={() => void show()}>
      <Settings2 className="h-4 w-4" /> Configurar publicação
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogContent className="flex max-h-[88vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Publicação na pasta do colaborador</DialogTitle>
          <DialogDescription>Defina quais tipos aparecem automaticamente na macro 02, quais dependem do DP e quais nunca podem ser publicados.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? <div className="grid min-h-56 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-ds-accent-ink" /></div> : null}
          {!loading ? <div className="space-y-5">
            {groups.map(([category, entries]) => <section key={category} className="overflow-hidden rounded-ds-card border border-ds-border">
              <h3 className="bg-ds-muted px-4 py-2 text-xs font-black uppercase tracking-wide text-ds-ink-muted">{categoryName.get(category) ?? category}</h3>
              <div className="divide-y divide-ds-border">
                {(entries ?? []).map((row) => {
                  const locked = row.code === "UNKNOWN_DOCUMENT";
                  return <div key={row.code} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_210px_210px] md:items-center">
                    <div><p className="text-sm font-black text-ds-ink">{row.label}</p><p className="font-mono text-[10px] text-ds-muted">{row.code}</p></div>
                    <label className="space-y-1"><span className="text-xs font-bold text-ds-muted">Forma de publicação</span><span className="relative block">
                      <select aria-label={`Forma de publicação de ${row.label}`} disabled={locked} value={row.policy.mode}
                        onChange={(event) => update(row.code, { mode: event.target.value as DocumentPublicationPolicy["mode"] })}
                        className="h-10 w-full appearance-none rounded-ds-btn border border-ds-border bg-ds-surface px-3 pr-11 text-sm text-ds-ink disabled:opacity-60">
                        <option value="automatic">Automática</option><option value="manual">Manual pelo DP</option><option value="never">Nunca publicar</option>
                      </select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-ds-muted" /></span></label>
                    <label className="space-y-1"><span className="text-xs font-bold text-ds-muted">Momento</span><span className="relative block">
                      <select aria-label={`Momento da publicação de ${row.label}`} disabled={locked || row.policy.mode !== "automatic"} value={row.policy.trigger}
                        onChange={(event) => update(row.code, { trigger: event.target.value as DocumentPublicationPolicy["trigger"] })}
                        className="h-10 w-full appearance-none rounded-ds-btn border border-ds-border bg-ds-surface px-3 pr-11 text-sm text-ds-ink disabled:opacity-60">
                        <option value="validated">Ao validar</option><option value="signed">Ao assinar</option>
                      </select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-ds-muted" /></span></label>
                  </div>;
                })}
              </div>
            </section>)}
          </div> : null}
        </div>
        <footer className="border-t bg-ds-surface px-5 py-3">
          {error ? <p role="alert" className="mb-2 text-xs font-semibold text-ds-danger">{error}</p> : null}
          <div className="flex items-center justify-end gap-2"><Button variant="ds-ghost" disabled={saving} onClick={() => setOpen(false)}>Fechar</Button>
            <Button disabled={!dirty || saving || loading} loading={saving} loadingLabel="Salvando…" onClick={() => void save()}>Salvar alterações</Button></div>
        </footer>
      </DialogContent>
    </Dialog>
  </>;
}
