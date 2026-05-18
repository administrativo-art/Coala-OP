"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, ShieldAlert } from "lucide-react";

import {
  createPrivacyRequest,
  createSecurityIncident,
  fetchPrivacyRequests,
  fetchSecurityIncidents,
  updatePrivacyRequest,
  updateSecurityIncident,
} from "@/features/privacy/client";
import type { PrivacyRequest, SecurityIncident } from "@/features/privacy/types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const requestTypeLabels: Record<string, string> = {
  access: "Acesso",
  correction: "Correcao",
  deletion: "Exclusao",
  information: "Informacao",
  consent_revocation: "Revogacao",
  opposition: "Oposicao",
  other: "Outro",
};

const statusLabels: Record<string, string> = {
  open: "Aberto",
  in_review: "Em analise",
  completed: "Concluido",
  rejected: "Rejeitado",
  contained: "Contido",
  resolved: "Resolvido",
  dismissed: "Descartado",
};

const incidentLabels: Record<string, string> = {
  unauthorized_access: "Acesso indevido",
  wrong_recipient: "Envio incorreto",
  account_compromise: "Conta comprometida",
  public_exposure: "Exposicao publica",
  data_loss: "Perda de dados",
  other: "Outro",
};

function statusTone(status: string) {
  if (status === "completed" || status === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected" || status === "dismissed") return "border-slate-200 bg-slate-50 text-slate-600";
  if (status === "contained" || status === "in_review") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function dateOnly(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

export function PrivacyGovernancePanel() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestForm, setRequestForm] = useState({
    subjectName: "",
    subjectEmail: "",
    subjectType: "candidate",
    requestType: "access",
    origin: "email",
    dueAt: "",
    owner: "",
    description: "",
  });
  const [incidentForm, setIncidentForm] = useState({
    title: "",
    incidentType: "unauthorized_access",
    severity: "low",
    occurredAt: "",
    affectedData: "",
    affectedSubjects: "",
    estimatedSubjectsCount: "",
    owner: "",
    containmentActions: "",
  });

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const [requestPayload, incidentPayload] = await Promise.all([
        fetchPrivacyRequests(firebaseUser),
        fetchSecurityIncidents(firebaseUser),
      ]);
      setRequests(requestPayload.requests);
      setIncidents(incidentPayload.incidents);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao carregar governanca",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    return {
      openRequests: requests.filter((item) => item.status === "open" || item.status === "in_review").length,
      closedRequests: requests.filter((item) => item.status === "completed" || item.status === "rejected").length,
      openIncidents: incidents.filter((item) => item.status === "open" || item.status === "contained").length,
      criticalIncidents: incidents.filter((item) => item.severity === "high" || item.severity === "critical").length,
    };
  }, [incidents, requests]);

  async function submitRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseUser) return;
    try {
      const payload = await createPrivacyRequest(firebaseUser, requestForm);
      setRequests((current) => [payload.request, ...current]);
      setRequestForm({ subjectName: "", subjectEmail: "", subjectType: "candidate", requestType: "access", origin: "email", dueAt: "", owner: "", description: "" });
      toast({ title: "Pedido LGPD registrado." });
    } catch (error) {
      toast({ variant: "destructive", title: "Falha ao registrar pedido", description: error instanceof Error ? error.message : "Tente novamente." });
    }
  }

  async function submitIncident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firebaseUser) return;
    try {
      const payload = await createSecurityIncident(firebaseUser, incidentForm);
      setIncidents((current) => [payload.incident, ...current]);
      setIncidentForm({ title: "", incidentType: "unauthorized_access", severity: "low", occurredAt: "", affectedData: "", affectedSubjects: "", estimatedSubjectsCount: "", owner: "", containmentActions: "" });
      toast({ title: "Incidente registrado." });
    } catch (error) {
      toast({ variant: "destructive", title: "Falha ao registrar incidente", description: error instanceof Error ? error.message : "Tente novamente." });
    }
  }

  async function closeRequest(item: PrivacyRequest) {
    if (!firebaseUser) return;
    const payload = await updatePrivacyRequest(firebaseUser, item.id, { status: "completed", owner: item.owner ?? "", response: item.response ?? "Atendimento registrado internamente." });
    setRequests((current) => current.map((entry) => (entry.id === item.id ? payload.request : entry)));
  }

  async function resolveIncident(item: SecurityIncident) {
    if (!firebaseUser) return;
    const payload = await updateSecurityIncident(firebaseUser, item.id, { status: "resolved", owner: item.owner ?? "", resolutionNotes: item.resolutionNotes ?? "Resolvido internamente." });
    setIncidents((current) => current.map((entry) => (entry.id === item.id ? payload.incident : entry)));
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["Pedidos em aberto", stats.openRequests],
          ["Pedidos finalizados", stats.closedRequests],
          ["Incidentes abertos", stats.openIncidents],
          ["Incidentes altos", stats.criticalIncidents],
        ].map(([label, value]) => (
          <Card key={String(label)} className="rounded-2xl border-slate-200 p-4">
            <p className="text-[11px] font-black uppercase text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{String(value)}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 p-5">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-pink-500" />
            <h3 className="text-lg font-black text-slate-950">Pedidos de titulares</h3>
          </div>
          <form onSubmit={submitRequest} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Nome"><Input value={requestForm.subjectName} onChange={(e) => setRequestForm((f) => ({ ...f, subjectName: e.target.value }))} /></Field>
              <Field label="E-mail/contato"><Input value={requestForm.subjectEmail} onChange={(e) => setRequestForm((f) => ({ ...f, subjectEmail: e.target.value }))} /></Field>
              <Field label="Titular">
                <Select value={requestForm.subjectType} onValueChange={(value) => setRequestForm((f) => ({ ...f, subjectType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="candidate">Candidato</SelectItem>
                    <SelectItem value="employee">Colaborador</SelectItem>
                    <SelectItem value="former_employee">Ex-colaborador</SelectItem>
                    <SelectItem value="internal_user">Usuario interno</SelectItem>
                    <SelectItem value="supplier">Fornecedor</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Pedido">
                <Select value={requestForm.requestType} onValueChange={(value) => setRequestForm((f) => ({ ...f, requestType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(requestTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Origem">
                <Select value={requestForm.origin} onValueChange={(value) => setRequestForm((f) => ({ ...f, origin: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="in_person">Presencial</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="system">Sistema</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Prazo"><Input type="date" value={requestForm.dueAt} onChange={(e) => setRequestForm((f) => ({ ...f, dueAt: e.target.value }))} /></Field>
            </div>
            <Field label="Responsavel"><Input value={requestForm.owner} onChange={(e) => setRequestForm((f) => ({ ...f, owner: e.target.value }))} /></Field>
            <Field label="Descricao"><Textarea value={requestForm.description} onChange={(e) => setRequestForm((f) => ({ ...f, description: e.target.value }))} /></Field>
            <Button type="submit" className="rounded-xl bg-pink-500 text-white hover:bg-pink-600">Registrar pedido</Button>
          </form>
        </Card>

        <Card className="rounded-2xl border-slate-200 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-pink-500" />
            <h3 className="text-lg font-black text-slate-950">Incidentes internos</h3>
          </div>
          <form onSubmit={submitIncident} className="space-y-3">
            <Field label="Titulo"><Input value={incidentForm.title} onChange={(e) => setIncidentForm((f) => ({ ...f, title: e.target.value }))} /></Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Tipo">
                <Select value={incidentForm.incidentType} onValueChange={(value) => setIncidentForm((f) => ({ ...f, incidentType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(incidentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Gravidade">
                <Select value={incidentForm.severity} onValueChange={(value) => setIncidentForm((f) => ({ ...f, severity: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="critical">Critica</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Ocorrido em"><Input type="date" value={incidentForm.occurredAt} onChange={(e) => setIncidentForm((f) => ({ ...f, occurredAt: e.target.value }))} /></Field>
            </div>
            <Field label="Dados afetados"><Textarea value={incidentForm.affectedData} onChange={(e) => setIncidentForm((f) => ({ ...f, affectedData: e.target.value }))} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Titulares afetados"><Input value={incidentForm.affectedSubjects} onChange={(e) => setIncidentForm((f) => ({ ...f, affectedSubjects: e.target.value }))} /></Field>
              <Field label="Quantidade estimada"><Input type="number" value={incidentForm.estimatedSubjectsCount} onChange={(e) => setIncidentForm((f) => ({ ...f, estimatedSubjectsCount: e.target.value }))} /></Field>
            </div>
            <Field label="Medidas tomadas"><Textarea value={incidentForm.containmentActions} onChange={(e) => setIncidentForm((f) => ({ ...f, containmentActions: e.target.value }))} /></Field>
            <Field label="Responsavel"><Input value={incidentForm.owner} onChange={(e) => setIncidentForm((f) => ({ ...f, owner: e.target.value }))} /></Field>
            <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800">Registrar incidente</Button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ListCard title="Pedidos recentes" empty="Nenhum pedido registrado." loading={loading}>
          {requests.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-950">{item.subjectName}</p>
                  <p className="text-xs font-semibold text-slate-500">{requestTypeLabels[item.requestType]} · prazo {dateOnly(item.dueAt)}</p>
                </div>
                <Badge variant="outline" className={statusTone(item.status)}>{statusLabels[item.status]}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-600">{item.description}</p>
              {item.status !== "completed" && item.status !== "rejected" ? (
                <Button type="button" size="sm" variant="outline" className="mt-3 h-8 rounded-lg" onClick={() => void closeRequest(item)}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Concluir
                </Button>
              ) : null}
            </div>
          ))}
        </ListCard>

        <ListCard title="Incidentes recentes" empty="Nenhum incidente registrado." loading={loading}>
          {incidents.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-950">{item.title}</p>
                  <p className="text-xs font-semibold text-slate-500">{incidentLabels[item.incidentType]} · {dateOnly(item.detectedAt)}</p>
                </div>
                <Badge variant="outline" className={statusTone(item.status)}>{statusLabels[item.status]}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-slate-600">{item.affectedData}</p>
              {(item.severity === "high" || item.severity === "critical") && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-black text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Gravidade {item.severity === "critical" ? "critica" : "alta"}
                </p>
              )}
              {item.status !== "resolved" && item.status !== "dismissed" ? (
                <Button type="button" size="sm" variant="outline" className="mt-3 h-8 rounded-lg" onClick={() => void resolveIncident(item)}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Resolver
                </Button>
              ) : null}
            </div>
          ))}
        </ListCard>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-black text-slate-600">{label}</Label>
      {children}
    </div>
  );
}

function ListCard({ title, empty, loading, children }: { title: string; empty: string; loading: boolean; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <Card className="rounded-2xl border-slate-200 p-5">
      <h3 className="mb-4 text-lg font-black text-slate-950">{title}</h3>
      <div className="space-y-3">
        {loading && !hasChildren ? <p className="text-sm font-semibold text-slate-500">Carregando...</p> : null}
        {!loading && !hasChildren ? <p className="text-sm font-semibold text-slate-500">{empty}</p> : children}
      </div>
    </Card>
  );
}

