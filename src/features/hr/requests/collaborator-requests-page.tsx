"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, FileSignature, FileText, Inbox, Loader2, Plus, Send, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { EmptyResults, ListShell, ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { HeroChip } from "@/components/patterns/hero-chip";
import { PageHero } from "@/components/patterns/page-hero";
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AbsencePreviewPanel } from "@/features/dp/absences/requests/preview-panel";
import { AbsenceWorkflowSection } from "@/features/dp/absences/requests/workflow-panel";
import { ShiftSwapRequestsSection } from "@/features/dp/shift-swaps/shift-swap-requests-section";
import {
  createCollaboratorRequest,
  fetchCollaboratorRequestSignature,
  fetchCollaboratorRequests,
  openCollaboratorRequestDocument,
  sendCollaboratorRequestForSignature,
  updateCollaboratorRequest,
} from "@/features/hr/requests/client";
import { calculateTransportVoucherEffect, todayInBelem } from "@/features/hr/requests/core";
import { RequestRow, RequestTrail, TermStatus, formatCurrency, formatRequestCompetence, formatRequestDate } from "@/features/hr/requests/request-ui";
import { createTransportVoucherSuspensionSimulation, TRANSPORT_VOUCHER_SUSPENSION_SIMULATION } from "@/features/hr/requests/simulation";
import type { CollaboratorRequest, CollaboratorRequestSignature, TransportVoucherRequestAction } from "@/features/hr/requests/types";
import { TRANSPORT_VOUCHER_ACTION_LABELS } from "@/features/hr/requests/types";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

const EMPTY_SIGNATURE: CollaboratorRequestSignature = {
  status: null,
  requestId: null,
  signingUrl: null,
  sentAt: null,
  signedAt: null,
};

