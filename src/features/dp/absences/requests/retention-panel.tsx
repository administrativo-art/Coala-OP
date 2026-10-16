"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

import { ListShell, ListSkeleton } from '@/components/cadastros/cadastros-ui';
import { useDP } from '@/components/dp-context';
import { ControlPanel } from '@/components/patterns/control-panel';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { LiftRow } from '@/components/patterns/lift-row';
import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Textarea } from '@/components/ui/textarea';
import { formatRequestDate, formatRequestDateTime } from '@/features/hr/requests/request-ui';
import { decideAbsenceRetention, executeAbsenceRetention, listAbsenceRetentionCases, type AbsenceRetentionCase, type AbsenceRetentionDecision, type AbsenceRetentionState } from './retention-client';
import { belemCivilDate, canDecideRetention, canExecuteRetention, retentionDecisionError, retentionStates } from './retention-presentation';

type Decision = AbsenceRetentionDecision['action'];
const stateOrder: AbsenceRetentionState[] = [
  'awaiting_authorization', 'needs_revalidation', 'authorized', 'preparing_execution', 'executing',
  'execution_unknown', 'release_pending', 'execution_review_required', 'execution_blocked',
  'retained_until_review', 'scheduled', 'unanchored', 'removed',
];

export function AbsenceRetentionSection({ firebaseUser }: { firebaseUser: FirebaseUser | null }) {
  const { units } = useDP();
  const [unitId, setUnitId] = useState('');
  const [state, setState] = useState<AbsenceRetentionState | 'all'>('awaiting_authorization');
  const [items, setItems] = useState<AbsenceRetentionCase[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<AbsenceRetentionCase | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [nextReviewAfter, setNextReviewAfter] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [executionConfirm, setExecutionConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<AbsenceRetentionDecision | null>(null);
  const executionAttempt = useRef<{ caseId: string; expectedVersion: number; operationId: string } | null>(null);
  const sequence = useRef(0);
  const identity = firebaseUser?.uid ?? '';
  const identityRef = useRef(identity);

  const load = useCallback(async (next?: string) => {
    if (!firebaseUser || !unitId) return false;
    const request = ++sequence.current;
    const uid = firebaseUser.uid;
    setLoading(true);
    setError(null);
    try {
      const result = await listAbsenceRetentionCases(firebaseUser, {
        unitId, ...(state === 'all' ? {} : { state }), ...(next ? { cursor: next } : {}), limit: 25,
      });
      if (request !== sequence.current || uid !== identityRef.current) return false;
      setItems((current) => next ? [...current, ...result.cases.filter((item) => !current.some((old) => old.id === item.id))] : result.cases);
      setCursor(result.nextCursor);
      setLoaded(true);
      return true;
    } catch (cause) {
      if (request === sequence.current && uid === identityRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a fila de retenção.');
      return false;
    } finally {
      if (request === sequence.current && uid === identityRef.current) setLoading(false);
    }
  }, [firebaseUser, unitId, state]);

  useEffect(() => {
    sequence.current++;
    setItems([]);
    setCursor(null);
    setLoaded(false);
    setSelected(null);
    setDecision(null);
    setDecisionError(null);
    setExecutionConfirm(false);
    setBusy(false);
    setMessage(null);
    if (unitId) void load();
    return () => { sequence.current++; };
  }, [load, unitId]);

  useEffect(() => {
    identityRef.current = identity;
    setUnitId('');
    setState('awaiting_authorization');
    setSelected(null);
    setItems([]);
    attempt.current = null;
    executionAttempt.current = null;
  }, [identity]);

  const choose = (item: AbsenceRetentionCase) => {
    if (busy) return;
    setSelected(item);
    setDecision(null);
    setReason('');
    setNextReviewAfter('');
    setDecisionError(null);
    setExecutionConfirm(false);
    attempt.current = null;
    executionAttempt.current = null;
  };

  const submitExecution = async () => {
    if (!firebaseUser || !selected || busy || !canExecuteRetention(selected, firebaseUser.uid)) return;
    const input = executionAttempt.current?.caseId === selected.id ? executionAttempt.current
      : { caseId: selected.id, expectedVersion: selected.version, operationId: crypto.randomUUID() };
    executionAttempt.current = input;
    const request = sequence.current;
    const uid = firebaseUser.uid;
    setBusy(true);
    setDecisionError(null);
    try {
      await executeAbsenceRetention(firebaseUser, selected.id, input);
      if (request !== sequence.current || uid !== identityRef.current) return;
      setSelected(null);
      setExecutionConfirm(false);
      executionAttempt.current = null;
      const refreshed = await load();
      if (uid === identityRef.current) setMessage(refreshed
        ? 'Arquivo removido e recibo permanente registrado.'
        : 'Remoção concluída. Atualize a fila para conferir o recibo.');
    } catch (cause) {
      if (request !== sequence.current || uid !== identityRef.current) return;
      setSelected(null);
      setExecutionConfirm(false);
      const refreshed = await load();
      if (uid === identityRef.current) setMessage(refreshed
        ? `${cause instanceof Error ? cause.message : 'A remoção exige conferência.'} A fila foi atualizada.`
        : 'O resultado será conferido automaticamente. Atualize a fila antes de repetir.');
    } finally {
      if (uid === identityRef.current) setBusy(false);
    }
  };

  const changeDecision = (value: Decision) => {
    setDecision(value);
    setReason('');
    setNextReviewAfter('');
    setDecisionError(null);
    attempt.current = null;
  };

  const submit = async () => {
    if (!firebaseUser || !selected || !decision || busy || !canDecideRetention(selected, firebaseUser.uid)) return;
    const validationError = retentionDecisionError(decision, reason, nextReviewAfter, belemCivilDate());
    if (validationError) { setDecisionError(validationError); return; }
    const input = attempt.current ?? { action: decision, reason: reason.trim(), expectedVersion: selected.version,
      operationId: crypto.randomUUID(), ...(decision === 'retain' ? { nextReviewAfter } : {}) };
    attempt.current = input;
    const request = sequence.current;
    const uid = firebaseUser.uid;
    const caseId = selected.id;
    setBusy(true);
    setDecisionError(null);
    try {
      await decideAbsenceRetention(firebaseUser, caseId, input);
      if (request !== sequence.current || uid !== identityRef.current) return;
      setSelected(null);
      setDecision(null);
      attempt.current = null;
      const refreshed = await load();
      if (uid !== identityRef.current) return;
      setMessage(refreshed ? 'Decisão registrada e fila atualizada.' : 'Decisão registrada. Atualize a fila para conferir o novo estado.');
    } catch (cause) {
      if (request === sequence.current && uid === identityRef.current) setDecisionError(`${cause instanceof Error ? cause.message : 'Não foi possível confirmar a decisão.'} Atualize a fila antes de repetir se o resultado for incerto.`);
    } finally {
      if (uid === identityRef.current) setBusy(false);
    }
  };

  return <section className="space-y-3">
    <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Departamento Pessoal</p><h2 className="text-lg font-extrabold text-ds-ink">Retenção de documentos</h2><p className="text-xs text-ds-ink-muted">Após a autorização, a remoção definitiva usa uma trava do vínculo e registra recibo permanente.</p></div>
    <ControlPanel className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs font-bold text-ds-on-dark">Unidade (obrigatória)
          <Select value={unitId} disabled={busy} onValueChange={setUnitId}><SelectTrigger aria-label="Unidade da retenção" className="h-11 border-white/20 bg-ds-dark text-white"><SelectValue placeholder="Selecione uma unidade" /></SelectTrigger><SelectContent>{units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent></Select>
        </label>
        <label className="block space-y-1 text-xs font-bold text-ds-on-dark">Situação
          <Select value={state} disabled={busy} onValueChange={(value) => setState(value as AbsenceRetentionState | 'all')}><SelectTrigger aria-label="Situação da retenção" className="h-11 border-white/20 bg-ds-dark text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas as situações</SelectItem>{stateOrder.map((value) => <SelectItem key={value} value={value}>{retentionStates[value].label}</SelectItem>)}</SelectContent></Select>
        </label>
      </div>
      <p className="text-xs text-ds-on-dark-2">A fila é consultada somente após escolher uma unidade; 25 casos por página.</p>
    </ControlPanel>
    {message ? <p role="status" className="text-xs text-ds-ok">{message}</p> : null}
    {!unitId ? <p className="rounded-ds-card border border-ds-border bg-ds-surface p-5 text-sm text-ds-ink-muted">Selecione uma unidade para consultar a retenção.</p> : <>
      <div className="flex justify-end"><Button variant="ds-secondary" size="sm" disabled={loading || busy} onClick={() => void load()}>Atualizar fila</Button></div>
      <ListShell minWidth={560}>
        {loading && !loaded ? <ListSkeleton rows={3} /> : error ? <div className="space-y-2 p-5 text-sm text-ds-danger"><p role="alert">{error}</p><Button variant="ds-secondary" size="sm" onClick={() => void load()}>Tentar novamente</Button></div> : items.length ? items.map((item) => <LiftRow key={item.id} table selected={selected?.id === item.id} onClick={() => choose(item)} className="flex items-center justify-between gap-4">
          <span className="min-w-0"><span className="block truncate text-sm font-bold text-ds-ink">Documento do pedido {item.requestId}</span><span className="block truncate text-xs text-ds-ink-muted">Referência do documento: {item.fileId}</span><span className="block text-xs text-ds-ink-muted">Revisão: {item.reviewAfter ? formatRequestDate(item.reviewAfter) : 'sem data definida'} · Atualizado em {formatRequestDateTime(item.updatedAt)}</span></span>
          <StatusPill variant={retentionStates[item.state].tone}>{retentionStates[item.state].label}</StatusPill>
        </LiftRow>) : <p className="p-6 text-center text-sm text-ds-ink-muted">Nenhum caso nesta unidade e situação.</p>}
      </ListShell>
      {cursor ? <Button variant="ds-secondary" size="sm" disabled={loading} onClick={() => void load(cursor)}>Carregar mais casos</Button> : null}
    </>}
    <SidePanel open={Boolean(selected)} onOpenChange={(open) => { if (!open && !busy) { setSelected(null); setDecision(null); setExecutionConfirm(false); attempt.current = null; executionAttempt.current = null; } }} kicker="Retenção de documentos" title="Documento de ausência" subtitle={selected ? `Pedido ${selected.requestId}` : undefined}>
      {selected ? <>
        <PanelSection title="Situação do caso">
          <StatusPill variant={retentionStates[selected.state].tone}>{retentionStates[selected.state].label}</StatusPill>
          <p className="text-xs text-ds-ink-muted">{retentionStates[selected.state].detail}</p>
          <div className="grid grid-cols-2 gap-3"><PanelField label="Referência do documento">{selected.fileId}</PanelField><PanelField label="Próxima revisão">{selected.reviewAfter ? formatRequestDate(selected.reviewAfter) : 'Não definida'}</PanelField><PanelField label="Atualizado em">{formatRequestDateTime(selected.updatedAt)}</PanelField></div>
          {selected.decision ? <p className="text-xs text-ds-ink-muted">Última decisão em {formatRequestDateTime(selected.decision.at)}: {selected.decision.action === 'retain' ? 'documento mantido' : 'exclusão autorizada'}.</p> : null}
        </PanelSection>
        {canDecideRetention(selected, firebaseUser?.uid ?? null) ? <PanelSection title="Decisão do custodiante">
          <p className="text-xs text-ds-ink-muted">Escolha uma decisão e registre o motivo. Autorizar a exclusão não executa a remoção física.</p>
          <div className="flex flex-wrap gap-2"><Button variant="danger-link" size="sm" disabled={busy} onClick={() => changeDecision('authorize_delete')}>Autorizar exclusão</Button><Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => changeDecision('retain')}>Manter documento</Button></div>
          {decision ? <div className="space-y-3"><label className="block space-y-1 text-xs font-bold text-ds-ink">Motivo (obrigatório, mínimo 10 caracteres)<Textarea value={reason} onChange={(event) => { setReason(event.target.value); setDecisionError(null); attempt.current = null; }} maxLength={1000} disabled={busy} /></label>
            {decision === 'retain' ? <label className="block space-y-1 text-xs font-bold text-ds-ink">Próxima revisão (obrigatória, futura)<Input type="date" lang="pt-BR" value={nextReviewAfter} min={belemCivilDate()} onChange={(event) => { setNextReviewAfter(event.target.value); setDecisionError(null); attempt.current = null; }} disabled={busy} /></label> : null}
            {decisionError ? <p role="alert" className="text-xs text-ds-danger">{decisionError}</p> : null}
            <InlineConfirm message={decision === 'authorize_delete' ? 'Autorizar a exclusão deste documento? A autorização será registrada, mas o arquivo não será removido.' : 'Manter este documento até a próxima revisão informada?'} confirmLabel={decision === 'authorize_delete' ? 'Confirmar autorização' : 'Confirmar manutenção'} loading={busy} loadingLabel="Registrando…" onCancel={() => { setDecision(null); setDecisionError(null); attempt.current = null; }} onConfirm={() => void submit()} />
          </div> : null}
        </PanelSection> : selected.state === 'awaiting_authorization' ? <p className="text-xs text-ds-warn">Somente o custodiante autorizado pode decidir este caso. O servidor confere a permissão novamente.</p> : null}
        {canExecuteRetention(selected, firebaseUser?.uid ?? null) ? <PanelSection title="Exclusão definitiva">
          <p className="text-xs text-ds-ink-muted">O sistema bloqueará temporariamente alterações no vínculo, apagará somente a versão autorizada do arquivo e manterá o recibo da operação.</p>
          {!executionConfirm ? <Button variant="danger-link" size="sm" disabled={busy} onClick={() => setExecutionConfirm(true)}>Remover arquivo definitivamente</Button>
            : <InlineConfirm message="Remover definitivamente este arquivo? O pedido, as aprovações e o histórico serão preservados." confirmLabel="Confirmar remoção definitiva" loading={busy} loadingLabel="Removendo…" onCancel={() => { setExecutionConfirm(false); executionAttempt.current = null; }} onConfirm={() => void submitExecution()} />}
        </PanelSection> : null}
        {selected.state === 'needs_revalidation' ? <p className="text-xs text-ds-warn">É necessária conferência humana do vínculo e do marco de retenção. Esta tela não presume uma correção ou prazo.</p> : null}
        {selected.state === 'execution_blocked' ? <p className="text-xs text-ds-warn">Este caso foi bloqueado pelo protocolo anterior e precisa ser revalidado antes da remoção.</p> : null}
      </> : null}
    </SidePanel>
  </section>;
}
