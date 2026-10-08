"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Field as FieldBlock, fieldInputClass } from "@/components/patterns/field";
import { LiftRow } from "@/components/patterns/lift-row";
import { Segmented } from "@/components/patterns/segmented";
import { SidePanel } from "@/components/patterns/side-panel";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
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

const requestTypeLabels: Record<string, string> = {
  access: "Acesso",
  correction: "Correção",
  deletion: "Exclusão",
  information: "Informação",
  consent_revocation: "Revogação",
  opposition: "Oposição",
  other: "Outro",
};

const statusLabels: Record<string, string> = {
  open: "Aberto",
  in_review: "Em análise",
  completed: "Concluído",
  rejected: "Rejeitado",
  contained: "Contido",
  resolved: "Resolvido",
  dismissed: "Descartado",
};

const incidentLabels: Record<string, string> = {
  unauthorized_access: "Acesso indevido",
  wrong_recipient: "Envio incorreto",
  account_compromise: "Conta comprometida",
  public_exposure: "Exposição pública",
  data_loss: "Perda de dados",
  other: "Outro",
};

function statusVariant(status: string): StatusPillVariant {
  if (status === "completed" || status === "resolved") return "ok";
  if (status === "rejected" || status === "dismissed") return "neutral";
  if (status === "contained" || status === "in_review") return "info";
  return "warn";
}

