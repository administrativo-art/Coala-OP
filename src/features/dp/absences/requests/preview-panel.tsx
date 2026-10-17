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

export function AbsencePreviewPanel({ open, onOpenChange, firebaseUser, beneficiaryUid, beneficiaryName, editingRequest, onDraftCreated }: {
  open: boolean;
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
  const draftAttempt = useRef<{ idempotencyKey: string; operationId: string; proposedRequestId: string; preparationIds: string[] } | null>(null);
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
    setForm(editingRequest?.input ?? { absenceTypeId: '', unit: 'day', startDate: '', endDate: '' });
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
  }, [open, loadOptions, editingRequest]);

  const selected = options.find((option) => option.id === form.absenceTypeId);

  const change = (patch: Partial<AbsenceRequestPreviewInput>) => {
    if (saving) return;
    sequence.current++;
    draftAttempt.current = null;
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
    setFiles([]);
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
      if (request === sequence.current) { setPreview(response.preview); previewSequence.current = request; }
    } catch (error) {
      if (request === sequence.current) setCalculationError(previewError(error, 'Não foi possível calcular a prévia.'));
    } finally {
      if (request === sequence.current) setCalculating(false);
    }
  };

  const saveDraft = async () => {
    if (!firebaseUser || !preview || !canCreate || saving || preview.quantity.value === null || preview.source !== 'coala-rh'
      || previewSequence.current !== sequence.current) return;
    if (preview.attachmentRequired && files.length + (editingRequest?.attachmentCount ?? 0) === 0) {
      setSaveError('Anexe o documento obrigatório antes de criar o rascunho.');
      return;
    }
    const requestSequence = sequence.current;
    const requestUid = firebaseUser.uid;
    const currentAttempt = draftAttempt.current ?? { idempotencyKey: crypto.randomUUID(), operationId: crypto.randomUUID(), proposedRequestId: crypto.randomUUID(), preparationIds: [] };
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
      if (editingRequest) {
        saved = await actOnAbsenceRequest(firebaseUser, editingRequest.id, { action: 'update_draft', expectedVersion: editingRequest.version,
          operationId: currentAttempt.operationId, request: form, ...(currentAttempt.preparationIds.length ? { preparationRef: currentAttempt.proposedRequestId } : {}),
          preparationIds: currentAttempt.preparationIds });
      } else {
        saved = await createAbsenceDraft(firebaseUser, { idempotencyKey: currentAttempt.idempotencyKey,
          proposedRequestId: currentAttempt.preparationIds.length ? currentAttempt.proposedRequestId : undefined,
          preparationIds: currentAttempt.preparationIds, request: form, ...(beneficiaryUid ? { beneficiaryUid } : {}) });
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

  return <SidePanel open={open} onOpenChange={(value) => { if (!saving) onOpenChange(value); }} kicker="Minhas solicitações" title={editingRequest ? 'Editar rascunho de ausência' : 'Prévia de ausência'} subtitle="Confira a regra e o período antes de preparar uma solicitação.">
    {beneficiaryName ? <p className="text-xs font-bold text-ds-ink">Solicitação para {beneficiaryName}</p> : null}
    <div className="rounded-ds-card border border-ds-info/20 bg-ds-info-bg p-4 text-[12.5px] leading-5 text-ds-info">
      {canCreate ? editingRequest ? 'A edição cria uma nova revisão do rascunho. Os comprovantes anteriores permanecem no histórico; o pedido só será enviado pelo detalhe.' : 'Calcule a prévia e confira a regra antes de salvar um rascunho. O pedido só será enviado por uma ação posterior no detalhe.' : 'Esta é apenas uma prévia: nenhum pedido será criado. Anexar documentos e enviar a solicitação ainda não estão disponíveis.'}
    </div>

    <PanelSection title="Período da ausência">
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
        {fieldError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{fieldError}</p> : null}
        <Button variant="primary-modal" onClick={() => void calculate()} disabled={!selected || calculating || saving} loading={calculating} loadingLabel="Calculando…">Calcular prévia</Button>
        {calculationError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{calculationError}</p> : null}
      </>}
    </PanelSection>

    {preview ? <>
      <PanelSection title="Resultado da prévia">
        <div className="grid grid-cols-2 gap-4">
          <PanelField label="Quantidade">{formatAbsenceQuantity(preview)}</PanelField>
          <PanelField label="Contagem">{preview.quantity.unit === 'hour' ? 'Horas corridas' : preview.quantity.calculation === 'scheduled_workdays' ? 'Dias previstos na escala' : preview.quantity.calculation === 'calendar_days_until_return' ? 'Dias corridos até o retorno' : 'Dias corridos, inclusive início e término'}</PanelField>
          <PanelField label="Início">{formatRequestDate(preview.period.startDate)}{preview.period.startTime ? `, ${preview.period.startTime}` : ''}</PanelField>
          <PanelField label={preview.quantity.unit === 'day' && preview.quantity.calculation === 'calendar_days_until_return' ? 'Retorno' : 'Término'}>{formatRequestDate(preview.period.endDate)}{preview.period.endTime ? `, ${preview.period.endTime}` : ''}</PanelField>
          <PanelField label="Regra aplicada">{preview.rule.name} · versão {preview.absenceType.version}</PanelField>
          <PanelField label="Aprovação prevista">{approvalLabels[preview.approvalFlow]}</PanelField>
          <PanelField label="Documento">{preview.attachmentRequired ? 'Obrigatório para criar o pedido' : 'Não obrigatório'}</PanelField>
        </div>
        {preview.instructions ? <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ds-ink-muted">{formatBrazilianRequestText(preview.instructions)}</p> : null}
      </PanelSection>
      <PanelSection title="Prazos e limites configurados">
        <div className="grid grid-cols-2 gap-4">
          <PanelField label="Por pedido">{preview.limits.maxUnitsPerRequest === null ? 'Sem teto configurado' : `${new Intl.NumberFormat('pt-BR').format(preview.limits.maxUnitsPerRequest)} ${unitLabel(preview.quantity.unit, preview.limits.maxUnitsPerRequest)}`}</PanelField>
          <PanelField label="Por período">{preview.limits.maxUnitsPerPeriod === null ? 'Sem teto configurado' : `${new Intl.NumberFormat('pt-BR').format(preview.limits.maxUnitsPerPeriod)} ${unitLabel(preview.quantity.unit, preview.limits.maxUnitsPerPeriod)} por ${preview.limits.limitPeriod === 'month' ? 'mês' : 'ano'}`}</PanelField>
          <PanelField label="Antecedência mínima">{preview.limits.minimumNoticeDays ?? 0} dia(s)</PanelField>
          <PanelField label="Retroatividade máxima">{preview.limits.maximumRetroactiveDays ?? 0} dia(s)</PanelField>
        </div>
        <p className="text-xs text-ds-ink-muted">Estes são os limites da regra. O saldo disponível ainda não foi verificado.</p>
      </PanelSection>
      <PanelSection title="Antes de solicitar"><ul className="list-disc space-y-1.5 pl-4 text-[12.5px] leading-5 text-ds-ink-muted">{preview.pending.filter((item) => !canCreate || item !== 'approval_and_submission_unavailable').map((item) => <li key={item}>{canCreate && item === 'document_required' ? 'Anexe o documento obrigatório antes de salvar o rascunho.' : pendingLabels[item]}</li>)}</ul></PanelSection>
      {canCreate ? <PanelSection title="Preparar rascunho">
        <p className="text-xs text-ds-ink-muted">Até cinco comprovantes no total, em PDF, JPEG ou PNG, com 10 MB por arquivo. O acesso ao conteúdo é restrito ao titular e aos responsáveis autorizados.</p>
        {editingRequest?.attachmentCount ? <p className="text-xs font-semibold text-ds-ink-muted">{editingRequest.attachmentCount} comprovante(s) já vinculado(s) serão preservados.</p> : null}
        <label className="block space-y-1.5 text-xs font-bold text-ds-ink">Comprovantes {preview.attachmentRequired ? '(obrigatórios)' : '(opcionais)'}
          <Input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple disabled={saving} onChange={(event) => selectFiles(Array.from(event.target.files ?? []))} className="h-11 rounded-ds-btn" />
        </label>
        {files.length ? <p className="text-xs text-ds-ink-muted">{files.length} arquivo(s) selecionado(s).</p> : null}
        {preview.quantity.value === null ? <p className="text-xs text-ds-warn">A quantidade depende da escala e ainda não pode ser usada para criar um pedido.</p> : null}
        {saveError ? <p role="alert" className="text-xs font-semibold text-ds-danger">{saveError}</p> : null}
        <Button variant="primary-modal" loading={saving} loadingLabel="Salvando…" disabled={saving || preview.quantity.value === null || preview.source !== 'coala-rh'} onClick={() => void saveDraft()}>{editingRequest ? 'Salvar revisão' : 'Salvar rascunho'}</Button>
      </PanelSection> : null}
    </> : null}
  </SidePanel>;
}
