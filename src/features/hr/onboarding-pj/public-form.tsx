"use client";

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Paperclip, Send, X } from 'lucide-react';

type PublicDocument = {
  id: string;
  label: string;
  description?: string | null;
  required?: boolean;
  status?: string;
  fileUrl?: string | null;
};

export type PjPublicOnboardingData = {
  id: string;
  candidateEmail?: string | null;
  providerCnpj?: string | null;
  providerLegalName?: string | null;
  providerTradeName?: string | null;
  employerUnitName?: string | null;
  publicFormAnswers?: Record<string, unknown>;
  documents?: PublicDocument[];
  publicTokenExpiresAt?: string | null;
  pjWorkflow?: {
    terms?: {
      contractStartDate?: string;
      termType?: 'fixed' | 'indefinite';
      contractEndDate?: string | null;
      monthlyValue?: number;
      paymentDay?: number;
      serviceItems?: Array<{ id: string; front: string; deliverable: string; order: number }>;
    };
  } | null;
  privacyNotice?: {
    version: string;
    hash: string;
    title: string;
    summary: string;
    text: string;
    acknowledgementText: string;
    confirmationNote: string;
  };
  publicPrivacyAcceptance?: { noticeVersion?: string; noticeHash?: string; acknowledged?: boolean; lastProtocol?: string } | null;
};

type Answers = {
  companyAddress: string;
  companyPhone: string;
  municipalRegistration: string;
  stateRegistration: string;
  representativeName: string;
  representativeCpf: string;
  representativeQualification: string;
  authoritySource: 'social_contract' | 'power_of_attorney' | '';
  bankMethod: 'pix' | 'bank' | '';
  bankHolderName: string;
  bankHolderDocument: string;
  pixKey: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  notes: string;
  dataAccuracyConfirmed: boolean;
  representationAuthorityConfirmed: boolean;
  invoiceAcknowledged: boolean;
};

function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function bool(value: unknown) { return value === true; }
function cpf(value: string) {
  return value.replace(/\D/g, '').slice(0, 11).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}