function dateOnly(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

const emptyRequestForm = {
  subjectName: "",
  subjectEmail: "",
  subjectType: "candidate",
  requestType: "access",
  origin: "email",
  dueAt: "",
  owner: "",
  description: "",
};

const emptyIncidentForm = {
  title: "",
  incidentType: "unauthorized_access",
  severity: "low",
  occurredAt: "",
  affectedData: "",
  affectedSubjects: "",
  estimatedSubjectsCount: "",
  owner: "",
  containmentActions: "",
};

type Kind = "requests" | "incidents";

export function PrivacyGovernancePanel() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [incidents, setIncidents] = useState<SecurityIncident[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind>("requests");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestForm, setRequestForm] = useState(emptyRequestForm);
  const [incidentForm, setIncidentForm] = useState(emptyIncidentForm);

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
        title: "Falha ao carregar governança",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(
    () => ({
      openRequests: requests.filter((item) => item.status === "open" || item.status === "in_review").length,
      closedRequests: requests.filter((item) => item.status === "completed" || item.status === "rejected").length,
      openIncidents: incidents.filter((item) => item.status === "open" || item.status === "contained").length,
      criticalIncidents: incidents.filter((item) => item.severity === "high" || item.severity === "critical").length,
    }),
    [incidents, requests]
  );

  function openForm() {
    setFormError(null);
    setFormOpen(true);
  }

  async function submit() {
    if (!firebaseUser) return;
    setFormError(null);
    setSubmitting(true);
    try {
      if (kind === "requests") {
        const payload = await createPrivacyRequest(firebaseUser, requestForm);
        setRequests((current) => [payload.request, ...current]);
        setRequestForm(emptyRequestForm);
      } else {
        const payload = await createSecurityIncident(firebaseUser, incidentForm);
        setIncidents((current) => [payload.incident, ...current]);
        setIncidentForm(emptyIncidentForm);
      }
      setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível registrar. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function closeRequest(item: PrivacyRequest) {
    if (!firebaseUser) return;
    setBusyId(item.id);
    try {
      const payload = await updatePrivacyRequest(firebaseUser, item.id, { status: "completed", owner: item.owner ?? "", response: item.response ?? "Atendimento registrado internamente." });
      setRequests((current) => current.map((entry) => (entry.id === item.id ? payload.request : entry)));
    } catch (error) {
      toast({ variant: "destructive", title: "Falha ao concluir pedido", description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setBusyId(null);
    }
  }

  async function resolveIncident(item: SecurityIncident) {
    if (!firebaseUser) return;
    setBusyId(item.id);
    try {
      const payload = await updateSecurityIncident(firebaseUser, item.id, { status: "resolved", owner: item.owner ?? "", resolutionNotes: item.resolutionNotes ?? "Resolvido internamente." });
      setIncidents((current) => current.map((entry) => (entry.id === item.id ? payload.incident : entry)));
    } catch (error) {
      toast({ variant: "destructive", title: "Falha ao resolver incidente", description: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setBusyId(null);
    }
  }

  const items = kind === "requests" ? requests : incidents;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Pedidos em aberto" value={stats.openRequests} />
        <StatTile label="Pedidos finalizados" value={stats.closedRequests} />
        <StatTile label="Incidentes abertos" value={stats.openIncidents} />
        <StatTile label="Incidentes altos" value={stats.criticalIncidents} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Kind>
          aria-label="Tipo de registro"
          value={kind}
          onChange={setKind}
          options={[
            { value: "requests", label: `Pedidos de titulares ${requests.length}` },
            { value: "incidents", label: `Incidentes internos ${incidents.length}` },
          ]}
        />
        <Button type="button" variant="primary-page" size="md" onClick={openForm}>
          + {kind === "requests" ? "Registrar pedido" : "Registrar incidente"}
        </Button>
      </div>

      <section className="rounded-ds-card-lg border border-ds-border bg-ds-warm">
        {loading && items.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ds-ink-muted" role="status">Carregando…</p>
        ) : items.length === 0 ? (
          <div className="m-4 rounded-ds-card border border-dashed border-ds-border-input px-5 py-10 text-center text-sm text-ds-ink-muted">
            {kind === "requests" ? "Nenhum pedido registrado." : "Nenhum incidente registrado."}
          </div>
        ) : kind === "requests" ? (
          requests.slice(0, 8).map((item) => (
            <LiftRow key={item.id} interactive={false} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">{item.subjectName}</p>
                <p className="text-xs text-ds-ink-muted">{requestTypeLabels[item.requestType]} · prazo {dateOnly(item.dueAt)}</p>
                <p className="mt-1.5 line-clamp-2 text-xs text-ds-ink-2">{item.description}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusPill variant={statusVariant(item.status)}>{statusLabels[item.status]}</StatusPill>
                {item.status !== "completed" && item.status !== "rejected" ? (
                  <Button type="button" variant="ds-secondary" size="xs" loading={busyId === item.id} loadingLabel="Concluindo…" onClick={() => void closeRequest(item)}>
                    Concluir pedido
                  </Button>
                ) : null}
              </div>
            </LiftRow>
          ))
        ) : (
          incidents.slice(0, 8).map((item) => (
            <LiftRow key={item.id} interactive={false} className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold">{item.title}</p>
                <p className="text-xs text-ds-ink-muted">{incidentLabels[item.incidentType]} · {dateOnly(item.detectedAt)}</p>
                <p className="mt-1.5 line-clamp-2 text-xs text-ds-ink-2">{item.affectedData}</p>
                {item.severity === "high" || item.severity === "critical" ? (
                  <p className="mt-1.5 text-xs font-extrabold text-ds-warn">Gravidade {item.severity === "critical" ? "crítica" : "alta"}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusPill variant={statusVariant(item.status)}>{statusLabels[item.status]}</StatusPill>
                {item.status !== "resolved" && item.status !== "dismissed" ? (
                  <Button type="button" variant="ds-secondary" size="xs" loading={busyId === item.id} loadingLabel="Resolvendo…" onClick={() => void resolveIncident(item)}>
                    Resolver incidente
                  </Button>
                ) : null}
              </div>
            </LiftRow>
          ))
        )}
        {items.length > 8 ? <p className="border-t border-ds-divider px-6 py-3 text-xs text-ds-ink-muted">Mostrando os 8 registros mais recentes de {items.length}.</p> : null}
      </section>

      <SidePanel
        open={formOpen}
        onOpenChange={setFormOpen}
        kicker={kind === "requests" ? "Pedido de titular" : "Incidente interno"}
        title={kind === "requests" ? "Registrar pedido" : "Registrar incidente"}
        subtitle="Fica registrado internamente e entra na auditoria."
      >
        {kind === "requests" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldBlock label="Nome" htmlFor="gov-req-name">
                <Input id="gov-req-name" className={fieldInputClass} value={requestForm.subjectName} onChange={(e) => setRequestForm((f) => ({ ...f, subjectName: e.target.value }))} />
              </FieldBlock>
              <FieldBlock label="E-mail ou contato" htmlFor="gov-req-email">
                <Input id="gov-req-email" className={fieldInputClass} value={requestForm.subjectEmail} onChange={(e) => setRequestForm((f) => ({ ...f, subjectEmail: e.target.value }))} />
              </FieldBlock>
              <FieldBlock label="Titular" htmlFor="gov-req-subject">
                <Select value={requestForm.subjectType} onValueChange={(value) => setRequestForm((f) => ({ ...f, subjectType: value }))}>
                  <SelectTrigger id="gov-req-subject" className={fieldInputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="candidate">Candidato</SelectItem>
                    <SelectItem value="employee">Colaborador</SelectItem>
                    <SelectItem value="former_employee">Ex-colaborador</SelectItem>
                    <SelectItem value="internal_user">Usuário interno</SelectItem>
                    <SelectItem value="supplier">Fornecedor</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </FieldBlock>
              <FieldBlock label="Pedido" htmlFor="gov-req-type">
                <Select value={requestForm.requestType} onValueChange={(value) => setRequestForm((f) => ({ ...f, requestType: value }))}>
                  <SelectTrigger id="gov-req-type" className={fieldInputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(requestTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldBlock>
              <FieldBlock label="Origem" htmlFor="gov-req-origin">
                <Select value={requestForm.origin} onValueChange={(value) => setRequestForm((f) => ({ ...f, origin: value }))}>
                  <SelectTrigger id="gov-req-origin" className={fieldInputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="in_person">Presencial</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="system">Sistema</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </FieldBlock>
              <FieldBlock label="Prazo" htmlFor="gov-req-due">
                <Input id="gov-req-due" type="date" className={fieldInputClass} value={requestForm.dueAt} onChange={(e) => setRequestForm((f) => ({ ...f, dueAt: e.target.value }))} />
              </FieldBlock>
            </div>
            <FieldBlock label="Responsável" htmlFor="gov-req-owner">
              <Input id="gov-req-owner" className={fieldInputClass} value={requestForm.owner} onChange={(e) => setRequestForm((f) => ({ ...f, owner: e.target.value }))} />
            </FieldBlock>
            <FieldBlock label="Descrição" htmlFor="gov-req-description">
              <Textarea id="gov-req-description" rows={4} className={`${fieldInputClass} h-auto py-2.5`} value={requestForm.description} onChange={(e) => setRequestForm((f) => ({ ...f, description: e.target.value }))} />
            </FieldBlock>
          </>
        ) : (
          <>
            <FieldBlock label="Título" htmlFor="gov-inc-title">
              <Input id="gov-inc-title" className={fieldInputClass} value={incidentForm.title} onChange={(e) => setIncidentForm((f) => ({ ...f, title: e.target.value }))} />
            </FieldBlock>
            <div className="grid gap-3 sm:grid-cols-3">
              <FieldBlock label="Tipo" htmlFor="gov-inc-type">
                <Select value={incidentForm.incidentType} onValueChange={(value) => setIncidentForm((f) => ({ ...f, incidentType: value }))}>
                  <SelectTrigger id="gov-inc-type" className={fieldInputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(incidentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldBlock>
              <FieldBlock label="Gravidade" htmlFor="gov-inc-severity">
                <Select value={incidentForm.severity} onValueChange={(value) => setIncidentForm((f) => ({ ...f, severity: value }))}>
                  <SelectTrigger id="gov-inc-severity" className={fieldInputClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Baixa</SelectItem>
                    <SelectItem value="medium">Média</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </FieldBlock>
              <FieldBlock label="Ocorrido em" htmlFor="gov-inc-date">
                <Input id="gov-inc-date" type="date" className={fieldInputClass} value={incidentForm.occurredAt} onChange={(e) => setIncidentForm((f) => ({ ...f, occurredAt: e.target.value }))} />
              </FieldBlock>
            </div>
            <FieldBlock label="Dados afetados" htmlFor="gov-inc-data">
              <Textarea id="gov-inc-data" rows={3} className={`${fieldInputClass} h-auto py-2.5`} value={incidentForm.affectedData} onChange={(e) => setIncidentForm((f) => ({ ...f, affectedData: e.target.value }))} />
            </FieldBlock>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldBlock label="Titulares afetados" htmlFor="gov-inc-subjects">
                <Input id="gov-inc-subjects" className={fieldInputClass} value={incidentForm.affectedSubjects} onChange={(e) => setIncidentForm((f) => ({ ...f, affectedSubjects: e.target.value }))} />
              </FieldBlock>
              <FieldBlock label="Quantidade estimada" htmlFor="gov-inc-count">
                <Input id="gov-inc-count" type="number" className={fieldInputClass} value={incidentForm.estimatedSubjectsCount} onChange={(e) => setIncidentForm((f) => ({ ...f, estimatedSubjectsCount: e.target.value }))} />
              </FieldBlock>
            </div>
            <FieldBlock label="Medidas tomadas" htmlFor="gov-inc-actions">
              <Textarea id="gov-inc-actions" rows={3} className={`${fieldInputClass} h-auto py-2.5`} value={incidentForm.containmentActions} onChange={(e) => setIncidentForm((f) => ({ ...f, containmentActions: e.target.value }))} />
            </FieldBlock>
            <FieldBlock label="Responsável" htmlFor="gov-inc-owner">
              <Input id="gov-inc-owner" className={fieldInputClass} value={incidentForm.owner} onChange={(e) => setIncidentForm((f) => ({ ...f, owner: e.target.value }))} />
            </FieldBlock>
          </>
        )}

        {formError ? (
          <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{formError}</p>
        ) : null}
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
          <Button type="button" variant="ds-secondary" size="md" disabled={submitting} onClick={() => setFormOpen(false)}>Cancelar</Button>
          <Button type="button" variant="primary-modal" size="md" loading={submitting} onClick={() => void submit()}>
            {kind === "requests" ? "Registrar pedido" : "Registrar incidente"}
          </Button>
        </div>
      </SidePanel>
    </div>
  );
}
