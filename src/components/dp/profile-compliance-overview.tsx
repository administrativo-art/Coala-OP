"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Search, UserRoundX, type LucideIcon } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Row = {
  userId: string;
  employeeId: string | null;
  name: string;
  email: string;
  status: "pending" | "complete" | "overdue" | "unlinked";
  missingFields: string[];
  invalidFields: string[];
  lastConfirmedAt: string | null;
  nextReviewAt: string | null;
};

type Payload = {
  counts: { total: number; complete: number; pending: number; overdue: number; unlinked: number };
  fieldCounts: Record<string, number>;
  rows: Row[];
};

const FIELD_LABELS: Record<string, string> = {
  birth_date: "Data de nascimento",
  access_email: "E-mail de acesso",
  mobile_phone: "Celular",
  pix_key_type: "Tipo de PIX",
  pix_key: "Chave PIX",
  address_zipcode: "CEP",
  address_street: "Logradouro",
  address_number: "Número",
  address_neighborhood: "Bairro",
  address_city: "Cidade",
  address_state: "UF",
  emergency_name: "Contato de emergência",
  emergency_relation: "Vínculo do contato",
  emergency_phone: "Telefone de emergência",
  person_link: "Vínculo com o RH",
};

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusBadge(status: Row["status"]) {
  if (status === "complete") return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" variant="outline">Em dia</Badge>;
  if (status === "overdue") return <Badge className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50" variant="outline">Revisão vencida</Badge>;
  if (status === "unlinked") return <Badge className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50" variant="outline">Sem vínculo</Badge>;
  return <Badge className="border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50" variant="outline">Cadastro pendente</Badge>;
}

export function ProfileComplianceOverview() {
  const { firebaseUser } = useAuth();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/profile-compliance/overview", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Falha ao carregar o acompanhamento.");
      setPayload(next as Payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao carregar o acompanhamento.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [firebaseUser]);

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (payload?.rows ?? []).filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      return !term || `${row.name} ${row.email}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [payload?.rows, search, status]);

  const missingRanking = useMemo(() => Object.entries(payload?.fieldCounts ?? {})
    .sort((left, right) => right[1] - left[1]), [payload?.fieldCounts]);
  const summaryCards: Array<[string, number, LucideIcon, string]> = [
    ["Em dia", payload?.counts.complete ?? 0, CheckCircle2, "text-emerald-600"],
    ["Cadastro pendente", payload?.counts.pending ?? 0, Clock3, "text-violet-600"],
    ["Revisão vencida", payload?.counts.overdue ?? 0, AlertTriangle, "text-amber-600"],
    ["Sem vínculo com RH", payload?.counts.unlinked ?? 0, UserRoundX, "text-rose-600"],
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Atualização cadastral obrigatória</h3>
          <p className="text-sm text-muted-foreground">Todos os usuários ativos confirmam os dados no login e novamente a cada trimestre.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(([label, value, Icon, color]) => (
          <Card key={label}><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-black">{value}</p></div><Icon className={`h-7 w-7 ${color}`} /></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader className="space-y-4">
            <div><CardTitle>Usuários ativos</CardTitle><CardDescription>{rows.length} de {payload?.counts.total ?? 0} usuário(s)</CardDescription></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou e-mail" className="pl-9" /></div>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="all">Todos os estados</option><option value="complete">Em dia</option><option value="pending">Cadastro pendente</option><option value="overdue">Revisão vencida</option><option value="unlinked">Sem vínculo</option>
              </select>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm"><thead className="border-y bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-6 py-3">Usuário</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Pendências</th><th className="px-6 py-3">Última confirmação</th></tr></thead>
              <tbody>{rows.map((row) => { const issues = [...new Set([...row.missingFields, ...row.invalidFields])]; return <tr key={row.userId} className="border-b last:border-0"><td className="px-6 py-4"><p className="font-semibold">{row.name}</p><p className="text-xs text-muted-foreground">{row.email}</p></td><td className="px-4 py-4">{statusBadge(row.status)}</td><td className="max-w-[360px] px-4 py-4 text-xs text-muted-foreground">{issues.length ? issues.map((field) => FIELD_LABELS[field] ?? field).join(" · ") : "Nenhuma"}</td><td className="whitespace-nowrap px-6 py-4 text-muted-foreground">{dateLabel(row.lastConfirmedAt)}</td></tr>; })}</tbody>
            </table>
            {!loading && rows.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</p> : null}
          </CardContent>
        </Card>

        <Card><CardHeader><CardTitle className="text-base">Pendências por campo</CardTitle><CardDescription>A listagem não expõe o conteúdo do PIX nem outros valores pessoais.</CardDescription></CardHeader><CardContent className="space-y-3">{missingRanking.length ? missingRanking.map(([field, count]) => <div key={field} className="flex items-center justify-between gap-3 text-sm"><span>{FIELD_LABELS[field] ?? field}</span><Badge variant="secondary">{count}</Badge></div>) : <p className="text-sm text-muted-foreground">Nenhuma pendência.</p>}</CardContent></Card>
      </div>
    </div>
  );
}
