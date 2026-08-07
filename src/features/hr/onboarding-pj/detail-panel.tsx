'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowLeft, Building2, Check, CheckCircle2, Circle, Clock3,
  Download, ExternalLink, FileCheck2, FileText, KeyRound, Loader2, Mail,
  RefreshCw, RotateCcw, Send, Settings2, ShieldCheck, WalletCards, XCircle,
} from 'lucide-react';

import { PJ_ONBOARDING_STEP_LABELS, PJ_ONBOARDING_STEP_ORDER } from '@/features/hr/onboarding-pj/core';
import { ONBOARDING_HEALTH_META, resolveOnboardingOperationalStatus } from '@/features/hr/onboarding/operational-status';
import type { DPUnit, OnboardingDocument, OnboardingProcess, PjOnboardingStepId } from '@/types';

type CatalogItem = { id: string; name: string };

function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function money(value: number | undefined) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0); }
function date(value: string | null | undefined) { return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'; }
function cpfCnpj(value: string | null | undefined) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return value || '—';
}
function stepState(process: OnboardingProcess, step: PjOnboardingStepId) { return process.pjWorkflow?.steps?.[step]?.status ?? 'pending'; }

const INPUT = 'mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const LABEL = 'text-[11px] font-black uppercase tracking-wide text-slate-500';
const PRIMARY = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-xs font-black text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export function PjOnboardingDetailPanel({
  process,
  units,
  canManage,
  getToken,
  onRefresh,
  onBack,
}: {
  process: OnboardingProcess;
  units: DPUnit[];
  canManage: boolean;
  getToken: () => Promise<string>;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const workflow = process.pjWorkflow;
  const [selectedStep, setSelectedStep] = useState<PjOnboardingStepId>(workflow?.currentStep ?? 'contract_definition');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [correctionDocuments, setCorrectionDocuments] = useState<string[]>([]);
  const [financeNote, setFinanceNote] = useState('');
  const [profiles, setProfiles] = useState<CatalogItem[]>([]);
  const [pdvProfiles, setPdvProfiles] = useState<CatalogItem[]>([]);
  const [contractForm, setContractForm] = useState(() => ({
    name: workflow?.contract?.contractorRepresentative?.name ?? '',
    email: workflow?.contract?.contractorRepresentative?.email ?? '',
    role: workflow?.contract?.contractorRepresentative?.role ?? '',
    qualification: workflow?.contract?.contractorRepresentative?.qualification ?? '',
    cpf: workflow?.contract?.contractorRepresentative?.cpf ?? '',
    professionalId: workflow?.contract?.contractorRepresentative?.professionalId ?? '',
    signatureCity: workflow?.contract?.signatureCity ?? 'Belém/PA',
    forumCity: workflow?.contract?.forumCity ?? 'Belém/PA',
  }));
  const answers = process.publicFormAnswers ?? {};
  const [accessForm, setAccessForm] = useState(() => ({
    userName: workflow?.access?.userName ?? text(answers.representativeName),
    userCpf: workflow?.access?.userCpf ?? text(answers.representativeCpf),
    profileId: workflow?.access?.profileId ?? '',
    unitIds: workflow?.access?.unitIds ?? [],
    pdvRequired: workflow?.access?.pdvRequired ?? false,
    pdvUnitId: workflow?.access?.pdvUnitId ?? '',
    pdvProfileId: workflow?.access?.pdvProfileId ?? '',
  }));

  useEffect(() => { if (workflow?.currentStep) setSelectedStep(workflow.currentStep); }, [workflow?.currentStep]);
  useEffect(() => {
    if (selectedStep !== 'access_configuration') return;
    let active = true;
    void (async () => {
      try {
        const token = await getToken();
        const response = await fetch('/api/hr/onboarding/access-catalog', { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Falha ao carregar perfis.');
        if (active) setProfiles(Array.isArray(payload.profiles) ? payload.profiles : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar perfis.'); }
    })();
    return () => { active = false; };
  }, [getToken, selectedStep]);
  useEffect(() => {
    if (!accessForm.pdvRequired) return;
    let active = true;
    void (async () => {
      try {
        const token = await getToken();
        const response = await fetch('/api/hr/integrations/pdvlegal/catalog', { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Falha ao carregar o PDV Legal.');
        if (active) setPdvProfiles(Array.isArray(payload.profiles) ? payload.profiles : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar o PDV Legal.'); }
    })();
    return () => { active = false; };
  }, [accessForm.pdvRequired, getToken]);

  const activeUnits = useMemo(() => units.filter(unit => !unit.isArchived).sort((a, b) => a.name.localeCompare(b.name)), [units]);
  if (!workflow) return <div className="rounded-xl border bg-white p-6 text-sm font-bold text-red-700">Fluxo PJ não encontrado.</div>;

  async function run(action: string, body: Record<string, unknown> = {}, route = 'pj-workflow') {
    setBusy(action); setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/hr/onboarding/${process.id}${route ? `/${route}` : ''}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Não foi possível concluir a ação.');
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a ação.'); }
    finally { setBusy(null); }
  }

  async function downloadAsset(asset: 'contract' | 'signed_contract') {
    setBusy(asset); setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/hr/onboarding/${process.id}/pj-workflow?asset=${asset}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? 'Arquivo indisponível.'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener'; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Arquivo indisponível.'); }
    finally { setBusy(null); }
  }

  const documents = (process.documents ?? []) as OnboardingDocument[];
  const currentIndex = PJ_ONBOARDING_STEP_ORDER.indexOf(workflow.currentStep);
  const completedSteps = PJ_ONBOARDING_STEP_ORDER.filter(step => stepState(process, step) === 'completed').length;
  const operationalStatus = resolveOnboardingOperationalStatus(process);
  const healthMeta = ONBOARDING_HEALTH_META[operationalStatus.health];
  const canOpenStep = (step: PjOnboardingStepId) => PJ_ONBOARDING_STEP_ORDER.indexOf(step) <= currentIndex || stepState(process, step) === 'completed';

  function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>; }
  function Header({ title, description }: { title: string; description: string }) { return <div className="mb-5"><p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-700">Etapa {PJ_ONBOARDING_STEP_ORDER.indexOf(selectedStep) + 1} de 8</p><h2 className="mt-1 text-lg font-black text-slate-950">{title}</h2><p className="mt-1 text-xs font-semibold leading-relaxed text-slate-500">{description}</p></div>; }
  function ActionButton({ action, children, onClick, disabled, secondary = false }: { action: string; children: React.ReactNode; onClick: () => void; disabled?: boolean; secondary?: boolean }) {
    return <button type="button" disabled={!canManage || busy !== null || disabled} onClick={onClick} className={secondary ? SECONDARY : PRIMARY}>{busy === action ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{children}</button>;
  }

  let content: React.ReactNode;
  if (selectedStep === 'contract_definition') {
    content = <Card><Header title="Definição da contratação" description="Dados definidos pelo RH na abertura do processo. Eles alimentam o contrato e não serão solicitados novamente à prestadora." />
      <div className="grid gap-3 text-xs md:grid-cols-3">
        <Info label="Prestadora" value={workflow.provider.legalName} detail={workflow.provider.tradeName ?? undefined} />
        <Info label="CNPJ" value={cpfCnpj(workflow.provider.cnpj)} />
        <Info label="E-mail único" value={workflow.provider.email} />
        <Info label="Contratante" value={process.employerUnitName ?? '—'} />
        <Info label="Vigência" value={`${date(workflow.terms.contractStartDate)}${workflow.terms.termType === 'fixed' ? ` a ${date(workflow.terms.contractEndDate)}` : ' · indeterminada'}`} />
        <Info label="Condição financeira" value={`${money(workflow.terms.monthlyValue)} · dia ${workflow.terms.paymentDay}`} detail="Nota fiscal obrigatória" />
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className={LABEL}>Frentes e entregáveis</p><div className="mt-2 space-y-2">{workflow.terms.serviceItems.map((item, index) => <div key={item.id} className="grid gap-1 rounded-lg bg-white px-3 py-2 text-xs md:grid-cols-[40px_1fr_1.4fr]"><strong>1.{index + 1}</strong><strong>{item.front}</strong><span>{item.deliverable}</span></div>)}</div></div>
    </Card>;
  } else if (selectedStep === 'provider_registration') {
    const publicUrl = process.publicToken ? `https://vagas.coalashakes.com/onboarding/${process.publicToken}` : null;
    content = <Card><Header title="Cadastro da empresa prestadora" description="A prestadora recebe o link no único e-mail informado, preenche seus dados, informa o representante, os dados bancários e envia os documentos." />
      <div className="grid gap-3 md:grid-cols-3"><Info label="Destinatário" value={workflow.provider.email} /><Info label="Situação" value={process.publicFormSubmittedAt ? 'Cadastro recebido' : 'Aguardando envio'} /><Info label="Prazo do link" value={process.publicTokenExpiresAt ? new Date(process.publicTokenExpiresAt).toLocaleString('pt-BR') : 'Encerrado'} /></div>
      {workflow.steps.provider_registration.note ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900"><strong>Correção solicitada:</strong> {workflow.steps.provider_registration.note}</div> : null}
      {publicUrl ? <a href={publicUrl} target="_blank" rel="noreferrer" className={`${SECONDARY} mt-4`}><ExternalLink className="h-4 w-4" />Abrir formulário externo</a> : null}
    </Card>;
  } else if (selectedStep === 'registration_review') {
    content = <Card><Header title="Conferência cadastral pelo RH" description="Confira os dados e cada arquivo antes de liberar a geração do contrato. A devolutiva reabre apenas o que precisar de correção." />
      <div className="grid gap-3 text-xs md:grid-cols-3"><Info label="Representante" value={text(answers.representativeName) || '—'} detail={cpfCnpj(text(answers.representativeCpf))} /><Info label="Endereço" value={text(answers.companyAddress) || '—'} /><Info label="Recebimento" value={text(answers.bankMethod) === 'pix' ? `Pix · ${text(answers.pixKey)}` : `${text(answers.bankName)} · ag. ${text(answers.bankAgency)} · ${text(answers.bankAccount)}`} /></div>
      <div className="mt-5 space-y-2">{documents.map(document => {
        const hasFile = Boolean(document.fileUrl || document.filePath);
        return <div key={document.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3">
          <input type="checkbox" checked={correctionDocuments.includes(document.id)} onChange={event => setCorrectionDocuments(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))} />
          <div className="min-w-[180px] flex-1"><p className="text-xs font-black text-slate-800">{document.label}{document.required === false ? ' · opcional' : ''}</p><p className="text-[10px] font-bold text-slate-500">{document.status === 'approved' ? 'Aprovado' : document.status === 'rejected' ? 'Correção solicitada' : hasFile ? 'Recebido' : 'Não enviado'}</p></div>
          {document.fileUrl ? <a href={document.fileUrl} target="_blank" rel="noreferrer" className={SECONDARY}><ExternalLink className="h-3.5 w-3.5" />Abrir</a> : null}
          <ActionButton action={`approve-${document.id}`} secondary disabled={!hasFile || document.status === 'approved'} onClick={() => run('set_document_status', { documentId: document.id, status: 'approved' })}><Check className="h-3.5 w-3.5" />Aprovar</ActionButton>
          <ActionButton action={`reject-${document.id}`} secondary disabled={!hasFile || document.status === 'rejected'} onClick={() => run('set_document_status', { documentId: document.id, status: 'rejected', note: 'Documento precisa ser substituído.' })}><XCircle className="h-3.5 w-3.5" />Reprovar</ActionButton>
        </div>;
      })}</div>
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3"><label className="text-[11px] font-black text-amber-900">Devolutiva para a prestadora<textarea value={correctionMessage} onChange={event => setCorrectionMessage(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-800" placeholder="Descreva com clareza o que deve ser corrigido." /></label><div className="mt-2"><ActionButton action="request_corrections" secondary disabled={!correctionMessage.trim()} onClick={() => run('request_corrections', { message: correctionMessage, documentIds: correctionDocuments })}><RotateCcw className="h-4 w-4" />Solicitar correções</ActionButton></div></div>
      <div className="mt-5 flex justify-end"><ActionButton action="approve_registration" onClick={() => run('approve_registration')}><ShieldCheck className="h-4 w-4" />Aprovar cadastro e documentos</ActionButton></div>
    </Card>;
  } else if (selectedStep === 'contract_preparation') {
    content = <Card><Header title="Preparação e revisão do contrato" description="O sistema monta o contrato único com o cadastro aprovado e o Anexo I de frentes e entregáveis. A multa já está fixada no modelo." />
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Representante da contratante" value={contractForm.name} onChange={value => setContractForm(current => ({ ...current, name: value }))} />
        <Field label="E-mail do representante" type="email" value={contractForm.email} onChange={value => setContractForm(current => ({ ...current, email: value }))} />
        <Field label="Cargo do representante" value={contractForm.role} onChange={value => setContractForm(current => ({ ...current, role: value }))} placeholder="Ex.: sócio-administrador" />
        <Field label="Qualificação" value={contractForm.qualification} onChange={value => setContractForm(current => ({ ...current, qualification: value }))} placeholder="Ex.: brasileiro, empresário, casado" />
        <Field label="CPF" value={contractForm.cpf} onChange={value => setContractForm(current => ({ ...current, cpf: value }))} />
        <Field label="Registro profissional (opcional)" value={contractForm.professionalId} onChange={value => setContractForm(current => ({ ...current, professionalId: value }))} />
        <Field label="Cidade da assinatura" value={contractForm.signatureCity} onChange={value => setContractForm(current => ({ ...current, signatureCity: value }))} />
        <Field label="Foro" value={contractForm.forumCity} onChange={value => setContractForm(current => ({ ...current, forumCity: value }))} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton action="save_contract_settings" secondary onClick={() => run('save_contract_settings', { contractorRepresentative: contractForm, signatureCity: contractForm.signatureCity, forumCity: contractForm.forumCity })}><Settings2 className="h-4 w-4" />Salvar dados</ActionButton>
        <ActionButton action="generate_contract" onClick={() => run('generate_contract')}><FileText className="h-4 w-4" />{workflow.contract?.status === 'draft' ? 'Gerar nova versão' : 'Gerar minuta'}</ActionButton>
        {workflow.contract?.storagePath ? <ActionButton action="contract" secondary onClick={() => downloadAsset('contract')}><Download className="h-4 w-4" />Visualizar minuta v{workflow.contract.version}</ActionButton> : null}
        <ActionButton action="approve_contract" disabled={workflow.contract?.status !== 'draft'} onClick={() => run('approve_contract')}><FileCheck2 className="h-4 w-4" />Aprovar minuta</ActionButton>
      </div>
    </Card>;
  } else if (selectedStep === 'contract_signature') {
    content = <Card><Header title="Assinaturas do contrato" description="O contrato é enviado para exatamente dois signatários: o representante da contratante e o representante da prestadora, sem testemunhas." />
      <div className="grid gap-3 md:grid-cols-2"><Info label="Contratante" value={workflow.contract?.contractorRepresentative?.name ?? '—'} detail={workflow.contract?.contractorRepresentative?.email ?? undefined} /><Info label="Prestadora" value={text(answers.representativeName) || '—'} detail={workflow.provider.email} /></div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">Situação: <strong className="text-slate-950">{workflow.contract?.status === 'signed' ? 'Contrato assinado' : workflow.contract?.status === 'sent' ? 'Aguardando assinaturas' : 'Pronto para envio'}</strong></div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton action="send_contract" disabled={workflow.contract?.status !== 'approved'} onClick={() => run('send_contract')}><Send className="h-4 w-4" />Enviar para assinatura</ActionButton>
        <ActionButton action="reconcile_contract" secondary disabled={!workflow.contract?.providerDocumentId || workflow.contract?.status === 'signed'} onClick={() => run('reconcile_contract')}><RefreshCw className="h-4 w-4" />Atualizar assinaturas</ActionButton>
        {workflow.contract?.signedStoragePath ? <ActionButton action="signed_contract" secondary onClick={() => downloadAsset('signed_contract')}><Download className="h-4 w-4" />Contrato assinado</ActionButton> : null}
      </div>
    </Card>;
  } else if (selectedStep === 'financial_registration') {
    content = <Card><Header title="Cadastro financeiro e fiscal" description="Com o contrato assinado, o Financeiro recebe os dados bancários e fiscais para cadastrar a prestadora. A nota fiscal permanece obrigatória para cada pagamento." />
      <div className="grid gap-3 md:grid-cols-3"><Info label="Prestadora" value={workflow.provider.legalName} detail={cpfCnpj(workflow.provider.cnpj)} /><Info label="Recebimento" value={text(answers.bankMethod) === 'pix' ? `Pix · ${text(answers.pixKey)}` : `${text(answers.bankName)} · ${text(answers.bankAccount)}`} /><Info label="Situação" value={workflow.finance?.status === 'approved' ? 'Aprovado' : workflow.finance?.status === 'submitted' ? 'Em análise' : workflow.finance?.status === 'correction_required' ? 'Com devolutiva' : 'Não enviado'} /></div>
      {workflow.finance?.note ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{workflow.finance.note}</div> : null}
      <label className={`${LABEL} mt-4 block`}>Observação do Financeiro<textarea value={financeNote} onChange={event => setFinanceNote(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-xs normal-case tracking-normal text-slate-800" /></label>
      <div className="mt-4 flex flex-wrap gap-2"><ActionButton action="submit_finance" disabled={workflow.finance?.status === 'submitted' || workflow.finance?.status === 'approved'} onClick={() => run('submit_finance')}><WalletCards className="h-4 w-4" />{workflow.finance?.status === 'correction_required' ? 'Reenviar ao Financeiro' : 'Enviar ao Financeiro'}</ActionButton><ActionButton action="finance_return" secondary disabled={workflow.finance?.status !== 'submitted' || !financeNote.trim()} onClick={() => run('finance_return', { note: financeNote })}><RotateCcw className="h-4 w-4" />Devolver ao RH</ActionButton><ActionButton action="finance_approve" disabled={workflow.finance?.status !== 'submitted'} onClick={() => run('finance_approve', { note: financeNote })}><CheckCircle2 className="h-4 w-4" />Aprovar cadastro</ActionButton></div>
    </Card>;
  } else if (selectedStep === 'access_configuration') {
    content = <Card><Header title="Configuração de acessos" description="O Coala One é obrigatório. O RH define quem acessará pela prestadora, o perfil e as unidades. O PDV Legal é habilitado apenas quando necessário." />
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-semibold text-violet-900"><strong>Coala One obrigatório.</strong> O link para criar a senha será enviado ao mesmo e-mail usado em todo o processo: {workflow.provider.email}.</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="Nome do usuário" value={accessForm.userName} onChange={value => setAccessForm(current => ({ ...current, userName: value }))} /><Field label="CPF do usuário" value={accessForm.userCpf} onChange={value => setAccessForm(current => ({ ...current, userCpf: value }))} />
        <label className={LABEL}>Perfil no Coala One<select value={accessForm.profileId} onChange={event => setAccessForm(current => ({ ...current, profileId: event.target.value }))} className={INPUT}><option value="">Selecione</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <div><p className={LABEL}>Unidades liberadas</p><div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">{activeUnits.map(unit => <label key={unit.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold hover:bg-slate-50"><input type="checkbox" checked={accessForm.unitIds.includes(unit.id)} onChange={event => setAccessForm(current => ({ ...current, unitIds: event.target.checked ? [...current.unitIds, unit.id] : current.unitIds.filter(id => id !== unit.id) }))} />{unit.name}</label>)}</div></div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-200 p-3"><label className="flex items-center gap-2 text-xs font-black text-slate-800"><input type="checkbox" checked={accessForm.pdvRequired} onChange={event => setAccessForm(current => ({ ...current, pdvRequired: event.target.checked }))} />Precisa do PDV Legal?</label>{accessForm.pdvRequired ? <div className="mt-3 grid gap-3 md:grid-cols-2"><label className={LABEL}>Unidade<select value={accessForm.pdvUnitId} onChange={event => setAccessForm(current => ({ ...current, pdvUnitId: event.target.value }))} className={INPUT}><option value="">Selecione</option>{activeUnits.filter(unit => accessForm.unitIds.includes(unit.id)).map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className={LABEL}>Perfil no PDV Legal<select value={accessForm.pdvProfileId} onChange={event => setAccessForm(current => ({ ...current, pdvProfileId: event.target.value }))} className={INPUT}><option value="">Selecione</option>{pdvProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div> : null}</div>
      <div className="mt-5 flex flex-wrap gap-2"><ActionButton action="save_access" secondary onClick={() => run('save_access', accessForm)}><Settings2 className="h-4 w-4" />Salvar configuração</ActionButton><ActionButton action="create_collaborator" disabled={workflow.access?.status !== 'configured' || Boolean(process.collaboratorUserId)} onClick={() => run('create_collaborator', {}, '')}><KeyRound className="h-4 w-4" />Criar acesso e enviar link</ActionButton></div>
      {process.collaboratorUserId ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">Usuário criado. E-mail: {process.accessProvisioning?.email?.status ?? 'enviado'} · primeiro acesso: {process.firstAccess?.status ?? 'pendente'}.</div> : null}
    </Card>;
  } else {
    const firstAccessDone = process.firstAccess?.status === 'used';
    const pdvDone = !workflow.access?.pdvRequired || process.pdvAccess?.status === 'completed';
    content = <Card><Header title="Ativação da prestadora" description="A ativação encerra a integração depois que a pessoa indicada criou a senha do Coala One e, quando solicitado, concluiu também o primeiro acesso ao PDV Legal." />
      <div className="space-y-2"><CheckRow done={Boolean(process.collaboratorUserId)} label="Usuário do Coala One criado" /><CheckRow done={firstAccessDone} label="Senha do Coala One cadastrada" /><CheckRow done={pdvDone} label={workflow.access?.pdvRequired ? 'Acesso ao PDV Legal criado' : 'PDV Legal não necessário'} /><CheckRow done={workflow.contract?.status === 'signed'} label="Contrato assinado e arquivado" /><CheckRow done={workflow.finance?.status === 'approved'} label="Cadastro financeiro e fiscal aprovado" /></div>
      <div className="mt-5 flex flex-wrap gap-2"><ActionButton action="activate" disabled={!firstAccessDone || !pdvDone} onClick={() => run('activate')}><CheckCircle2 className="h-4 w-4" />Ativar prestadora e concluir</ActionButton><button type="button" onClick={onRefresh} className={SECONDARY}><RefreshCw className="h-4 w-4" />Atualizar situação</button></div>
    </Card>;
  }

  return <div className="w-full space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className={SECONDARY}><ArrowLeft className="h-4 w-4" />Voltar às integrações</button><span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] font-black uppercase tracking-wide ${healthMeta.badgeClass}`}><span className={`h-2 w-2 rounded-full ${healthMeta.dotClass}`} />{healthMeta.label}</span></div>
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_-14px_rgba(15,23,42,0.2)]">
      <div className="flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-violet-700 text-white"><Building2 className="h-5 w-5" /></span>
          <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.1em] text-violet-700">Integração de prestadora · PJ</p><h1 className="mt-1 text-xl font-black tracking-tight text-slate-950">{workflow.provider.legalName}</h1><p className="mt-1 break-all text-xs font-semibold text-slate-500">{cpfCnpj(workflow.provider.cnpj)} · {workflow.provider.email}</p><p className="mt-2 text-xs font-bold text-slate-600">Contratante: {process.employerUnitName ?? 'Não definida'} · início {date(workflow.terms.contractStartDate)}</p></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-center"><p className="text-[9px] font-black uppercase text-slate-400">Concluídas</p><p className="mt-1 text-lg font-black text-emerald-600">{completedSteps}</p></div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-center"><p className="text-[9px] font-black uppercase text-slate-400">Etapa</p><p className="mt-1 text-lg font-black text-violet-700">{Math.max(1, currentIndex + 1)}/8</p></div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-center"><p className="text-[9px] font-black uppercase text-slate-400">Documentos</p><p className="mt-1 text-lg font-black text-slate-800">{documents.filter(item => Boolean(item.fileUrl || item.filePath)).length}/{documents.length}</p></div>
        </div>
      </div>
      <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
        <div className={`rounded-2xl border p-4 ${healthMeta.badgeClass}`}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${healthMeta.dotClass}`} /><div><p className="text-[10px] font-black uppercase tracking-[0.08em] opacity-70">O que falta para avançar</p><p className="mt-1 text-sm font-black">{operationalStatus.headline}</p><p className="mt-1 text-xs font-semibold leading-relaxed opacity-80">{operationalStatus.detail}</p></div></div>{operationalStatus.daysInStage > 0 ? <span className="rounded-lg border border-current/20 bg-white/70 px-2.5 py-1.5 text-[10.5px] font-black">{operationalStatus.daysInStage}d na etapa</span> : null}</div>
        </div>
      </div>
    </section>
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="mb-3 rounded-xl bg-violet-700 p-3 text-white"><div className="flex items-center gap-2"><Building2 className="h-4 w-4" /><span className="text-[10px] font-black uppercase tracking-wider">Integração PJ</span></div><p className="mt-2 text-xs font-semibold opacity-85">Oito etapas, sem rotinas trabalhistas de CLT.</p></div><nav className="space-y-1">{PJ_ONBOARDING_STEP_ORDER.map((step, index) => {
        const state = stepState(process, step); const selected = selectedStep === step; const enabled = canOpenStep(step);
        return <button key={step} type="button" disabled={!enabled} onClick={() => setSelectedStep(step)} className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition ${selected ? 'bg-violet-50 text-violet-900 ring-1 ring-violet-200' : enabled ? 'text-slate-700 hover:bg-slate-50' : 'cursor-not-allowed text-slate-300'}`}>
          <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-black ${state === 'completed' ? 'bg-emerald-500 text-white' : state === 'active' || state === 'correction_required' ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-400'}`}>{state === 'completed' ? <Check className="h-3 w-3" /> : index + 1}</span><span><span className="block text-[11px] font-black leading-snug">{PJ_ONBOARDING_STEP_LABELS[step]}</span>{state === 'correction_required' ? <span className="text-[9px] font-bold text-amber-700">Correção solicitada</span> : null}</span>
        </button>;
      })}</nav></aside>
      <main>{error ? <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}{content}</main>
    </div>
  </div>;
}

function Info({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) { return <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className={LABEL}>{label}</p><p className="mt-1 text-xs font-black text-slate-900">{value}</p>{detail ? <p className="mt-1 text-[10px] font-semibold text-slate-500">{detail}</p> : null}</div>; }
function Field({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <label className={LABEL}>{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={INPUT} /></label>; }
function CheckRow({ done, label }: { done: boolean; label: string }) { return <div className={`flex items-center gap-3 rounded-xl border p-3 text-xs font-black ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}{label}</div>; }
