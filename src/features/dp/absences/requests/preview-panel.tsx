"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

import { PanelField, PanelSection, SidePanel } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatBrazilianRequestText } from '@/features/hr/requests/core';
import { formatRequestDate } from '@/features/hr/requests/request-ui';
import { actOnAbsenceRequest, calculateAbsenceRequestPreview, createAbsenceDraft, fetchAbsenceRequestOptions, prepareAbsenceFiles } from './client';
import type { AbsenceRequestPreviewInput } from './schemas';
import type { AbsencePreviewPending, AbsenceRequestOption, AbsenceRequestPreview } from './types';
import type { AbsenceRequestDto } from './workflow-types';

const pendingLabels: Record<AbsencePreviewPending, string> = {
  historical_profile_unverified: 'O histórico do seu perfil ainda precisa ser conferido.',
  overlaps_unverified: 'A existência de outros períodos de ausência ainda precisa ser conferida.',
  accumulated_balance_unverified: 'O saldo do limite acumulado ainda precisa ser conferido.',
  scheduled_workdays_unavailable: 'A quantidade depende da escala de trabalho.',
  hour_schedule_unverified: 'Os horários ainda precisam ser conferidos com a jornada.',
  document_required: 'Será necessário anexar um documento quando os pedidos forem habilitados.',
  approval_and_submission_unavailable: 'O envio e a análise de pedidos ainda não estão disponíveis.',
};

const approvalLabels: Record<AbsenceRequestPreview['approvalFlow'], string> = {
  automatic: 'Automática, após as verificações',
  manager: 'Gestor',
  dp: 'Departamento Pessoal',
  manager_then_dp: 'Gestor e depois Departamento Pessoal',
};

function unitLabel(unit: AbsenceRequestPreviewInput['unit'], amount: number) {
  return unit === 'day' ? (amount === 1 ? 'dia' : 'dias') : (amount === 1 ? 'hora' : 'horas');
}