export function CollaboratorRequestsPage() {
  const { firebaseUser, user } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const initialRequestHandled = useRef(false);
  const [items, setItems] = useState<CollaboratorRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CollaboratorRequest | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [absencePreviewOpen, setAbsencePreviewOpen] = useState(false);
  const [absenceRefreshKey, setAbsenceRefreshKey] = useState(0);
  const [absenceListOpen, setAbsenceListOpen] = useState(false);
  const [shiftSwapOpenSignal, setShiftSwapOpenSignal] = useState(0);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signature, setSignature] = useState<CollaboratorRequestSignature | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [form, setForm] = useState<{ action: TransportVoucherRequestAction; details: string }>({
    action: "activate",
    details: "",
  });

  const benefitActive = user?.needsTransportVoucher === true;
  const wasConfigured = Boolean(user?.transportVoucherHistory?.length);
  const pending = items.find((item) => item.status === "pending") ?? null;
  const effectPreview = calculateTransportVoucherEffect(todayInBelem());
  const simulationMode = process.env.NODE_ENV !== "production"
    && searchParams.get("simulation") === TRANSPORT_VOUCHER_SUSPENSION_SIMULATION;
  const selectedIsSimulation = selected?.id.startsWith("simulation:") === true;
  const simulationSignature = selectedIsSimulation
    ? createTransportVoucherSuspensionSimulation(selected?.employeeName).signature
    : null;
  const visibleSignature = simulationSignature ?? signature;
  const visibleSignatureLoading = selectedIsSimulation ? false : signatureLoading;
  const detailsLength = form.details.trim().length;
  const detailsInvalid = detailsLength > 0 && detailsLength < 10;

  const load = useCallback(async () => {
    if (simulationMode) {
      const simulation = createTransportVoucherSuspensionSimulation(user?.username ?? firebaseUser?.displayName ?? "Colaborador de demonstração");
      setItems([simulation.request]);
      setSelected(simulation.request);
      setError(null);
      setLoading(false);
      return;
    }
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchCollaboratorRequests(firebaseUser, "own");
      setItems(response.requests);
      setSelected((current) => current ? response.requests.find((item) => item.id === current.id) ?? null : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar solicitações.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, simulationMode, user?.username]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selectedIsSimulation) {
      return;
    }
    if (!firebaseUser || !selected?.generatedDocumentId) {
      setSignature(null);
      return;
    }
    let active = true;
    setSignatureLoading(true);
    void fetchCollaboratorRequestSignature(firebaseUser, selected.id)
      .then((response) => { if (active) setSignature(response.signature); })
      .catch(() => { if (active) setSignature(EMPTY_SIGNATURE); })
      .finally(() => { if (active) setSignatureLoading(false); });
    return () => { active = false; };
  }, [firebaseUser, selected?.generatedDocumentId, selected?.id, selectedIsSimulation]);

  const openCreate = useCallback(() => {
    if (pending) {
      setSelected(pending);
      toast({ title: "Já existe uma solicitação aguardando análise." });
      return;
    }
    setForm({
      action: benefitActive ? "change" : wasConfigured ? "reactivate" : "activate",
      details: "",
    });
    setCreating(true);
  }, [benefitActive, pending, toast, wasConfigured]);

  const openCatalog = () => {
    setCatalogOpen(true);
  };

  useEffect(() => {
    if (!firebaseUser || initialRequestHandled.current) return;
    const requested = searchParams.get("new");
    if (requested === "absence_preview") {
      initialRequestHandled.current = true;
      setAbsencePreviewOpen(true);
      return;
    }
    if (loading || requested !== "transport_voucher") return;
    initialRequestHandled.current = true;
    openCreate();
  }, [firebaseUser, loading, openCreate, searchParams]);

  const submit = async () => {
    if (!firebaseUser || busy) return;
    setBusy(true);
    try {
      const response = await createCollaboratorRequest(firebaseUser, form);
      setItems((current) => [response.request, ...current]);
      setCreating(false);
      setSelected(response.request);
      toast({ title: "Solicitação enviada ao Departamento Pessoal." });
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao enviar solicitação." });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!firebaseUser || !selected || busy) return;
    setBusy(true);
    try {
      await updateCollaboratorRequest(firebaseUser, selected.id, { action: "cancel" });
      toast({ title: "Solicitação cancelada." });
      await load();
    } catch (cause) {
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao cancelar solicitação." });
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

  const sign = async () => {
    if (!firebaseUser || !selected || busy) return;
    if (signature?.signingUrl) {
      window.open(signature.signingUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const signingWindow = window.open("", "_blank");
    setBusy(true);
    try {
      const response = await sendCollaboratorRequestForSignature(firebaseUser, selected.id);
      setSignature(response.signature);
      if (response.signature.signingUrl) {
        if (signingWindow) signingWindow.location.href = response.signature.signingUrl;
        else window.open(response.signature.signingUrl, "_blank", "noopener,noreferrer");
      } else {
        signingWindow?.close();
        toast({ title: "Convite de assinatura enviado", description: "Confira o e-mail cadastrado para acessar a assinatura." });
      }
      await load();
    } catch (cause) {
      signingWindow?.close();
      toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Falha ao disponibilizar assinatura." });
    } finally {
      setBusy(false);
    }
  };

  const openTemplatePreview = (templateId: string) => {
    const kind = templateId.includes("reactivation")
      ? "reactivation"
      : templateId.includes("waiver")
        ? "suspension"
        : "adhesion";
    window.open(`/api/dev/transport-voucher-templates/${kind}`, "_blank", "noopener,noreferrer");
  };

  const approvedCount = useMemo(() => items.filter((item) => item.status === "approved").length, [items]);

  return (
    <div className="system-standard-page space-y-5 pb-8 font-ds">
      <PageHero
        kicker="Painel do colaborador · Acessos rápidos"
        title="Minhas solicitações"
        subtitle="Acompanhe pedidos, análises, termos e assinaturas em um só lugar."
        actions={<Button variant="primary-page" size="xl" onClick={openCatalog}><Plus className="h-4 w-4" />Nova solicitação</Button>}
        chips={<><HeroChip value={pending ? 1 : 0} label="aguardando análise" tone="warning" /><HeroChip value={approvedCount} label="aprovadas" tone="info" /><HeroChip value={items.length} label="no histórico" /></>}
      />

      <div className="rounded-ds-card border border-ds-info/20 bg-ds-info-bg px-4 py-3 text-[13px] text-ds-info">
        <strong>Vale-transporte, ausência e troca de turno.</strong> A troca só altera a escala depois do aceite autenticado da outra pessoa.
      </div>
      {simulationMode ? <div className="rounded-ds-card border border-ds-warn/20 bg-ds-warn-bg px-4 py-3 text-[13px] text-ds-warn"><strong>Simulação local.</strong> Este pedido não foi gravado e nenhuma ação altera o cadastro do colaborador.</div> : null}

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Histórico</p><h2 className="mt-1 text-lg font-extrabold text-ds-ink">Solicitações enviadas</h2></div>
          <span className="text-xs font-semibold text-ds-ink-faint">{items.length} registro(s)</span>
        </div>
        <ListShell minWidth={720}>
          {loading ? <ListSkeleton rows={4} /> : error ? (
            <div className="p-8 text-center"><p className="text-sm font-bold text-ds-danger">{error}</p><Button className="mt-3" variant="ds-secondary" size="sm" onClick={() => void load()}>Tentar novamente</Button></div>
          ) : items.length ? items.map((item) => <RequestRow key={item.id} request={item} selected={selected?.id === item.id} onOpen={() => setSelected(item)} />) : (
            <EmptyResults title="Você ainda não enviou solicitações." onClear={openCatalog} />
          )}
        </ListShell>
      </section>

      {!simulationMode ? <div className="space-y-3"><Button variant="ds-secondary" onClick={() => setAbsenceListOpen((open) => !open)}>{absenceListOpen ? 'Ocultar pedidos de ausência' : 'Ver pedidos de ausência'}</Button>{absenceListOpen ? <AbsenceWorkflowSection firebaseUser={firebaseUser} scope="mine" refreshKey={absenceRefreshKey} /> : null}</div> : null}
      {!simulationMode ? <ShiftSwapRequestsSection firebaseUser={firebaseUser} openCreateSignal={shiftSwapOpenSignal} /> : null}

      <SidePanel open={catalogOpen} onOpenChange={setCatalogOpen} kicker="Nova solicitação" title="O que você precisa solicitar?" subtitle="Escolha um tipo para iniciar ou calcular uma prévia.">
        <button
          type="button"
          onClick={() => { setCatalogOpen(false); openCreate(); }}
          className="group flex w-full items-center gap-4 rounded-ds-card-lg border border-ds-border bg-ds-surface p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-ds-accent hover:shadow-ds-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ds-card bg-ds-warn-bg text-ds-warn"><Inbox className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-ds-ink">Vale-transporte</span><span className="mt-0.5 block text-xs leading-5 text-ds-ink-muted">Adesão, alteração, suspensão ou reativação.</span></span>
          <span className="text-ds-ink-faint transition-transform group-hover:translate-x-0.5">›</span>
        </button>
        <button type="button" onClick={() => { setCatalogOpen(false); setAbsencePreviewOpen(true); }} className="group flex w-full items-center gap-4 rounded-ds-card-lg border border-ds-border bg-ds-surface p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-ds-accent hover:shadow-ds-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ds-card bg-ds-info-bg text-ds-info"><Inbox className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-ds-ink">Prévia de ausência</span><span className="mt-0.5 block text-xs leading-5 text-ds-ink-muted">Confira datas e regra. Salve um rascunho se disponível.</span></span>
          <span className="text-ds-ink-faint transition-transform group-hover:translate-x-0.5">›</span>
        </button>
        <button type="button" onClick={() => { setCatalogOpen(false); setShiftSwapOpenSignal((value) => value + 1); }} className="group flex w-full items-center gap-4 rounded-ds-card-lg border border-ds-border bg-ds-surface p-4 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-ds-accent hover:shadow-ds-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ds-card bg-ds-ok-bg text-ds-ok"><ArrowLeftRight className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-ds-ink">Troca de turno</span><span className="mt-0.5 block text-xs leading-5 text-ds-ink-muted">Troque com outra pessoa da mesma unidade e data, mediante aceite.</span></span>
          <span className="text-ds-ink-faint transition-transform group-hover:translate-x-0.5">›</span>
        </button>
      </SidePanel>

      {absencePreviewOpen ? <AbsencePreviewPanel key={firebaseUser?.uid ?? 'anonymous'} open onOpenChange={setAbsencePreviewOpen} firebaseUser={firebaseUser} onDraftCreated={() => { setAbsenceListOpen(true); setAbsenceRefreshKey((value) => value + 1); }} /> : null}

      <SidePanel open={creating} onOpenChange={setCreating} kicker="Nova solicitação" title="Vale-transporte" subtitle="Escolha o tipo e, se necessário, acrescente detalhes para a análise do Departamento Pessoal.">
        <PanelSection title="Benefício atual">
          <div className="grid grid-cols-2 gap-4">
            <PanelField label="Situação">{benefitActive ? "Ativo" : wasConfigured ? "Suspenso" : "Não configurado"}</PanelField>
            <PanelField label="Valor diário">{formatCurrency(typeof user?.transportVoucherValue === "number" ? user.transportVoucherValue : null)}</PanelField>
          </div>
        </PanelSection>
        <PanelSection title="Pedido">
          <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">
            Tipo de solicitação
            <Select value={form.action} onValueChange={(value) => setForm((current) => ({ ...current, action: value as TransportVoucherRequestAction }))}>
              <SelectTrigger className="h-11 rounded-ds-btn border-ds-border-input bg-ds-surface"><SelectValue /></SelectTrigger>
              <SelectContent>
                {benefitActive ? <>
                  <SelectItem value="change">Alterar benefício</SelectItem>
                  <SelectItem value="suspend">Suspender benefício</SelectItem>
                </> : <SelectItem value={wasConfigured ? "reactivate" : "activate"}>{wasConfigured ? "Reativar benefício" : "Aderir ao benefício"}</SelectItem>}
              </SelectContent>
            </Select>
          </label>
          <div className="rounded-ds-card border border-ds-info/20 bg-ds-info-bg p-4 text-ds-info">
            <p className="text-[12px] font-extrabold">Quando esta solicitação entrará em vigor?</p>
            <p className="mt-1 text-[12px] leading-5">Solicitações feitas até o dia 20 entram em vigor no primeiro dia do mês seguinte. Após o dia 20, entram em vigor no primeiro dia do segundo mês seguinte.</p>
            <div className="mt-3 rounded-ds-md bg-ds-surface/80 px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ds-info">Solicitando hoje</p>
              <p className="mt-0.5 text-sm font-extrabold text-ds-ink">Vigência em {formatRequestDate(effectPreview.effectiveDate)}</p>
              <p className="text-[11.5px] font-semibold text-ds-ink-muted">Competência {formatRequestCompetence(effectPreview.processingCompetence)}.</p>
              <p className="mt-1 text-[11.5px] font-extrabold text-ds-ink">No contracheque que será pago no dia {formatRequestDate(effectPreview.payslipPaymentDate)}.</p>
              <p className="text-[11px] text-ds-ink-faint">Data calculada pela regra de pagamento no 5º dia útil.</p>
            </div>
          </div>
          <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">
            Motivo e detalhes <span className="font-semibold text-ds-ink-faint">(opcional)</span>
            <Textarea value={form.details} maxLength={1500} onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))} placeholder={form.action === "suspend" ? "Explique por que deseja suspender o benefício." : "Informe a alteração necessária, trajeto ou contexto do pedido."} className="min-h-28 rounded-ds-btn" />
            <span className={`block text-right text-[11px] font-semibold ${detailsInvalid ? "text-ds-danger" : "text-ds-ink-faint"}`}>{detailsInvalid ? "Se preencher, informe ao menos 10 caracteres · " : ""}{form.details.length}/1.500</span>
          </label>
        </PanelSection>
        <div className="mt-auto flex justify-end gap-2 border-t border-ds-divider pt-4">
          <Button variant="ds-secondary" onClick={() => setCreating(false)}>Cancelar</Button>
          <Button variant="primary-page" loading={busy} loadingLabel="Enviando…" disabled={busy || detailsInvalid} onClick={() => void submit()}><Send className="h-4 w-4" />Enviar solicitação</Button>
        </div>
      </SidePanel>

      <SidePanel
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        kicker="Minha solicitação"
        title={selected ? `${TRANSPORT_VOUCHER_ACTION_LABELS[selected.action]} de vale-transporte` : "Vale-transporte"}
        subtitle={selected ? `Enviada em ${formatRequestDate(selected.createdAt.slice(0, 10))}` : undefined}
      >
        {selected ? <>
          <PanelSection title="Situação do pedido">
            <div className="grid grid-cols-2 gap-4">
              <PanelField label="Situação">{selected.status === "pending" ? "Aguardando análise" : selected.status === "approved" ? "Aprovada" : selected.status === "rejected" ? "Rejeitada" : "Cancelada"}</PanelField>
              <PanelField label="Data da solicitação">{formatRequestDate(selected.requestDate)}</PanelField>
              <PanelField label="Competência">{formatRequestCompetence(selected.processingCompetence)}</PanelField>
              <PanelField label="Entra em vigor">{formatRequestDate(selected.effectiveDate)}</PanelField>
              <PanelField label="Pagamento do contracheque">{formatRequestDate(selected.payslipPaymentDate)}</PanelField>
              <PanelField label="Regra aplicada">{selected.requestedAfterCutoff ? `Após o corte do dia ${selected.cutoffDay}` : `Até o corte do dia ${selected.cutoffDay}`}</PanelField>
              {selected.review?.approvedDailyValue != null ? <PanelField label="Valor aprovado">{formatCurrency(selected.review.approvedDailyValue)}</PanelField> : null}
              {selected.review ? <PanelField label="Analisado por">{selected.review.reviewerName}</PanelField> : null}
            </div>
            <p className="rounded-ds-md bg-ds-muted p-3 text-[12.5px] leading-5 text-ds-ink-muted">{selected.details || "Nenhum motivo ou detalhe adicional foi informado."}</p>
            {selected.review?.notes ? <p className="text-[12px] leading-5 text-ds-ink-muted"><strong className="text-ds-ink">Observação do RH:</strong> {selected.review.notes}</p> : null}
          </PanelSection>
          <PanelSection title="Termo de vale-transporte">
            {visibleSignatureLoading ? <div className="flex items-center gap-2 text-xs text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" />Consultando assinatura…</div> : <TermStatus request={selected} signature={visibleSignature} />}
            {selectedIsSimulation ? <div className="flex flex-wrap gap-2">
              <Button variant="ds-secondary" size="sm" onClick={() => openTemplatePreview("system-admission-transportation-voucher-waiver")}><FileText className="h-4 w-4" />Ver termo de suspensão</Button>
              <Button variant="ds-secondary" size="sm" onClick={() => openTemplatePreview("system-admission-transportation-voucher-request")}><FileText className="h-4 w-4" />Ver termo de adesão</Button>
              <Button variant="ds-secondary" size="sm" onClick={() => openTemplatePreview("system-post-admission-transportation-voucher-reactivation")}><FileText className="h-4 w-4" />Ver termo de reativação</Button>
            </div> : null}
            {selected.documentStatus === "generated" && !selectedIsSimulation ? <div className="flex flex-wrap gap-2">
              <Button variant="ds-secondary" size="sm" onClick={() => void openDocument()} disabled={busy}><FileText className="h-4 w-4" />Visualizar termo</Button>
              {!visibleSignature?.signedAt ? <Button variant="primary-page" size="sm" onClick={() => void sign()} loading={busy} loadingLabel="Preparando…"><FileSignature className="h-4 w-4" />Revisar e assinar</Button> : null}
            </div> : null}
          </PanelSection>
          <PanelSection title="Trilha do processo" aside={`${selected.trail.length} evento(s)`}><RequestTrail request={selected} signature={visibleSignature} /></PanelSection>
          {selected.status === "pending" && !selectedIsSimulation ? <div className="mt-auto border-t border-ds-divider pt-4"><Button variant="danger-link" onClick={() => void cancel()} disabled={busy}><XCircle className="h-4 w-4" />Cancelar solicitação</Button></div> : null}
        </> : null}
      </SidePanel>
    </div>
  );
}
