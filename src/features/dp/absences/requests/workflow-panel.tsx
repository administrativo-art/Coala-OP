"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

import { ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { ControlPanel } from '@/components/patterns/control-panel';
import { LiftRow } from '@/components/patterns/lift-row';
import { useDP } from '@/components/dp-context';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill';
import { TACIT_APPROVAL_LABEL } from './tacit-approval';
import { Textarea } from '@/components/ui/textarea';
import { formatBrazilianRequestText } from '@/features/hr/requests/core';
import { formatRequestCompetence, formatRequestDate, formatRequestDateTime } from '@/features/hr/requests/request-ui';
import { actOnAbsenceRequest, getAbsenceRequest, listAbsenceRequests, openAbsenceAttachment, reconcileAbsenceNotification, reconcileAbsenceOperational, type AbsenceListFilters, type AbsenceOperationalAction } from './client';
import { availableOperationalActions, isOperationalPending, operationalPresentation } from './operational-presentation';
import { AbsencePreviewPanel } from './preview-panel';
import { isAbsenceReviewOverdue } from './review-sla';
import type { AbsenceActionInput } from './workflow-schemas';
import type { AbsenceRequestDto, AbsenceRequestStatus } from './workflow-types';
import { AbsenceCoverageSection } from '../coverage/coverage-section';

const statusLabels: Record<AbsenceRequestStatus, string> = {
  draft: 'Rascunho', submitted: 'Enviada', in_review: 'Em análise', adjustments_requested: 'Ajustes solicitados',
  approved: 'Aprovada', rejected: 'Rejeitada', cancelled: 'Cancelada',
};
const statusTones: Record<AbsenceRequestStatus, StatusPillVariant> = {
  draft: 'neutral', submitted: 'info', in_review: 'warn', adjustments_requested: 'warn',
  approved: 'ok', rejected: 'danger', cancelled: 'neutral',
};
const actionLabels: Record<AbsenceActionInput['action'], string> = {
  submit: 'Solicitação enviada', approve: 'Aprovada', reject: 'Rejeitada',
  request_adjustments: 'Ajustes solicitados', confirm_profile: 'Perfil confirmado', cancel: 'Cancelada',
  update_draft: 'Rascunho atualizado',
};
const historyLabels: Record<string, string> = {
  operational_abort: 'Preparação operacional abortada',
  operational_activate: 'Bloqueio operacional ativado',
  operational_reverse: 'Bloqueio operacional revertido',
  tacit_approve: 'Etapa aprovada por decurso de prazo (sem análise no prazo da regra)',
};
type Decision = 'reject' | 'request_adjustments' | 'confirm_profile' | 'cancel';

function quantity(value: AbsenceRequestDto) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value.quantity)} ${value.unit === 'day' ? (value.quantity === 1 ? 'dia' : 'dias') : (value.quantity === 1 ? 'hora' : 'horas')}`;
}

export function AbsenceWorkflowSection({ firebaseUser, scope, people = [], refreshKey = 0, initialFilters, onCountChange }: {
  firebaseUser: FirebaseUser | null;
  scope: 'mine' | 'review' | 'team';
  people?: Array<{ id: string; username: string }>;
  refreshKey?: number;
  initialFilters?: AbsenceListFilters;
  /** Quantidade carregada na lista; `more` indica que há outra página. */
  onCountChange?: (count: { value: number; more: boolean } | null) => void;
}) {
  const { units } = useDP();
  const [filterDraft, setFilterDraft] = useState<AbsenceListFilters>(initialFilters ?? (scope === 'team' ? { status: 'in_review' } : {}));
  const [filters, setFilters] = useState<AbsenceListFilters>(initialFilters ?? (scope === 'team' ? { status: 'in_review' } : {}));
  const [filterError, setFilterError] = useState<string | null>(null);
  const [items, setItems] = useState<AbsenceRequestDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AbsenceRequestDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [noticeStatus, setNoticeStatus] = useState<string | null>(null);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [operationalError, setOperationalError] = useState<string | null>(null);
  const [operationalMessage, setOperationalMessage] = useState<string | null>(null);
  const [abortConfirm, setAbortConfirm] = useState(false);
  const [editRequest, setEditRequest] = useState<AbsenceRequestDto | null>(null);
  const attempt = useRef<AbsenceActionInput | null>(null);
  const listSequence = useRef(0);
  const detailSequence = useRef(0);
  const identity = `${scope}:${firebaseUser?.uid ?? ''}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const beneficiaryName = (request: AbsenceRequestDto) => request.beneficiaryName?.trim()
    || people.find((person) => person.id === request.beneficiaryUid)?.username.trim() || null;

  useEffect(() => { onCountChange?.(loaded ? { value: items.length, more: Boolean(cursor) } : null); }, [cursor, items.length, loaded, onCountChange]);

  const load = useCallback(async (next?: string) => {
    if (!firebaseUser) return;
    const request = ++listSequence.current;
    const requestIdentity = `${scope}:${firebaseUser.uid}`;
    setLoading(true);
    setError(null);
    try {
      const response = await listAbsenceRequests(firebaseUser, scope, next, filters);
      if (request !== listSequence.current || requestIdentity !== identityRef.current) return;
      setItems((current) => next ? [...current, ...response.requests.filter((item) => !current.some((old) => old.id === item.id))] : response.requests);
      setCursor(response.nextCursor);
      setLoaded(true);
    } catch (cause) {
      if (request === listSequence.current && requestIdentity === identityRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as ausências.');
    } finally {
      if (request === listSequence.current && requestIdentity === identityRef.current) setLoading(false);
    }
  }, [firebaseUser, scope, filters]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setLoaded(false);
    setSelected(null);
    setEditRequest(null);
    setBusy(false);
    setOperationalError(null);
    setOperationalMessage(null);
    setAbortConfirm(false);
    detailSequence.current++;
    void load();
    const list = listSequence;
    const detail = detailSequence;
    return () => { list.current++; detail.current++; };
  }, [load, refreshKey, identity]);

  const open = async (row: AbsenceRequestDto) => {
    const request = ++detailSequence.current;
    const requestIdentity = identity;
    setSelected(row);
    setDetailError(null);
    setActionError(null);
    setFileError(null);
    setNoticeStatus(null);
    setOperationalError(null);
    setOperationalMessage(null);
    setAbortConfirm(false);
    setDecision(null);
    setReason('');
    attempt.current = null;
    if (!firebaseUser) return;
    try {
      const response = await getAbsenceRequest(firebaseUser, row.id);
      if (request === detailSequence.current && requestIdentity === identityRef.current) setSelected((current) => current?.id === row.id ? response.request : current);
    } catch (cause) {
      if (request === detailSequence.current && requestIdentity === identityRef.current) setDetailError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o detalhe.');
    }
  };

  const refreshDetail = async () => {
    if (!firebaseUser || !selected) return;
    const request = ++detailSequence.current;
    const requestIdentity = identity;
    const selectedId = selected.id;
    try {
      const response = await getAbsenceRequest(firebaseUser, selectedId);
      if (request !== detailSequence.current || requestIdentity !== identityRef.current) return;
      setSelected((current) => current?.id === selectedId ? response.request : current);
      if (isOperationalPending(response.request.operational)) setDecision(null);
      setDetailError(null);
      setActionError(null);
      setOperationalError(null);
      setOperationalMessage(null);
      setAbortConfirm(false);
      attempt.current = null;
      await load();
    } catch (cause) {
      if (request === detailSequence.current && requestIdentity === identityRef.current) setDetailError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o detalhe.');
    }
  };

  const runAction = async (action: AbsenceActionInput['action']) => {
    if (!firebaseUser || !selected || busy || isOperationalPending(selected.operational)) return;
    if (['approve', 'reject', 'request_adjustments'].includes(action) && !beneficiaryName(selected)) {
      setActionError('Atualize o detalhe para identificar o titular antes de decidir.');
      return;
    }
    const needsReason = action === 'cancel' || action === 'request_adjustments' || action === 'confirm_profile';
    if (needsReason && reason.trim().length < 10) {
      setActionError('Informe um motivo com pelo menos 10 caracteres.');
      return;
    }
    const input = attempt.current?.action === action && attempt.current.expectedVersion === selected.version
      ? attempt.current
      : ({ action, expectedVersion: selected.version, operationId: crypto.randomUUID(),
        ...(action === 'approve' || action === 'submit' ? {} : { reason: reason.trim() }) } as AbsenceActionInput);
    attempt.current = input;
    const request = detailSequence.current;
    const requestIdentity = identity;
    const selectedId = selected.id;
    setBusy(true);
    setActionError(null);
    try {
      const response = await actOnAbsenceRequest(firebaseUser, selected.id, input);
      if (requestIdentity !== identityRef.current) return;
      if (request === detailSequence.current) setSelected((current) => current?.id === selectedId ? response.request : current);
      setItems((current) => scope === 'review' && response.request.status !== 'in_review'
        ? current.filter((item) => item.id !== selectedId)
        : current.map((item) => item.id === selectedId ? response.request : item));
      if (request === detailSequence.current) { setDecision(null); setReason(''); attempt.current = null; }
      await load();
    } catch (cause) {
      const actionMessage = cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.';
      if (request !== detailSequence.current || requestIdentity !== identityRef.current) return;
      try {
        // A preparação operacional pode ter sido persistida antes de um conflito ou de uma resposta incerta.
        const refreshed = await getAbsenceRequest(firebaseUser, selectedId);
        if (request !== detailSequence.current || requestIdentity !== identityRef.current) return;
        setSelected((current) => current?.id === selectedId ? refreshed.request : current);
        setItems((current) => scope === 'review' && refreshed.request.status !== 'in_review'
          ? current.filter((item) => item.id !== selectedId)
          : current.map((item) => item.id === selectedId ? refreshed.request : item));
        if (isOperationalPending(refreshed.request.operational)) setDecision(null);
        setActionError(`${actionMessage} O detalhe foi atualizado; confira a situação antes de tentar novamente.`);
      } catch (refreshCause) {
        if (request === detailSequence.current && requestIdentity === identityRef.current) {
          setActionError(`${actionMessage} Não foi possível confirmar a situação atual: ${refreshCause instanceof Error ? refreshCause.message : 'atualize o detalhe.'}`);
        }
      }
    } finally {
      if (requestIdentity === identityRef.current) setBusy(false);
    }
  };

  const viewFile = async (fileId: string) => {
    if (!firebaseUser || !selected) return;
    setFileError(null);
    try { await openAbsenceAttachment(firebaseUser, selected.id, fileId); }
    catch (cause) { setFileError(cause instanceof Error ? cause.message : 'Não foi possível abrir o comprovante.'); }
  };

  const retryNotice = async () => {
    if (!firebaseUser || !selected || noticeBusy) return;
    const request = detailSequence.current;
    const requestIdentity = identity;
    setNoticeBusy(true);
    setNoticeStatus(null);
    try {
      const result = await reconcileAbsenceNotification(firebaseUser, selected.id);
      if (request !== detailSequence.current || requestIdentity !== identityRef.current) return;
      const state = result.state;
      setNoticeStatus(state === 'not_due' ? 'Não há aviso pendente para atualizar no sino.'
        : state === 'superseded' ? 'Este aviso foi substituído por um evento mais recente.'
          : state === 'completed' ? 'Aviso disponível no sino dos destinatários atuais.'
            : 'O aviso do sino ficou pendente e poderá ser tentado novamente.');
    } catch (cause) {
      if (request === detailSequence.current && requestIdentity === identityRef.current) setNoticeStatus(cause instanceof Error ? cause.message : 'Não foi possível tentar novamente o aviso.');
    } finally {
      if (request === detailSequence.current && requestIdentity === identityRef.current) setNoticeBusy(false);
    }
  };

  const runOperational = async (action: AbsenceOperationalAction) => {
    if (!firebaseUser || !selected || busy) return;
    const operational = selected.operational;
    const allowed = availableOperationalActions(operational);
    if (action === 'abort_preparation' ? !allowed.abort : action === 'activate' ? !allowed.activate : !allowed.reverse) return;
    const request = detailSequence.current;
    const requestIdentity = identity;
    const selectedId = selected.id;
    setBusy(true);
    setOperationalError(null);
    setOperationalMessage(null);
    let postError: string | null = null;
    try {
      await reconcileAbsenceOperational(firebaseUser, selectedId, { expectedVersion: selected.version, action });
    } catch (cause) {
      postError = cause instanceof Error ? cause.message : 'Não foi possível concluir a tentativa operacional.';
    }
    // Mesmo após erro de rede, a decisão pode ter sido gravada: o detalhe é a fonte de verdade.
    try {
      const response = await getAbsenceRequest(firebaseUser, selectedId);
      if (request !== detailSequence.current || requestIdentity !== identityRef.current) return;
      setSelected((current) => current?.id === selectedId ? response.request : current);
      setItems((current) => current.map((item) => item.id === selectedId ? response.request : item));
      setAbortConfirm(false);
      if (postError) setOperationalError(`${postError} O detalhe foi atualizado; confira a situação antes de tentar novamente.`);
      else setOperationalMessage('Detalhe atualizado após a tentativa operacional. Confira a situação exibida abaixo.');
    } catch (cause) {
      if (request !== detailSequence.current || requestIdentity !== identityRef.current) return;
      setOperationalError(`${postError ?? 'A tentativa foi enviada, mas o resultado não foi confirmado.'} Não foi possível atualizar o detalhe: ${cause instanceof Error ? cause.message : 'tente novamente.'}`);
    } finally {
      if (request === detailSequence.current && requestIdentity === identityRef.current) setBusy(false);
    }
  };

  const applyFilters = () => {
    if (filterDraft.startDate && filterDraft.endDate && filterDraft.startDate > filterDraft.endDate) {
      setFilterError('A data final deve ser igual ou posterior à data inicial.');
      return;
    }
    setFilterError(null);
    setFilters({ ...filterDraft });
  };

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Ausências</p><h2 className="text-lg font-extrabold text-ds-ink">{scope === 'review' ? 'Aguardando minha análise' : scope === 'team' ? 'Ausências da equipe' : 'Meus pedidos de ausência'}</h2></div>
      <Button variant="ds-secondary" size="sm" onClick={() => void load()} disabled={loading}>Atualizar ausências</Button>
    </div>
    {scope !== 'mine' ? <ControlPanel className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="text-xs font-bold">Pessoa<select aria-label="Filtrar por pessoa" className="mt-1 h-10 w-full rounded-ds-btn border border-white/20 bg-ds-dark px-2 text-white" value={filterDraft.beneficiaryUid ?? ''} onChange={(event) => setFilterDraft((current) => ({ ...current, beneficiaryUid: event.target.value }))}><option value="">Todas</option>{people.map((person) => <option key={person.id} value={person.id}>{person.username}</option>)}</select></label>
        <label className="text-xs font-bold">Situação<select aria-label="Filtrar por situação" className="mt-1 h-10 w-full rounded-ds-btn border border-white/20 bg-ds-dark px-2 text-white" value={scope === 'review' ? 'in_review' : filterDraft.status ?? 'in_review'} disabled={scope === 'review'} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value }))}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-bold">Unidade<select aria-label="Filtrar por unidade" className="mt-1 h-10 w-full rounded-ds-btn border border-white/20 bg-ds-dark px-2 text-white" value={filterDraft.unitId ?? ''} onChange={(event) => setFilterDraft((current) => ({ ...current, unitId: event.target.value }))}><option value="">Todas</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label className="text-xs font-bold">Início a partir de<Input type="date" aria-label="Data inicial do início" lang="pt-BR" className="mt-1 h-10 text-ds-ink" value={filterDraft.startDate ?? ''} onChange={(event) => setFilterDraft((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label className="text-xs font-bold">Início até<Input type="date" aria-label="Data final do início" lang="pt-BR" className="mt-1 h-10 text-ds-ink" value={filterDraft.endDate ?? ''} onChange={(event) => setFilterDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label className="flex items-center gap-2 self-end rounded-ds-btn border border-white/20 px-3 py-2 text-xs font-bold"><input type="checkbox" checked={filterDraft.overdueOnly === true} onChange={(event) => setFilterDraft((current) => ({ ...current, overdueOnly: event.target.checked, ...(event.target.checked ? { status: 'in_review', startDate: '', endDate: '' } : {}) }))} />Somente atrasadas</label>
      </div>
      {filterError ? <p role="alert" className="text-xs text-ds-danger">{filterError}</p> : null}
      <Button variant="ds-secondary" size="sm" onClick={applyFilters}>Aplicar filtros</Button>
    </ControlPanel> : null}
    <ListShell minWidth={580}>
      {loading && !loaded ? <ListSkeleton rows={3} /> : error ? <div className="space-y-2 p-5 text-sm text-ds-danger"><p role="alert">{error}</p><Button variant="ds-secondary" size="sm" onClick={() => void load()}>Tentar novamente</Button></div> : items.length ? items.map((item) => <LiftRow key={item.id} table selected={selected?.id === item.id} onClick={() => void open(item)} className="flex items-center justify-between gap-4">
        <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-ds-ink">{beneficiaryName(item) ?? 'Titular não identificado'}</span><span className="block truncate text-sm font-semibold text-ds-ink">{item.typeName}</span><span className="block text-xs text-ds-ink-muted">{formatRequestDate(item.input.startDate)} a {formatRequestDate(item.input.endDate)} · {quantity(item)}</span>{item.reviewSla ? <span className={`block text-xs ${isAbsenceReviewOverdue(item.reviewSla) ? 'font-bold text-ds-danger' : 'text-ds-ink-muted'}`}>{isAbsenceReviewOverdue(item.reviewSla) ? 'Prazo de análise vencido' : `Analisar até ${formatRequestDateTime(item.reviewSla.deadlineAt)}`}</span> : null}</span>
        <span className="flex shrink-0 flex-col items-end gap-1"><StatusPill variant={statusTones[item.status]}>{statusLabels[item.status]}</StatusPill>{item.approvedByInaction ? <StatusPill variant="warn">{TACIT_APPROVAL_LABEL}</StatusPill> : null}{item.operational ? <StatusPill variant={operationalPresentation(item.operational).tone}>{operationalPresentation(item.operational).label}</StatusPill> : null}</span>
      </LiftRow>) : <p className="p-6 text-center text-sm text-ds-ink-muted">{scope === 'review' ? 'Nenhuma ausência atribuída à sua análise.' : 'Você ainda não tem pedidos de ausência.'}</p>}
    </ListShell>
    {cursor ? <Button variant="ds-secondary" size="sm" onClick={() => void load(cursor)} disabled={loading}>Carregar mais ausências</Button> : null}
    <SidePanel open={Boolean(selected)} onOpenChange={(value) => { if (!value && !busy) { detailSequence.current++; setSelected(null); attempt.current = null; } }} kicker={scope === 'review' ? 'Análise de ausência' : 'Pedido de ausência'} title={selected?.typeName ?? 'Ausência'} subtitle={selected ? `Criada em ${formatRequestDateTime(selected.createdAt)}` : undefined}>
      {selected ? <>
        {detailError ? <div role="alert" className="space-y-2 text-sm text-ds-danger"><p>{detailError}</p><Button variant="ds-secondary" size="sm" onClick={() => void refreshDetail()}>Atualizar detalhe</Button></div> : null}
        <PanelSection title="Pedido">
          <PanelField label="Colaborador titular">{beneficiaryName(selected) ?? 'Titular não identificado — atualize o detalhe antes de decidir.'}</PanelField>
          <div className="grid grid-cols-2 gap-4">
            <PanelField label="Situação"><span className="flex flex-wrap gap-1"><StatusPill variant={statusTones[selected.status]}>{statusLabels[selected.status]}</StatusPill>{selected.approvedByInaction ? <StatusPill variant="warn">{TACIT_APPROVAL_LABEL}</StatusPill> : null}</span></PanelField>
            <PanelField label="Quantidade">{quantity(selected)}</PanelField>
            <PanelField label="Início">{formatRequestDate(selected.input.startDate)}{selected.input.startTime ? `, ${selected.input.startTime}` : ''}</PanelField>
            <PanelField label="Término ou retorno">{formatRequestDate(selected.input.endDate)}{selected.input.endTime ? `, ${selected.input.endTime}` : ''}</PanelField>
            <PanelField label="Versão da regra">{selected.typeVersion}</PanelField>
            <PanelField label="Etapa">{selected.stage === 'manager' ? 'Gestor' : selected.stage === 'dp' ? 'Departamento Pessoal' : '—'}</PanelField>
            {selected.reviewSla ? <PanelField label="Prazo da análise">{formatRequestDateTime(selected.reviewSla.deadlineAt)}</PanelField> : null}
          </div>
          {selected.reason ? <PanelField label="Motivo"><span className="whitespace-pre-wrap font-normal">{formatBrazilianRequestText(selected.reason)}</span></PanelField> : null}
          {selected.reviewSla && isAbsenceReviewOverdue(selected.reviewSla) ? <p className="text-xs font-bold text-ds-danger">{selected.tacitApprovalDays
            ? `O prazo de 24 horas venceu. Sem análise em ${selected.tacitApprovalDays} ${selected.tacitApprovalDays === 1 ? 'dia' : 'dias'} desde a atribuição, esta etapa é aprovada por decurso de prazo.`
            : 'O prazo de 24 horas venceu. A solicitação continua aguardando decisão; não há aprovação automática para esta regra.'}</p> : null}
          {selected.approvedByInaction ? <p className="text-xs text-ds-warn">Ninguém analisou no prazo da regra e a aprovação final aconteceu por decurso de prazo. O DP ainda confere no fechamento do ponto.</p> : null}
          {selected.status === 'adjustments_requested' ? <p className="text-xs text-ds-warn">Revise os dados e comprovantes antes de reenviar.</p> : null}
          {selected.profileReviewRequired ? <p className="text-xs text-ds-warn">O histórico ou perfil precisa de confirmação do Departamento Pessoal antes da decisão final.</p> : null}
        </PanelSection>
        <PanelSection title="Aplicação operacional">
          {selected.operational ? <>
            <StatusPill variant={operationalPresentation(selected.operational).tone}>{operationalPresentation(selected.operational).label}</StatusPill>
            <p className="text-xs text-ds-ink-muted">{operationalPresentation(selected.operational).detail}</p>
            {isOperationalPending(selected.operational) ? <p className="text-xs text-ds-warn">Enquanto esta etapa estiver pendente, as ações normais do pedido ficam bloqueadas. Atualize o detalhe para verificar mudanças após uma falha.</p> : null}
          </> : <p className="text-xs text-ds-ink-muted">Não há aplicação operacional confirmada neste pedido.</p>}
          <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void refreshDetail()}>Atualizar detalhe</Button>
          {availableOperationalActions(selected.operational).abort ? <>
            <Button variant="danger-link" size="sm" disabled={busy} onClick={() => setAbortConfirm(true)}>Abortar preparação</Button>
            {abortConfirm ? <InlineConfirm message="Abortar a preparação deste pedido? A proteção será limpa após conferência segura. Isso não cancela nem rejeita automaticamente o pedido." confirmLabel="Abortar preparação" loading={busy} onCancel={() => setAbortConfirm(false)} onConfirm={() => void runOperational('abort_preparation')} /> : null}
          </> : null}
          {availableOperationalActions(selected.operational).activate ? <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void runOperational('activate')}>Tentar aplicação novamente</Button> : null}
          {availableOperationalActions(selected.operational).reverse ? <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void runOperational('reverse')}>Tentar reversão novamente</Button> : null}
          {operationalError ? <p role="alert" className="text-xs text-ds-danger">{operationalError}</p> : null}
          {operationalMessage ? <p role="status" className="text-xs text-ds-ink-muted">{operationalMessage}</p> : null}
        </PanelSection>
        {selected.status === 'approved' && selected.operational?.operationallyApplied && scope !== 'mine'
          ? <AbsenceCoverageSection key={selected.id} firebaseUser={firebaseUser} requestId={selected.id} /> : null}
        {selected.preflight ? <PanelSection title="Conferência antes da decisão">
          <PanelField label="Aprovadores previstos">{selected.preflight.approvers.length ? selected.preflight.approvers.map((person) => person.name).join(', ') : selected.preflight.approvalPending ? 'Definição pendente' : 'Fluxo automático'}</PanelField>
          {selected.preflight.approvalSlaHours ? <PanelField label="Prazo por etapa humana">{selected.preflight.approvalSlaHours} horas corridas</PanelField> : null}
          {selected.preflight.balances.length ? selected.preflight.balances.map((balance) => <PanelField key={balance.period} label={`Saldo · ${formatRequestCompetence(balance.period)}`}>{balance.remaining === null ? 'Sem teto configurado' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(balance.remaining)} disponíveis`}{balance.limit !== null ? ` de ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(balance.limit)}` : ''}</PanelField>) : <p className="text-xs text-ds-ink-muted">Não há saldo por período informado para esta regra.</p>}
          {selected.preflight.profileReviewRequired ? <p className="text-xs text-ds-warn">Confirmação do perfil pendente.</p> : null}
        </PanelSection> : null}
        <PanelSection title="Comprovantes" aside={selected.attachmentCount}>
          {selected.attachments.length ? selected.attachments.map((file, index) => <div key={file.id} className="flex items-center justify-between gap-2 text-xs"><span>Comprovante {index + 1} · {(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB</span>{file.canRead ? <Button variant="ds-secondary" size="xs" onClick={() => void viewFile(file.id)}>Abrir comprovante</Button> : <span className="text-ds-ink-faint">Acesso restrito</span>}</div>) : <p className="text-xs text-ds-ink-muted">Nenhum comprovante anexado.</p>}
          {fileError ? <p role="alert" className="text-xs text-ds-danger">{fileError}</p> : null}
        </PanelSection>
        <PanelSection title="Histórico" aside={`${selected.history.length} evento(s)`}>
          {selected.history.map((event, index) => <div key={`${event.version}-${index}`} className="border-b border-ds-divider pb-2 text-xs last:border-0"><p className="font-bold text-ds-ink">{historyLabels[event.action] ?? actionLabels[event.action as AbsenceActionInput['action']] ?? 'Atualização'} · {formatRequestDateTime(event.at)}</p>{event.reason ? <p className="mt-1 whitespace-pre-wrap text-ds-ink-muted">{formatBrazilianRequestText(event.reason)}</p> : null}</div>)}
        </PanelSection>
        {(selected.status === 'draft' || selected.status === 'adjustments_requested') && selected.requesterUid === firebaseUser?.uid && !isOperationalPending(selected.operational) ? <Button variant="ds-secondary" disabled={busy} onClick={() => { setEditRequest(selected); detailSequence.current++; setSelected(null); }}>Editar rascunho</Button> : null}
        {selected.canSubmit && !isOperationalPending(selected.operational) ? <Button variant="primary-modal" loading={busy} loadingLabel="Enviando…" onClick={() => void runAction('submit')}>Enviar solicitação</Button> : null}
        {selected.canReview && !isOperationalPending(selected.operational) && scope === 'review' ? <PanelSection title="Decisão">
          <Button variant="primary-modal" disabled={busy || !beneficiaryName(selected)} onClick={() => void runAction('approve')}>Aprovar solicitação</Button>
          <div className="flex flex-wrap gap-2"><Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => { setDecision('request_adjustments'); setReason(''); attempt.current = null; }}>Solicitar ajustes</Button><Button variant="danger-link" size="sm" disabled={busy} onClick={() => { setDecision('reject'); setReason(''); attempt.current = null; }}>Rejeitar solicitação</Button></div>
        </PanelSection> : null}
        {selected.canConfirmProfile && !isOperationalPending(selected.operational) ? <Button variant="ds-secondary" disabled={busy} onClick={() => { setDecision('confirm_profile'); setReason(''); attempt.current = null; }}>Confirmar perfil</Button> : null}
        {selected.canCancel && !isOperationalPending(selected.operational) ? <Button variant="danger-link" disabled={busy} onClick={() => { setDecision('cancel'); setReason(''); attempt.current = null; }}>Cancelar solicitação</Button> : null}
        {decision && !isOperationalPending(selected.operational) ? <PanelSection title={decision === 'confirm_profile' ? 'Confirmar perfil' : decision === 'request_adjustments' ? 'Solicitar ajustes' : decision === 'reject' ? 'Rejeitar pedido' : 'Cancelar pedido'}>
          <label className="block space-y-1.5 text-xs font-bold text-ds-ink">Motivo {decision === 'reject' ? '(opcional, conforme a regra)' : '(obrigatório)'}<Textarea value={reason} onChange={(event) => { setReason(event.target.value); setActionError(null); attempt.current = null; }} maxLength={1000} className="min-h-24" /></label>
          {decision === 'reject' ? <InlineConfirm message="Rejeitar esta solicitação?" confirmLabel="Rejeitar pedido" loading={busy} onCancel={() => setDecision(null)} onConfirm={() => void runAction('reject')} />
            : decision === 'cancel' ? <InlineConfirm message="Cancelar esta solicitação?" confirmLabel="Cancelar pedido" loading={busy} onCancel={() => setDecision(null)} onConfirm={() => void runAction('cancel')} />
              : <div className="flex justify-end gap-2"><Button variant="ds-ghost" onClick={() => setDecision(null)}>Voltar</Button><Button variant="primary-modal" loading={busy} onClick={() => void runAction(decision)}>{decision === 'confirm_profile' ? 'Confirmar perfil' : 'Solicitar ajustes'}</Button></div>}
        </PanelSection> : null}
        {actionError ? <div role="alert" className="space-y-2 text-xs text-ds-danger"><p>{actionError}</p><Button variant="ds-secondary" size="xs" onClick={() => void refreshDetail()}>Atualizar pedido</Button></div> : null}
        {selected.status !== 'draft' && [selected.requesterUid, selected.beneficiaryUid, ...selected.assignedReviewerIds].includes(firebaseUser?.uid ?? '') ? <PanelSection title="Avisos"><p className="text-xs text-ds-ink-muted">Os avisos desta solicitação aparecem somente no sino do Coala. Não são enviados por e-mail nem por push.</p><Button variant="ds-secondary" size="sm" loading={noticeBusy} onClick={() => void retryNotice()}>Atualizar aviso no sino</Button>{noticeStatus ? <p role="status" className="text-xs text-ds-ink-muted">{noticeStatus}</p> : null}</PanelSection> : null}
      </> : null}
    </SidePanel>
    <AbsencePreviewPanel open={Boolean(editRequest)} onOpenChange={(value) => { if (!value) setEditRequest(null); }} firebaseUser={firebaseUser} editingRequest={editRequest ?? undefined} beneficiaryUid={editRequest && editRequest.beneficiaryUid !== firebaseUser?.uid ? editRequest.beneficiaryUid : undefined} beneficiaryName={people.find((person) => person.id === editRequest?.beneficiaryUid)?.username} onDraftCreated={() => { setEditRequest(null); void load(); }} />
  </section>;
}