function cpfCnpj(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) return cpf(digits);
  return digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\/\d{4})(\d)/, '$1-$2');
}
function money(value: number | undefined) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0); }
function date(value: string | null | undefined) { return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'; }

const EMPTY: Answers = {
  companyAddress: '', companyPhone: '', municipalRegistration: '', stateRegistration: '',
  representativeName: '', representativeCpf: '', representativeQualification: '', authoritySource: '',
  bankMethod: '', bankHolderName: '', bankHolderDocument: '', pixKey: '', bankName: '', bankAgency: '', bankAccount: '', notes: '',
  dataAccuracyConfirmed: false, representationAuthorityConfirmed: false, invoiceAcknowledged: false,
};

export function PjPublicOnboardingForm({
  token,
  data,
  expired,
  onUpdated,
}: {
  token: string;
  data: PjPublicOnboardingData;
  expired: boolean;
  onUpdated: (data: PjPublicOnboardingData) => void;
}) {
  const saved = data.publicFormAnswers ?? {};
  const [answers, setAnswers] = useState<Answers>(() => ({
    ...EMPTY,
    companyAddress: text(saved.companyAddress),
    companyPhone: text(saved.companyPhone),
    municipalRegistration: text(saved.municipalRegistration),
    stateRegistration: text(saved.stateRegistration),
    representativeName: text(saved.representativeName),
    representativeCpf: cpf(text(saved.representativeCpf)),
    representativeQualification: text(saved.representativeQualification),
    authoritySource: ['social_contract', 'power_of_attorney'].includes(text(saved.authoritySource)) ? text(saved.authoritySource) as Answers['authoritySource'] : '',
    bankMethod: ['pix', 'bank'].includes(text(saved.bankMethod)) ? text(saved.bankMethod) as Answers['bankMethod'] : '',
    bankHolderName: text(saved.bankHolderName),
    bankHolderDocument: cpfCnpj(text(saved.bankHolderDocument)),
    pixKey: text(saved.pixKey), bankName: text(saved.bankName), bankAgency: text(saved.bankAgency), bankAccount: text(saved.bankAccount), notes: text(saved.notes),
    dataAccuracyConfirmed: bool(saved.dataAccuracyConfirmed), representationAuthorityConfirmed: bool(saved.representationAuthorityConfirmed), invoiceAcknowledged: bool(saved.invoiceAcknowledged),
  }));
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(Boolean(data.publicPrivacyAcceptance?.acknowledged));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terms = data.pjWorkflow?.terms;
  const documents = useMemo(() => (data.documents ?? []).map(document => document.id === 'power_of_attorney'
    ? { ...document, required: answers.authoritySource === 'power_of_attorney' }
    : document), [answers.authoritySource, data.documents]);
  const set = (key: keyof Answers) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setAnswers(current => ({ ...current, [key]: event.target.value }));

  function chooseFile(id: string, file: File | null) {
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return setError('Envie somente PDF, JPG ou PNG.');
    if (file.size > 10 * 1024 * 1024) return setError('O arquivo ultrapassa o limite de 10 MB.');
    setError(null); setFiles(current => ({ ...current, [id]: file }));
  }

  async function upload(id: string, file: File) {
    const body = new FormData(); body.append('file', file); body.append('onboardingToken', token); body.append('onboardingDocumentId', id); body.append('website', '');
    const response = await fetch('/api/hr/upload', { method: 'POST', body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Falha ao enviar documento.');
    return { fileUrl: payload.url, filePath: payload.path, sha256: payload.sha256 };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(null); setSubmitted(false);
    try {
      const uploaded = await Promise.all(Object.entries(files).filter((entry): entry is [string, File] => entry[1] instanceof File).map(async ([id, file]) => [id, await upload(id, file)] as const));
      const response = await fetch(`/api/hr/onboarding/public/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, documents: Object.fromEntries(uploaded), privacyAcceptance: { noticeVersion: data.privacyNotice?.version, noticeHash: data.privacyNotice?.hash, acknowledged: privacyAcknowledged }, website: '' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Falha ao enviar o cadastro.');
      setFiles({}); setSubmitted(true); onUpdated(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Falha ao enviar o cadastro.'); }
    finally { setSubmitting(false); }
  }

  return <div className="min-h-screen bg-[#F4ECD8] px-4 py-8 text-[#2A1F2A]">
    <main className="mx-auto max-w-4xl rounded-[28px] border border-[#2A1F2A]/10 bg-white p-5 shadow-xl md:p-8">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#EE6FA8]">Integração de prestadora PJ</p>
      <h1 className="mt-2 text-2xl font-black">Complete o cadastro da empresa</h1>
      <p className="mt-2 text-sm font-semibold text-[#5B4C5B]">Os dados serão conferidos pelo RH antes da geração do contrato.</p>

      <section className="mt-6 rounded-2xl border bg-[#F4ECD8]/50 p-4">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div><span className="block text-[10px] font-black uppercase text-[#5B4C5B]">Prestadora</span><strong>{data.providerLegalName}</strong>{data.providerTradeName ? <span className="block text-xs">{data.providerTradeName}</span> : null}</div>
          <div><span className="block text-[10px] font-black uppercase text-[#5B4C5B]">CNPJ</span><strong>{cpfCnpj(data.providerCnpj ?? '')}</strong></div>
          <div><span className="block text-[10px] font-black uppercase text-[#5B4C5B]">Contratante</span><strong>{data.employerUnitName}</strong></div>
          <div><span className="block text-[10px] font-black uppercase text-[#5B4C5B]">Vigência</span><strong>{date(terms?.contractStartDate)}{terms?.termType === 'fixed' ? ` a ${date(terms.contractEndDate)}` : ' · prazo indeterminado'}</strong></div>
          <div><span className="block text-[10px] font-black uppercase text-[#5B4C5B]">Valor mensal</span><strong>{money(terms?.monthlyValue)}</strong></div>
          <div><span className="block text-[10px] font-black uppercase text-[#5B4C5B]">Pagamento</span><strong>Até o dia {terms?.paymentDay} · nota fiscal obrigatória</strong></div>
        </div>
        <div className="mt-4 border-t pt-4"><p className="text-xs font-black uppercase text-[#5B4C5B]">Escopo e entregáveis</p><div className="mt-2 space-y-2">{terms?.serviceItems?.map((item, index) => <div key={item.id} className="grid gap-1 rounded-xl bg-white px-3 py-2 text-xs md:grid-cols-[38px_1fr_1.4fr]"><strong>1.{index + 1}</strong><strong>{item.front}</strong><span>{item.deliverable}</span></div>)}</div></div>
      </section>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <section className="rounded-2xl border p-4"><h2 className="font-black">Dados cadastrais</h2><div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold md:col-span-2">Endereço completo<input value={answers.companyAddress} onChange={set('companyAddress')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          <label className="text-xs font-bold">Telefone institucional<input value={answers.companyPhone} onChange={set('companyPhone')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          <label className="text-xs font-bold">Inscrição municipal <span className="text-[#5B4C5B]">(quando houver)</span><input value={answers.municipalRegistration} onChange={set('municipalRegistration')} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          <label className="text-xs font-bold">Inscrição estadual <span className="text-[#5B4C5B]">(quando houver)</span><input value={answers.stateRegistration} onChange={set('stateRegistration')} className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
        </div></section>

        <section className="rounded-2xl border p-4"><h2 className="font-black">Representante legal e assinante</h2><div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold">Nome completo<input value={answers.representativeName} onChange={set('representativeName')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          <label className="text-xs font-bold">CPF<input value={answers.representativeCpf} onChange={event => setAnswers(current => ({ ...current, representativeCpf: cpf(event.target.value) }))} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          <label className="text-xs font-bold">Qualificação<input value={answers.representativeQualification} onChange={set('representativeQualification')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" placeholder="Ex.: brasileiro, empresário, casado" /></label>
          <label className="text-xs font-bold">Poderes de representação<select value={answers.authoritySource} onChange={set('authoritySource')} required className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Selecione</option><option value="social_contract">Contrato social</option><option value="power_of_attorney">Procuração</option></select></label>
        </div></section>

        <section className="rounded-2xl border p-4"><h2 className="font-black">Dados para pagamento</h2><div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold">Forma de recebimento<select value={answers.bankMethod} onChange={set('bankMethod')} required className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Selecione</option><option value="pix">Pix</option><option value="bank">Conta bancária</option></select></label>
          <label className="text-xs font-bold">Titular<input value={answers.bankHolderName} onChange={set('bankHolderName')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          <label className="text-xs font-bold">CPF ou CNPJ do titular<input value={answers.bankHolderDocument} onChange={event => setAnswers(current => ({ ...current, bankHolderDocument: cpfCnpj(event.target.value) }))} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label>
          {answers.bankMethod === 'pix' ? <label className="text-xs font-bold">Chave Pix<input value={answers.pixKey} onChange={set('pixKey')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label> : null}
          {answers.bankMethod === 'bank' ? <><label className="text-xs font-bold">Banco<input value={answers.bankName} onChange={set('bankName')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label><label className="text-xs font-bold">Agência<input value={answers.bankAgency} onChange={set('bankAgency')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label><label className="text-xs font-bold">Conta<input value={answers.bankAccount} onChange={set('bankAccount')} required className="mt-1 h-10 w-full rounded-xl border px-3 text-sm" /></label></> : null}
        </div></section>

        <section className="rounded-2xl border p-4"><h2 className="font-black">Documentos</h2><p className="mt-1 text-xs font-semibold text-[#5B4C5B]">PDF, JPG ou PNG, com até 10 MB.</p><div className="mt-3 space-y-3">{documents.filter(document => document.required !== false || document.id !== 'power_of_attorney' || answers.authoritySource === 'power_of_attorney').map(document => {
          const file = files[document.id]; const canUpload = !document.status || ['pending', 'rejected'].includes(document.status);
          return <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-[#F4ECD8]/40 p-3"><div><p className="text-sm font-black">{document.label}{document.required ? ' *' : ''}</p><p className="mt-1 max-w-xl text-xs text-[#5B4C5B]">{document.description}</p>{document.fileUrl ? <a href={document.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-[#EE6FA8]">Ver arquivo enviado</a> : null}</div>{file ? <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold"><Paperclip className="h-4 w-4" />{file.name}<button type="button" onClick={() => setFiles(current => ({ ...current, [document.id]: null }))}><X className="h-4 w-4" /></button></span> : canUpload ? <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-xs font-black shadow"><FileUp className="h-4 w-4" />Anexar<input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={event => chooseFile(document.id, event.target.files?.[0] ?? null)} /></label> : <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">Enviado</span>}</div>;
        })}</div></section>

        <section className="rounded-2xl border p-4"><h2 className="font-black">Declarações</h2><div className="mt-3 space-y-2">{[
          ['dataAccuracyConfirmed', 'Declaro que os dados fornecidos são verdadeiros.'],
          ['representationAuthorityConfirmed', 'Declaro possuir poderes para representar a empresa.'],
          ['invoiceAcknowledged', 'Estou ciente de que a nota fiscal é obrigatória para todos os pagamentos.'],
        ].map(([key, label]) => <label key={key} className="flex items-start gap-3 rounded-xl border p-3 text-xs font-semibold"><input type="checkbox" checked={answers[key as keyof Answers] === true} onChange={event => setAnswers(current => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 accent-[#EE6FA8]" /><span>{label}</span></label>)}</div></section>

        {data.privacyNotice ? <section className="rounded-2xl border p-4"><h2 className="font-black">{data.privacyNotice.title}</h2><p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[#5B4C5B]">{data.privacyNotice.summary}</p><details className="mt-3 rounded-xl border p-3 text-xs"><summary className="cursor-pointer font-black">Ler aviso completo</summary><p className="mt-3 max-h-72 overflow-y-auto whitespace-pre-line leading-relaxed">{data.privacyNotice.text}</p></details><label className="mt-3 flex items-start gap-3 rounded-xl border p-3 text-xs font-semibold"><input type="checkbox" checked={privacyAcknowledged} onChange={event => setPrivacyAcknowledged(event.target.checked)} className="mt-0.5 accent-[#EE6FA8]" /><span>{data.privacyNotice.acknowledgementText}</span></label></section> : null}
        <label className="block text-xs font-bold">Observações<textarea value={answers.notes} onChange={set('notes')} rows={3} className="mt-1 w-full rounded-xl border p-3 text-sm" /></label>
        {error ? <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />{error}</p> : null}
        {submitted ? <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />Cadastro enviado para conferência do RH.</p> : null}
        <button type="submit" disabled={submitting || expired || !privacyAcknowledged} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#EE6FA8] text-sm font-black text-white disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{expired ? 'Prazo encerrado' : submitting ? 'Enviando...' : 'Enviar cadastro para análise'}</button>
      </form>
    </main>
  </div>;
}
