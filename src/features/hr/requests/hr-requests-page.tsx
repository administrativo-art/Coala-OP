"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileSignature, FileText, Loader2, RefreshCw, X } from "lucide-react";

import { EmptyResults, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { ControlSearch } from "@/components/patterns/control-panel";
import { HeroChip } from "@/components/patterns/hero-chip";
import { PageHero } from "@/components/patterns/page-hero";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AbsenceWorkflowSection } from "@/features/dp/absences/requests/workflow-panel";
import { AbsencePreviewPanel } from "@/features/dp/absences/requests/preview-panel";
import { AbsenceRetentionSection } from "@/features/dp/absences/requests/retention-panel";
import { ResponsibilityTaskSection } from "@/features/dp/responsibility-coverage/task-section";
import type { AbsenceListFilters } from "@/features/dp/absences/requests/client";
import {
  fetchCollaboratorRequestSignature,
  fetchCollaboratorRequests,
  openCollaboratorRequestDocument,
  sendCollaboratorRequestForSignature,
  updateCollaboratorRequest,
} from "@/features/hr/requests/client";
import { RequestRow, RequestTrail, TermStatus, formatCurrency, formatRequestCompetence, formatRequestDate } from "@/features/hr/requests/request-ui";
import type { CollaboratorRequest, CollaboratorRequestSignature } from "@/features/hr/requests/types";
import { TRANSPORT_VOUCHER_ACTION_LABELS } from "@/features/hr/requests/types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

type Filter = "pending" | "completed" | "all";