export function formatAbsenceQuantity(preview: AbsenceRequestPreview) {
  const amount = preview.quantity.value;
  return amount === null ? 'Depende da escala' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(amount)} ${unitLabel(preview.quantity.unit, amount)}`;
}

function previewError(error: unknown, fallback: string) {
  return error instanceof Error ? formatBrazilianRequestText(error.message) : fallback;
}

export function AbsencePreviewPanel({ open, onOpenChange, firebaseUser, beneficiaryUid, beneficiaryName, editingRequest, onDraftCreated, initialDate }: {
  open: boolean;
  /** Data já trazida de outra tela (ex.: dia "sem batidas" no Registro de ponto). */
  initialDate?: string;
  onOpenChange: (open: boolean) => void;
  firebaseUser: FirebaseUser | null;
  beneficiaryUid?: string;
  beneficiaryName?: string;
  editingRequest?: AbsenceRequestDto;
  onDraftCreated?: (request: AbsenceRequestDto) => void;
}) {
  const sequence = useRef(0);
  const userUid = useRef(firebaseUser?.uid ?? null);
  userUid.current = firebaseUser?.uid ?? null;
  const previewSequence = useRef(-1);
  const draftAttempt = useRef<{ idempotencyKey: string; operationId: string; submitOperationId: string; proposedRequestId: string; preparationIds: string[]; savedRequest?: AbsenceRequestDto } | null>(null);
  const [step, setStep] = useState<'form' | 'summary'>('form');
  const [reason, setReason] = useState('');
  const [options, setOptions] = useState<AbsenceRequestOption[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [form, setForm] = useState<AbsenceRequestPreviewInput>({ absenceTypeId: '', unit: 'day', startDate: '', endDate: '' });
  const [preview, setPreview] = useState<AbsenceRequestPreview | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    if (!firebaseUser) return;
    const request = ++sequence.current;
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const response = await fetchAbsenceRequestOptions(firebaseUser, beneficiaryUid);
      if (request !== sequence.current) return;
      setOptions(response.absenceTypes);
      setCanCreate(response.capabilities?.canCreate === true && response.capabilities.catalogDatabase === 'coala-rh');
    } catch (error) {
      if (request === sequence.current) setOptionsError(previewError(error, 'Não foi possível carregar os tipos de ausência.'));
    } finally {
      if (request === sequence.current) setOptionsLoading(false);
    }
  }, [firebaseUser, beneficiaryUid]);

  useEffect(() => {
    sequence.current++;
    previewSequence.current = -1;
    draftAttempt.current = null;
    setOptions([]);
    setCanCreate(false);
    setForm(editingRequest?.input ?? { absenceTypeId: '', unit: 'day', startDate: initialDate ?? '', endDate: initialDate ?? '' });
    setReason(editingRequest?.reason ?? '');
    setStep('form');
    setPreview(null);
    setFiles([]);
    setSaving(false);
    setSaveError(null);
    setCalculating(false);
    setCalculationError(null);
    setFieldError(null);
    if (open) void loadOptions();
    const currentSequence = sequence;
    return () => { currentSequence.current++; };
  }, [open, loadOptions, editingRequest, initialDate]);

  const selected = options.find((option) => option.id === form.absenceTypeId);

  const change = (patch: Partial<AbsenceRequestPreviewInput>) => {
    if (saving) return;
    sequence.current++;
    draftAttempt.current = null;
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setStep('form');
    setSaveError(null);
    setCalculating(false);
    setCalculationError(null);
    setFieldError(null);
  };

  const calculate = async () => {
    if (!firebaseUser || calculating || saving) return;
    if (!selected || !form.startDate || !form.endDate || (form.unit === 'hour' && (!form.startTime || !form.endTime))) {
      setFieldError('Informe o tipo, as datas e, para horas, os dois horários.');
      return;
    }
    if (form.endDate < form.startDate || (form.unit === 'hour' && form.startDate === form.endDate && form.endTime! <= form.startTime!)) {
      setFieldError('Confira a data final. Para período noturno, informe também a data seguinte de término.');
      return;
    }
    const request = ++sequence.current;
    setCalculating(true);
    setCalculationError(null);
    setFieldError(null);
    try {
      const response = await calculateAbsenceRequestPreview(firebaseUser, form, beneficiaryUid);
      if (request === sequence.current) { setPreview(response.preview); previewSequence.current = request; setStep('summary'); }
    } catch (error) {
      if (request === sequence.current) setCalculationError(previewError(error, 'Não foi possível calcular a prévia.'));
    } finally {
      if (request === sequence.current) setCalculating(false);
    }
  };

  const trimmedReason = reason.trim();
  const reasonError = trimmedReason && trimmedReason.length < 10 ? 'O motivo precisa ter ao menos 10 caracteres.' : null;
  const missingDocument = Boolean(selected?.attachmentRequired) && files.length + (editingRequest?.attachmentCount ?? 0) === 0;

  const conclude = () => {
    if (reasonError) { setFieldError(reasonError); return; }
    void calculate();
  };

  /** Salva o rascunho e, com `submit`, envia em seguida; se só o envio falhar, o rascunho fica salvo para enviar pelo detalhe. */
  const saveDraft = async (submit = false) => {
    if (!firebaseUser || !preview || !canCreate || saving || preview.quantity.value === null || preview.source !== 'coala-rh'
      || previewSequence.current !== sequence.current) return;
    if (preview.attachmentRequired && files.length + (editingRequest?.attachmentCount ?? 0) === 0) {
      setSaveError('Anexe o documento obrigatório antes de criar o rascunho.');
      return;
    }
    const requestSequence = sequence.current;
    const requestUid = firebaseUser.uid;
    const currentAttempt = draftAttempt.current ?? { idempotencyKey: crypto.randomUUID(), operationId: crypto.randomUUID(), submitOperationId: crypto.randomUUID(), proposedRequestId: crypto.randomUUID(), preparationIds: [] };
    draftAttempt.current = currentAttempt;
    setSaving(true);
    setSaveError(null);
    try {
      if (files.length && currentAttempt.preparationIds.length === 0) {
        const prepared = await prepareAbsenceFiles(firebaseUser, files, currentAttempt.proposedRequestId, beneficiaryUid, editingRequest?.id);
        if (requestSequence !== sequence.current) return;
        currentAttempt.preparationIds = prepared.preparationIds;
      }
      if (requestSequence !== sequence.current) return;
      let saved: { request: AbsenceRequestDto };
      if (currentAttempt.savedRequest) {
        saved = { request: currentAttempt.savedRequest };
      } else if (editingRequest) {
        saved = await actOnAbsenceRequest(firebaseUser, editingRequest.id, { action: 'update_draft', expectedVersion: editingRequest.version,
          operationId: currentAttempt.operationId, request: form, ...(currentAttempt.preparationIds.length ? { preparationRef: currentAttempt.proposedRequestId } : {}),
          preparationIds: currentAttempt.preparationIds, ...(trimmedReason ? { reason: trimmedReason } : {}) });
      } else {
        saved = await createAbsenceDraft(firebaseUser, { idempotencyKey: currentAttempt.idempotencyKey,
          proposedRequestId: currentAttempt.preparationIds.length ? currentAttempt.proposedRequestId : undefined,
          preparationIds: currentAttempt.preparationIds, request: form, ...(beneficiaryUid ? { beneficiaryUid } : {}),
          ...(trimmedReason ? { reason: trimmedReason } : {}) });
      }
      currentAttempt.savedRequest = saved.request;
      if (submit) {
        try {
          saved = await actOnAbsenceRequest(firebaseUser, saved.request.id, { action: 'submit', expectedVersion: saved.request.version,
            operationId: currentAttempt.submitOperationId });
        } catch (error) {
          if (requestSequence === sequence.current) {
            onDraftCreated?.(saved.request);
            setSaveError(`O rascunho foi salvo, mas o envio não foi concluído: ${previewError(error, 'tente de novo ou envie pelo detalhe.')}`);
          }
          return;
        }
      }
      if (requestSequence === sequence.current && requestUid === userUid.current) onDraftCreated?.(saved.request);
      if (requestSequence === sequence.current && requestUid === userUid.current) {
        draftAttempt.current = null;
        onOpenChange(false);
      }
    } catch (error) {
      if (requestSequence === sequence.current) setSaveError(previewError(error, 'Não foi possível salvar o rascunho.'));
    } finally {
      if (requestSequence === sequence.current) setSaving(false);
    }
  };

  const selectFiles = (selectedFiles: File[]) => {
    if (saving) return;
    draftAttempt.current = null;
    if (selectedFiles.length + (editingRequest?.attachmentCount ?? 0) > 5 || selectedFiles.some((file) => file.size === 0 || file.size > 10 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) {
      setFiles([]);
      setSaveError('Selecione até cinco arquivos PDF, JPEG ou PNG de até 10 MB cada.');
      return;
    }
    setFiles(selectedFiles);
    setSaveError(null);
  };

  const fileInput = <label className="block space-y-1.5 text-xs font-bold text-ds-ink">Comprovantes {selected?.attachmentRequired ? '(obrigatórios para este tipo)' : '(opcionais)'}
    <Input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple disabled={saving} onChange={(event) => selectFiles(Array.from(event.target.files ?? []))} className="h-11 rounded-ds-btn" />
    <span className="block text-[11px] font-semibold text-ds-ink-muted">Atestado ou outro documento: até cinco arquivos PDF, JPEG ou PNG, com 10 MB cada. No celular, dá para fotografar. Só você e os responsáveis autorizados acessam.</span>
  </label>;

  return <SidePanel open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value); }} kicker={beneficiaryUid ? "Solicitação para a equipe" : "Minhas solicitações"} title={editingRequest ? 'Editar rascunho de ausência' : 'Solicitar ausência'} subtitle={step === 'summary' ? 'Confira o resumo antes de enviar.' : 'Preencha o pedido e anexe o documento.'}>
    {beneficiaryName ? <p className="text-xs font-bold text-ds-ink">Solicitação para {beneficiaryName}</p> : null}
    {canCreate ? <ol className="flex items-center gap-2 text-xs font-bold" aria-label="Etapas do pedido">
      {([['form', '1 · Dados e comprovante'], ['summary', '2 · Resumo e envio']] as const).map(([key, label], index) => <li key={key} className="flex items-center gap-2">
        {index ? <span className="h-px w-6 bg-ds-border" aria-hidden /> : null}
        <span className={step === key ? 'rounded-full bg-ds-ink px-2.5 py-1 text-white' : 'rounded-full bg-ds-warm px-2.5 py-1 text-ds-ink-muted'}>{label}</span>
      </li>)}
    </ol> : <div className="rounded-ds-card border border-ds-info/20 bg-ds-info-bg p-4 text-[12.5px] leading-5 text-ds-info">Esta é apenas uma prévia: nenhum pedido será criado. Anexar documentos e enviar a solicitação ainda não estão disponíveis.</div>}

    {step === 'form' ? <PanelSection title="Ausência">
      {optionsLoading ? <p role="status" className="text-sm text-ds-ink-muted">Carregando tipos de ausência…</p> : optionsError ? <div role="alert" className="space-y-2 text-sm text-ds-danger"><p>{optionsError}</p><Button variant="ds-secondary" size="sm" onClick={() => void loadOptions()}>Tentar novamente</Button></div> : options.length === 0 ? <p className="text-sm text-ds-ink-muted">Nenhum tipo de ausência está disponível para o seu vínculo neste momento.</p> : <>
        <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Tipo de ausência
          <Select value={form.absenceTypeId} disabled={saving} onValueChange={(value) => { const option = options.find((item) => item.id === value); change({ absenceTypeId: value, unit: option?.units[0] ?? 'day', startTime: undefined, endTime: undefined }); }}>
            <SelectTrigger className="h-11 rounded-ds-btn border-ds-border-input bg-ds-surface"><SelectValue placeholder="Selecione um tipo" /></SelectTrigger>
            <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {selected && selected.units.length > 1 ? <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Unidade
          <Select value={form.unit} disabled={saving} onValueChange={(value) => change({ unit: value as AbsenceRequestPreviewInput['unit'], startTime: undefined, endTime: undefined })}>
            <SelectTrigger className="h-11 rounded-ds-btn border-ds-border-input bg-ds-surface"><SelectValue /></SelectTrigger>
            <SelectContent>{selected.units.map((unit) => <SelectItem key={unit} value={unit}>{unit === 'day' ? 'Dias' : 'Horas'}</SelectItem>)}</SelectContent>
          </Select>
        </label> : null}
        {selected ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Data de início<Input type="date" lang="pt-BR" value={form.startDate} disabled={saving} onChange={(event) => change({ startDate: event.target.value })} className="h-11 rounded-ds-btn" /></label>
          <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">{selected.calculation === 'calendar_days_until_return' && form.unit === 'day' ? 'Data de retorno' : 'Data de término'}<Input type="date" lang="pt-BR" value={form.endDate} disabled={saving} onChange={(event) => change({ endDate: event.target.value })} className="h-11 rounded-ds-btn" /></label>
          {form.unit === 'hour' ? <>
            <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Hora de início<Input type="time" value={form.startTime ?? ''} disabled={saving} onChange={(event) => change({ startTime: event.target.value })} className="h-11 rounded-ds-btn" /></label>
            <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Hora de término<Input type="time" value={form.endTime ?? ''} disabled={saving} onChange={(event) => change({ endTime: event.target.value })} className="h-11 rounded-ds-btn" /></label>
          </> : null}
        </div> : null}
        {form.unit === 'hour' && selected ? <p className="text-xs text-ds-ink-muted">Para um período que atravessa a noite, escolha a data seguinte no término.</p> : null}
        {selected ? <label className="block space-y-1.5 text-[12px] font-extrabold text-ds-ink">Motivo <span className="font-semibold text-ds-ink-muted">(opcional)</span>
          <textarea rows={3} maxLength={1000} value={reason} disabled={saving} onChange={(event) => { setReason(event.target.value); draftAttempt.current = null; }}
            placeholder="Ex.: consulta marcada às 9h, retorno ao trabalho às 13h." className="w-full rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 py-2 text-sm font-normal text-ds-ink" />
          <span className="block text-[11px] font-semibold text-ds-ink-muted">Mínimo de 10 caracteres quando preenchido. Visível só para você e quem analisa. Não descreva diagnóstico: o atestado vai no anexo.</span>
        </label> : null}
        {selected && canCreate ? fileInput : null}
        {editingRequest?.attachmentCount ? <p className="text-xs font-semibold text-ds-ink-muted">{editingRequest.attachmentCount} comprovante(s) já vinculado(s) serão preservados.</p> : null}
        {files.length ? <p className="text-xs text-ds-ink-muted">{files.length} arquivo(s) selecionado(s).</p> : null}
        {fieldError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{fieldError}</p> : null}
        {saveError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{saveError}</p> : null}
        <Button variant="primary-modal" onClick={conclude} disabled={!selected || calculating || saving || (canCreate && missingDocument)} loading={calculating} loadingLabel="Conferindo…">{canCreate ? 'Concluir' : 'Calcular prévia'}</Button>
        {canCreate && missingDocument ? <p className="text-xs text-ds-ink-muted">Anexe o documento exigido por este tipo para concluir.</p> : null}
        {calculationError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{calculationError}</p> : null}
      </>}
    </PanelSection> : null}

    {step === 'summary' && preview ? <>
      <PanelSection title="Resumo da solicitação">
        <div className="grid grid-cols-2 gap-4">
          <PanelField label="Tipo">{preview.absenceType.name}</PanelField>
          <PanelField label="Quantidade">{formatAbsenceQuantity(preview)}</PanelField>
          <PanelField label="Início">{formatRequestDate(preview.period.startDate)}{preview.period.startTime ? `, ${preview.period.startTime}` : ''}</PanelField>
          <PanelField label={preview.quantity.unit === 'day' && preview.quantity.calculation === 'calendar_days_until_return' ? 'Retorno' : 'Término'}>{formatRequestDate(preview.period.endDate)}{preview.period.endTime ? `, ${preview.period.endTime}` : ''}</PanelField>
          <div className="col-span-2"><PanelField label="Motivo">{trimmedReason || <span className="font-normal text-ds-ink-muted">Não informado</span>}</PanelField></div>
          <div className="col-span-2"><PanelField label="Comprovantes">{files.length ? files.map((file) => file.name).join(', ') : editingRequest?.attachmentCount ? `${editingRequest.attachmentCount} já vinculado(s)` : <span className="font-normal text-ds-ink-muted">Nenhum</span>}</PanelField></div>
          <PanelField label="Contagem">{preview.quantity.unit === 'hour' ? 'Horas corridas' : preview.quantity.calculation === 'scheduled_workdays' ? 'Dias previstos na escala' : preview.quantity.calculation === 'calendar_days_until_return' ? 'Dias corridos até o retorno' : 'Dias corridos, inclusive início e término'}</PanelField>
          <PanelField label="Regra aplicada">{preview.rule.name} · versão {preview.absenceType.version}</PanelField>
          <PanelField label="Aprovação prevista">{approvalLabels[preview.approvalFlow]}</PanelField>
        </div>
        {preview.tacitApprovalDays ? <p className="rounded-ds-md bg-ds-warn-bg px-3 py-2 text-xs text-ds-ink">
          Se ninguém analisar em <strong>{preview.tacitApprovalDays} {preview.tacitApprovalDays === 1 ? 'dia' : 'dias'}</strong>, cada etapa é aprovada automaticamente e o pedido mostra a tag <strong>“Aprovada por decurso de prazo”</strong>.
        </p> : null}
        {preview.instructions ? <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ds-ink-muted">{formatBrazilianRequestText(preview.instructions)}</p> : null}
      </PanelSection>
      <PanelSection title="Prazos e limites configurados">
        <div className="grid grid-cols-2 gap-4">
          <PanelField label="Por pedido">{preview.limits.maxUnitsPerRequest === null ? 'Sem teto configurado' : `${new Intl.NumberFormat('pt-BR').format(preview.limits.maxUnitsPerRequest)} ${unitLabel(preview.quantity.unit, preview.limits.maxUnitsPerRequest)}`}</PanelField>
          <PanelField label="Por período">{preview.limits.maxUnitsPerPeriod === null ? 'Sem teto configurado' : `${new Intl.NumberFormat('pt-BR').format(preview.limits.maxUnitsPerPeriod)} ${unitLabel(preview.quantity.unit, preview.limits.maxUnitsPerPeriod)} por ${preview.limits.limitPeriod === 'month' ? 'mês' : 'ano'}`}</PanelField>
          <PanelField label="Antecedência mínima">{preview.limits.minimumNoticeDays ?? 0} dia(s)</PanelField>
          <PanelField label="Retroatividade máxima">{preview.limits.maximumRetroactiveDays ?? 0} dia(s)</PanelField>
        </div>
      </PanelSection>
      {preview.pending.filter((item) => !canCreate || (item !== 'approval_and_submission_unavailable' && item !== 'document_required')).length ? <PanelSection title="Antes de solicitar"><ul className="list-disc space-y-1.5 pl-4 text-[12.5px] leading-5 text-ds-ink-muted">{preview.pending.filter((item) => !canCreate || (item !== 'approval_and_submission_unavailable' && item !== 'document_required')).map((item) => <li key={item}>{pendingLabels[item]}</li>)}</ul></PanelSection> : null}
      {preview.quantity.value === null ? <p className="text-xs text-ds-warn">A quantidade depende da escala e ainda não pode ser usada para criar um pedido.</p> : null}
      {saveError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{saveError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="ds-secondary" disabled={saving} onClick={() => setStep('form')}>Voltar e editar</Button>
        {canCreate ? <>
          <Button variant="ds-ghost" loading={saving} loadingLabel="Salvando…" disabled={saving || preview.quantity.value === null || preview.source !== 'coala-rh'} onClick={() => void saveDraft(false)}>{editingRequest ? 'Salvar revisão' : 'Salvar rascunho'}</Button>
          <Button variant="primary-modal" className="flex-1" loading={saving} loadingLabel="Enviando…" disabled={saving || preview.quantity.value === null || preview.source !== 'coala-rh' || missingDocument} onClick={() => void saveDraft(true)}>Enviar solicitação</Button>
        </> : null}
      </div>
    </> : null}
  </SidePanel>;
}