export function HrRequestsPage() {
  const { firebaseUser, permissions, isDefaultAdmin, activeUsers } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<CollaboratorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CollaboratorRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [dailyValue, setDailyValue] = useState("");
  const [signature, setSignature] = useState<CollaboratorRequestSignature | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [absenceQueueOpen, setAbsenceQueueOpen] = useState(false);
  const [absenceTeamOpen, setAbsenceTeamOpen] = useState(false);
  const [absenceRetentionOpen, setAbsenceRetentionOpen] = useState(false);
  const [absenceCreateOpen, setAbsenceCreateOpen] = useState(false);
  const [absenceBeneficiaryUid, setAbsenceBeneficiaryUid] = useState("");
  const [absenceRefreshKey, setAbsenceRefreshKey] = useState(0);
  const [absenceTeamFilters, setAbsenceTeamFilters] = useState<AbsenceListFilters>({ status: 'in_review' });
  const canReview = isDefaultAdmin || permissions.dp?.requests?.review === true;
  const canViewAbsences = isDefaultAdmin || permissions.dp?.requests?.view === true;
  const canViewResponsibilityTasks = isDefaultAdmin || permissions.dp?.schedules?.edit === true
    || permissions.dp?.responsibilities?.manage === true
    || permissions.dp?.responsibilities?.receiveUnassignedAlerts === true;
  const eligibleBeneficiaries = activeUsers.filter((person) => person.id !== firebaseUser?.uid && ['clt', 'apprenticeship', 'internship'].includes(person.employmentRelationshipType ?? ''));
  const absenceBeneficiary = eligibleBeneficiaries.find((person) => person.id === absenceBeneficiaryUid);

  useEffect(() => {
    setAbsenceCreateOpen(false);
    setAbsenceBeneficiaryUid('');
    setAbsenceQueueOpen(false);
    setAbsenceTeamOpen(false);
    setAbsenceRetentionOpen(false);
    setAbsenceTeamFilters({ status: 'in_review' });
  }, [firebaseUser?.uid]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchCollaboratorRequests(firebaseUser, "team");
      setItems(response.requests);
      setSelected((current) => current ? response.requests.find((item) => item.id === current.id) ?? null : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar solicitações.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    setNotes(selected.review?.notes ?? "");
    setDailyValue(selected.action === "suspend"
      ? ""
      : String(selected.review?.approvedDailyValue ?? selected.currentSnapshot.dailyValue ?? ""));
  }, [selected?.id, selected]);

  useEffect(() => {
    if (!firebaseUser || !selected?.generatedDocumentId) {
      setSignature(null);
      return;
    }
    let active = true;
    setSignatureLoading(true);
    void fetchCollaboratorRequestSignature(firebaseUser, selected.id)
      .then((response) => { if (active) setSignature(response.signature); })
      .catch(() => { if (active) setSignature(null); })
      .finally(() => { if (active) setSignatureLoading(false); });
    return () => { active = false; };
  }, [firebaseUser, selected?.generatedDocumentId, selected?.id]);

  const counts = useMemo(() => ({
    pending: items.filter((item) => item.status === "pending").length,
    approved: items.filter((item) => item.status === "approved").length,
    documentPending: items.filter((item) => item.status === "approved" && item.documentStatus === "failed").length,
  }), [items]);

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => {
      if (filter === "pending" && item.status !== "pending") return false;
      if (filter === "completed" && item.status === "pending") return false;
      if (!term) return true;
      return [item.employeeName, item.details, TRANSPORT_VOUCHER_ACTION_LABELS[item.action]]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
    });
  }, [filter, items, search]);

  const runAction = async (input: Record<string, unknown>, success: string) => {
    if (!firebaseUser || !selected || busy) return;
    setBusy(true);
    try {
      const response = await updateCollaboratorRequest(firebaseUser, selected.id, input);
      toast({
        title: success,
        description: response.warnings?.length ? `Atenção: ${response.warnings.join(" ")}` : undefined,
      });
      await load();
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao atualizar solicitação." });
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async () => {
    if (!firebaseUser || !selected) return;
    setBusy(true);
    try {
      await openCollaboratorRequestDocument(firebaseUser, selected.id);
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao abrir o termo." });
    } finally {
      setBusy(false);
    }
  };

  const sendSignature = async () => {
    if (!firebaseUser || !selected || busy) return;
    setBusy(true);
    try {
      const response = await sendCollaboratorRequestForSignature(firebaseUser, selected.id);
      setSignature(response.signature);
      toast({ title: response.signature.requestId ? "Termo disponibilizado para assinatura." : "Assinatura preparada." });
      await load();
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao enviar para assinatura." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="system-standard-page space-y-5 pb-8 font-ds">
      <PageHero
        kicker="Departamento Pessoal · Gestão do colaborador"
        title="Solicitações dos colaboradores"
        subtitle="Analise pedidos, aplique benefícios e acompanhe termos sem perder a trilha."
        chips={<>
          <HeroChip value={counts.pending} label="aguardando análise" tone="warning" active={filter === "pending"} onClick={() => setFilter("pending")} />
          <HeroChip value={counts.approved} label="aprovadas" tone="info" active={filter === "completed"} onClick={() => setFilter("completed")} />
          <HeroChip value={counts.documentPending} label="termos pendentes" tone={counts.documentPending ? "danger" : "neutral"} />
          <HeroChip value={items.length} label="todas" active={filter === "all"} onClick={() => setFilter("all")} />
        </>}
      >
        <div className="flex flex-wrap gap-2"><ControlSearch value={search} onChange={setSearch} placeholder="Buscar colaborador ou solicitação" /><Button variant="on-dark-secondary" size="xl" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Atualizar</Button></div>
      </PageHero>

      <div className="flex items-baseline gap-2"><span className="text-[28px] font-extrabold">{visible.length}</span><span className="text-[13px] text-ds-ink-faint">de {items.length} solicitações</span></div>
      <ListShell minWidth={820}>
        {loading ? <ListSkeleton rows={6} /> : error ? (
          <div className="p-8 text-center"><p className="text-sm font-bold text-ds-danger">{error}</p><Button className="mt-3" variant="ds-secondary" onClick={() => void load()}>Tentar novamente</Button></div>
        ) : visible.length ? visible.map((item) => <RequestRow key={item.id} request={item} showEmployee selected={selected?.id === item.id} onOpen={() => setSelected(item)} />) : (
          <EmptyResults title="Nenhuma solicitação encontrada." onClear={() => { setSearch(""); setFilter("all"); }} />
        )}
      </ListShell>

      {canReview || canViewAbsences ? <section className="space-y-3 rounded-ds-card-lg border border-ds-border bg-ds-surface p-4">
        <h2 className="text-lg font-extrabold text-ds-ink">Ausências</h2>
        {canReview ? <div className="space-y-2"><label className="block space-y-1.5 text-xs font-bold text-ds-ink">Colaborador para novo pedido
          <Select value={absenceBeneficiaryUid} onValueChange={setAbsenceBeneficiaryUid}><SelectTrigger className="h-11 rounded-ds-btn border-ds-border-input"><SelectValue placeholder="Selecione uma pessoa" /></SelectTrigger><SelectContent>{eligibleBeneficiaries.map((person) => <SelectItem key={person.id} value={person.id}>{person.username}</SelectItem>)}</SelectContent></Select>
        </label><Button variant="primary-page" disabled={!absenceBeneficiaryUid} onClick={() => setAbsenceCreateOpen(true)}>Preparar ausência para colaborador</Button><p className="text-xs text-ds-ink-muted">A permissão e a lotação são conferidas novamente pelo servidor. O pedido começa como rascunho.</p></div> : null}
        <div className="flex flex-wrap gap-2">
          {canReview ? <Button variant="ds-secondary" onClick={() => setAbsenceQueueOpen((open) => !open)}>{absenceQueueOpen ? 'Ocultar fila de ausências' : 'Ver fila de ausências'}</Button> : null}
          {canViewAbsences ? <Button variant="ds-secondary" onClick={() => setAbsenceTeamOpen((open) => !open)}>{absenceTeamOpen ? 'Ocultar pedidos da equipe' : 'Ver pedidos da equipe'}</Button> : null}
          {canReview ? <Button variant="ds-secondary" onClick={() => setAbsenceRetentionOpen((open) => !open)}>{absenceRetentionOpen ? 'Ocultar retenção de documentos' : 'Ver retenção de documentos'}</Button> : null}
        </div>
        {absenceQueueOpen ? <AbsenceWorkflowSection firebaseUser={firebaseUser} scope="review" people={eligibleBeneficiaries} refreshKey={absenceRefreshKey} /> : null}
        {absenceTeamOpen ? <AbsenceWorkflowSection key={`team:${absenceRefreshKey}`} firebaseUser={firebaseUser} scope="team" people={eligibleBeneficiaries} refreshKey={absenceRefreshKey} initialFilters={absenceTeamFilters} /> : null}
        {absenceRetentionOpen ? <AbsenceRetentionSection firebaseUser={firebaseUser} /> : null}
        {absenceCreateOpen && absenceBeneficiary ? <AbsencePreviewPanel key={`${firebaseUser?.uid}:${absenceBeneficiaryUid}`} open onOpenChange={setAbsenceCreateOpen} firebaseUser={firebaseUser} beneficiaryUid={absenceBeneficiaryUid} beneficiaryName={absenceBeneficiary.username} onDraftCreated={(request) => { setAbsenceTeamFilters({ status: 'draft', beneficiaryUid: request.beneficiaryUid }); setAbsenceTeamOpen(true); setAbsenceRefreshKey((value) => value + 1); }} /> : null}
      </section> : null}

      {canViewResponsibilityTasks ? <ResponsibilityTaskSection firebaseUser={firebaseUser} people={activeUsers}
        canManage={isDefaultAdmin || permissions.dp?.responsibilities?.manage === true}
        canWorkSchedules={isDefaultAdmin || permissions.dp?.schedules?.edit === true}
        canReceiveGaps={isDefaultAdmin || permissions.dp?.responsibilities?.receiveUnassignedAlerts === true}
        canResolveAny={isDefaultAdmin} /> : null}

      <SidePanel
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        kicker="Solicitação do colaborador"
        title={selected?.employeeName ?? "Solicitação"}
        subtitle={selected ? `${TRANSPORT_VOUCHER_ACTION_LABELS[selected.action]} de vale-transporte · entra em vigor em ${formatRequestDate(selected.effectiveDate)}` : undefined}
      >
        {selected ? <>
          <PanelSection title="Pedido">
            <div className="grid grid-cols-2 gap-4">
              <PanelField label="Tipo">{TRANSPORT_VOUCHER_ACTION_LABELS[selected.action]}</PanelField>
              <PanelField label="Data da solicitação">{formatRequestDate(selected.requestDate)}</PanelField>
              <PanelField label="Competência">{formatRequestCompetence(selected.processingCompetence)}</PanelField>
              <PanelField label="Entra em vigor">{formatRequestDate(selected.effectiveDate)}</PanelField>
              <PanelField label="Pagamento do contracheque">{formatRequestDate(selected.payslipPaymentDate)}</PanelField>
              <PanelField label="Regra aplicada">{selected.requestedAfterCutoff ? `Após o corte do dia ${selected.cutoffDay}` : `Até o corte do dia ${selected.cutoffDay}`}</PanelField>
              <PanelField label="Benefício ao solicitar">{selected.currentSnapshot.active ? "Ativo" : "Inativo"}</PanelField>
              <PanelField label="Valor anterior">{formatCurrency(selected.currentSnapshot.dailyValue)}</PanelField>
            </div>
            <p className="rounded-ds-md border border-ds-info/20 bg-ds-info-bg p-3 text-[12px] leading-5 text-ds-info">Até o dia {selected.cutoffDay}, a alteração vale no mês seguinte. Depois do corte, vale no segundo mês seguinte. A análise do RH não muda a competência registrada no envio. O reflexo aparecerá no contracheque que será pago no dia {formatRequestDate(selected.payslipPaymentDate)}.</p>
            <p className="rounded-ds-md bg-ds-muted p-3 text-[12.5px] leading-5 text-ds-ink-muted">{selected.details || "Nenhum motivo ou detalhe adicional foi informado."}</p>
          </PanelSection>

          {selected.status === "pending" && canReview ? <PanelSection title="Análise do Departamento Pessoal">
            {selected.action !== "suspend" ? <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Valor diário aprovado<Input inputMode="decimal" value={dailyValue} onChange={(event) => setDailyValue(event.target.value.replace(/[^\d,.]/g, ""))} placeholder="0,00" className="h-11 rounded-ds-btn" /><span className="block text-[11px] font-semibold text-ds-ink-faint">O valor é definido pelo RH e será registrado no bloco de vale-transporte.</span></label> : null}
            <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Observação da análise <span className="font-semibold text-ds-ink-faint">(obrigatória para rejeitar)</span><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} className="min-h-24 rounded-ds-btn" placeholder="Registre a decisão ou eventual pendência." /></label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-ds-divider pt-3">
              <Button variant="danger-link" disabled={busy || notes.trim().length < 5} onClick={() => void runAction({ action: "reject", notes }, "Solicitação rejeitada.")}><X className="h-4 w-4" />Rejeitar</Button>
              <Button variant="primary-page" loading={busy} loadingLabel="Aprovando…" disabled={selected.action !== "suspend" && !dailyValue} onClick={() => void runAction({ action: "approve", approvedDailyValue: dailyValue, notes }, "Solicitação aprovada e benefício atualizado.")}><Check className="h-4 w-4" />Aprovar</Button>
            </div>
          </PanelSection> : null}

          {selected.review ? <PanelSection title="Decisão">
            <div className="grid grid-cols-2 gap-4"><PanelField label="Situação">{selected.status === "approved" ? "Aprovada" : selected.status === "rejected" ? "Rejeitada" : "Cancelada"}</PanelField><PanelField label="Responsável">{selected.review.reviewerName}</PanelField>{selected.review.approvedDailyValue != null ? <PanelField label="Valor diário">{formatCurrency(selected.review.approvedDailyValue)}</PanelField> : null}</div>
            {selected.review.notes ? <p className="text-[12px] leading-5 text-ds-ink-muted">{selected.review.notes}</p> : null}
          </PanelSection> : null}

          {selected.status === "approved" ? <PanelSection title="Termo e assinatura">
            {signatureLoading ? <div className="flex items-center gap-2 text-xs text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Consultando assinatura…</div> : <TermStatus request={selected} signature={signature} />}
            <div className="flex flex-wrap gap-2">
              {selected.documentStatus === "generated" ? <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void openDocument()}><FileText className="h-4 w-4" />Visualizar termo</Button> : null}
              {selected.documentStatus === "failed" && canReview ? <Button variant="ds-secondary" size="sm" loading={busy} loadingLabel="Gerando…" onClick={() => void runAction({ action: "generate_document" }, "Termo gerado.")}><RefreshCw className="h-4 w-4" />Gerar novamente</Button> : null}
              {selected.documentStatus === "generated" && !signature?.signedAt && canReview ? <Button variant="primary-page" size="sm" loading={busy} loadingLabel="Enviando…" onClick={() => void sendSignature()}><FileSignature className="h-4 w-4" />{signature?.requestId ? "Reenviar acesso" : "Enviar para assinatura"}</Button> : null}
            </div>
          </PanelSection> : null}

          <PanelSection title="Trilha do processo" aside={`${selected.trail.length} evento(s)`}><RequestTrail request={selected} signature={signature} /></PanelSection>
        </> : null}
      </SidePanel>
    </div>
  );
}
