"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineConfirm } from '@/components/patterns/inline-confirm';
import { StatusPill } from '@/components/ui/status-pill';
import { authenticatedApiRequest, type AuthenticatedApiRequestInit } from '@/lib/authenticated-api-client';
import { saveFile } from '@/features/dp/rep-p/marking-ui';
import type { readPayrollFinance, previewPayrollFinance, listPayrollFinanceTitles } from './payroll-finance.server';
import type { PayrollFinancePreviewInput, PayrollFinanceComparison } from './payroll-finance';

const endpoint = '/api/dp/time-recording/payroll-finance';
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const field = 'h-10 w-full rounded-md border border-ds-border bg-ds-surface pl-3 pr-9 text-sm';
function Select({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="block space-y-1 text-sm">{label}<span className="relative block"><select {...props} aria-label={label} className={`${field} appearance-none`}>{children}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" /></span></label>;
}
function Comparison({ result }: { result: PayrollFinanceComparison }) {
  return <div className="space-y-2 text-sm"><StatusPill variant={result.status === 'match' ? 'ok' : 'danger'}>{result.status === 'match' ? 'Valores conferidos' : 'Com divergência'}</StatusPill>
    <dl className="grid gap-2 sm:grid-cols-2"><div><dt>Informado no documento</dt><dd className="font-bold">{money(result.documentCents)}</dd></div><div><dt>Valor comparado no título</dt><dd className="font-bold">{money(result.titleCents)}</dd></div><div><dt>Valor nominal do título</dt><dd>{money(result.nominalCents)}</dd></div>{result.allocationCents !== null ? <div><dt>Soma das linhas individuais</dt><dd>{money(result.allocationCents)}</dd></div> : null}</dl>
    {result.differences.length ? <ul className="space-y-1 text-ds-danger">{result.differences.map((item) => <li key={item}>{item}</li>)}</ul> : null}
  </div>;
}
export function PayrollFinancePanel({ firebaseUser, competence, people }: { firebaseUser: User | null; competence: string; people: Array<{ id: string; username?: string }> }) {
  const [mode, setMode] = useState<'salary' | 'guide'>('salary');
  const [employeeUid, setEmployeeUid] = useState('');
  const [expanded, setExpanded] = useState(false);
  const uid = people.some((person) => person.id === employeeUid) ? employeeUid : people[0]?.id ?? '';
  return <section className="space-y-3">
    <p className="text-sm text-ds-ink-muted">Conferência documental dos títulos existentes. A situação de pagamento permanece separada.</p>
    <Button variant="ds-secondary" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? 'Fechar conciliação financeira' : 'Abrir conciliação financeira'}</Button>
    {expanded ? <div className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-3">
      <Select label="Tipo de conferência" value={mode} onChange={(event) => setMode(event.target.value as 'salary' | 'guide')}><option value="salary">Líquido do contracheque e título salarial</option><option value="guide">Guia e encargos individualizados</option></Select>
      <Select label={mode === 'salary' ? 'Colaborador da conciliação' : 'Colaborador da empresa da guia'} value={uid} onChange={(event) => setEmployeeUid(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.username || 'Colaborador'}</option>)}</Select>
      {uid ? <FinanceForm key={`${competence}/${mode}/${uid}`} {...{ firebaseUser, competence, mode }} employeeUid={uid} /> : <p className="text-sm">Sem colaboradores nesta empresa.</p>}
    </div> : null}
  </section>;
}
function FinanceForm({ firebaseUser, competence, employeeUid, mode }: { firebaseUser: User | null; competence: string; employeeUid: string; mode: 'salary' | 'guide' }) {
  type Options = Awaited<ReturnType<typeof listPayrollFinanceTitles>>;
  type State = Awaited<ReturnType<typeof readPayrollFinance>>;
  type Preview = Awaited<ReturnType<typeof previewPayrollFinance>>;
  const [options, setOptions] = useState<Options | null>(null);
  const [expenseId, setExpenseId] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [documentIndex, setDocumentIndex] = useState('');
  const [amount, setAmount] = useState('');
  const [guideDetails, setGuideDetails] = useState({ kind: '', number: '', cnpj: '', competence: '' });
  const [ack, setAck] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef(true), attempt = useRef<string | null>(null);
  const request = useCallback(<T,>(url: string, init?: AuthenticatedApiRequestInit) => authenticatedApiRequest<T>(url, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);
  const query = useCallback((id?: string) => new URLSearchParams({ mode, competence, employeeUid, ...(id ? { expenseId: id } : {}) }).toString(), [mode, competence, employeeUid]);
  const document = state?.documents[Number(documentIndex)];
  function invalidate() { setPreview(null); setConfirming(false); attempt.current = null; setMessage(''); }
  const loadOptions = useCallback(async () => {
    setBusy(true); setError(''); setState(null); setOptions(null); setExpenseId('');
    try { const result = await request<Options>(`${endpoint}?${query()}`); if (active.current) setOptions(result); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar os títulos.'); }
    finally { if (active.current) setBusy(false); }
  }, [query, request]);
  useEffect(() => { active.current = true; void loadOptions(); return () => { active.current = false; }; }, [loadOptions]);
  async function load() {
    invalidate(); setBusy(true); setError(''); setState(null); setDocumentIndex(''); setAmount(''); setAck(false); setGuideDetails({ kind: '', number: '', cnpj: '', competence: '' });
    try { const result = await request<State>(`${endpoint}?${query(expenseId)}`); if (active.current) { setState(result); if (result.documents.length === 1) setDocumentIndex('0'); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Não foi possível conferir o título.'); }
    finally { if (active.current) setBusy(false); }
  }
  function input(): PayrollFinancePreviewInput {
    if (!ack || !state || !expenseId) throw new Error('Leia o documento e confirme os dados selecionados.');
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(amount)) throw new Error('Informe o valor em reais, por exemplo 1.234,56.');
    const [whole, fraction = ''] = amount.replaceAll('.', '').split(',');
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('Informe um valor monetário válido.');
    if (mode === 'guide' && (documentIndex === '' || !document)) throw new Error('Selecione o PDF da guia.');
    if (mode === 'guide' && (!['fgts', 'darf'].includes(guideDetails.kind) || !guideDetails.number.trim() || !guideDetails.cnpj.trim() || !guideDetails.competence)) throw new Error('Informe tipo, número, CNPJ e competência lidos no PDF exato da guia.');
    return { mode, competence, employeeUid, expenseId, amountCents, acknowledgment: true, ...(mode === 'guide' && document ? { document: { messageId: document.messageId, attachmentId: document.attachmentId, sha256: document.sha256, documentKind: guideDetails.kind as 'fgts' | 'darf', documentNumber: guideDetails.number, taxpayerCnpj: guideDetails.cnpj, competence: guideDetails.competence } } : {}) };
  }
  async function compare() {
    invalidate(); setBusy(true); setError('');
    try { const result = await request<Preview>(endpoint, { method: 'POST', json: { action: 'preview', input: input() } }); if (active.current) { setPreview(result); attempt.current = crypto.randomUUID(); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Não foi possível comparar os valores.'); }
    finally { if (active.current) setBusy(false); }
  }
  async function record() {
    if (!state || !preview || !attempt.current) return;
    setBusy(true); setError('');
    try {
      await request(endpoint, { method: 'POST', json: { action: 'record', input: { ...input(), expectedVersion: state.version, expectedSourceHash: preview.sourceHash, requestId: attempt.current } } });
      if (!active.current) return;
      await load();
      if (active.current) setMessage('Conferência registrada no histórico. Título e pagamento permanecem nas suas situações atuais.');
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a conferência.'); }
    finally { if (active.current) setBusy(false); }
  }
  async function download() {
    if (!state || mode === 'guide' && (!document || documentIndex === '')) return;
    setBusy(true); setError('');
    try {
      const blob = mode === 'salary'
        ? await request<Blob>('/api/dp/time-recording/payslip-reconciliation', { method: 'POST', responseType: 'blob', json: { action: 'download', input: { competence, employeeUid, documentId: state.payslip.id, documentHash: state.payslip.sha256 } } })
        : await request<Blob>(`/api/financial/inbox/${encodeURIComponent(document!.messageId)}/files/${encodeURIComponent(document!.attachmentId)}`, { responseType: 'blob' });
      if (active.current) await saveFile(new File([blob], `${mode === 'salary' ? 'contracheque' : 'guia'}-${competence}.pdf`, { type: 'application/pdf' }));
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Não foi possível baixar o PDF.'); }
    finally { if (active.current) setBusy(false); }
  }
  return <div className="space-y-4">
    {busy ? <p role="status" className="text-sm">Conferindo fontes…</p> : null}{error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}
    {options ? <>
      <p className="text-sm">Empresa: {options.employer.name} · {competence}</p>
      <Select label="Título financeiro existente" disabled={busy} value={expenseId} onChange={(event) => { invalidate(); setState(null); setExpenseId(event.target.value); }}><option value="">Selecione o título</option>{options.titles.map((title) => <option key={title.id} value={title.id}>{title.description} · {money(title.amountCents)}</option>)}</Select>
      {!options.titles.length ? <p className="text-sm">Nenhum título compatível foi encontrado. Confira o cadastro e a competência em <a className="underline" href="/dashboard/expenses">Despesas</a>.</p> : null}
      <Button size="sm" variant="ds-secondary" disabled={busy || !expenseId} onClick={() => void load()}>Consultar título e documentos</Button>
    </> : null}
    {state ? <>
      <p className="text-sm"><strong>{state.expense.description}</strong> · {state.expense.paymentStatus === 'paid' ? 'Pago' : state.expense.paymentStatus === 'partially_paid' ? 'Pago parcialmente' : 'Pendente de pagamento'}</p>
      <p className="text-sm">Nominal: {money(state.expense.nominalCents)} · A pagar: {money(state.expense.payableCents)}. {mode === 'salary' ? 'O líquido do recibo é comparado ao valor a pagar.' : 'A soma das individualizações é comparada ao valor nominal da guia.'}</p>
      {state.current ? <div className="space-y-2 rounded-ds-md border border-ds-border p-3"><p className="text-sm font-bold">Última conferência · {new Date(state.current.createdAt).toLocaleString('pt-BR')}</p>{state.current.status === 'stale' ? <p className="text-sm text-ds-danger">Fonte alterada. Registre uma nova conferência.</p> : <Comparison result={state.current.comparison} />}</div> : null}
      {mode === 'guide' ? <Select label="PDF da guia vinculada ao título" disabled={busy} value={documentIndex} onChange={(event) => { invalidate(); setDocumentIndex(event.target.value); setAck(false); setGuideDetails({ kind: '', number: '', cnpj: '', competence: '' }); }}><option value="">Selecione o documento</option>{state.documents.map((doc, index) => <option key={`${doc.messageId}/${doc.attachmentId}`} value={String(index)}>{doc.name}</option>)}</Select> : <p className="text-sm">Documento: {state.payslip.name} · revisão {state.payslip.version}</p>}
      {mode === 'guide' && !state.documents.length ? <p className="text-sm text-ds-danger">Confirme tipo, número e contribuinte na caixa financeira. Esta conferência exige uma mensagem com um único PDF, identificado como a guia.</p> : null}
      <Button size="sm" variant="ds-secondary" disabled={busy || mode === 'guide' && documentIndex === ''} onClick={() => void download()}>Baixar documento para conferir</Button>
      {state.lines.length ? <div className="space-y-2 text-sm"><h4 className="font-bold">Encargos individualizados</h4>{state.lines.map((line, index) => <div key={index} className="rounded-ds-md border border-ds-border p-2"><strong>{line.employeeName}</strong> · {line.accountName}<p>{line.analysisType === 'employer_cost' ? 'Custo do empregador' : line.analysisType === 'employee_deduction' ? 'Retenção do colaborador' : 'Informativo'} · {money(line.amountCents)}</p></div>)}</div> : null}
      {mode === 'guide' ? <fieldset className="space-y-3 border-t border-ds-border pt-3" disabled={busy || !state.canWrite}>
        <legend className="text-sm font-bold">Identidade lida no PDF selecionado</legend>
        <p className="text-xs text-ds-ink-muted">No título: {state.expense.fiscalDocumentKind === 'fgts' ? 'FGTS' : 'DARF'} · {state.expense.fiscalDocumentNumber}. Confira esses dados no arquivo baixado.</p>
        <Select label="Tipo lido no PDF" value={guideDetails.kind} onChange={(event) => { invalidate(); setGuideDetails({ ...guideDetails, kind: event.target.value }); }}><option value="">Selecione o tipo lido</option><option value="fgts">FGTS</option><option value="darf">DARF previdenciário</option></Select>
        <label className="block space-y-1 text-sm">Número lido na guia<input aria-label="Número lido na guia" className={field} value={guideDetails.number} onChange={(event) => { invalidate(); setGuideDetails({ ...guideDetails, number: event.target.value }); }} /></label>
        <label className="block space-y-1 text-sm">CNPJ do contribuinte lido na guia<input aria-label="CNPJ do contribuinte lido na guia" className={field} inputMode="numeric" value={guideDetails.cnpj} onChange={(event) => { invalidate(); setGuideDetails({ ...guideDetails, cnpj: event.target.value }); }} /></label>
        <label className="block space-y-1 text-sm">Competência lida na guia<input aria-label="Competência lida na guia" className={field} type="month" value={guideDetails.competence} onChange={(event) => { invalidate(); setGuideDetails({ ...guideDetails, competence: event.target.value }); }} /></label>
      </fieldset> : null}
      <label className="block space-y-1 text-sm">{mode === 'salary' ? 'Líquido lido no contracheque (R$)' : 'Total lido na guia (R$)'}<input aria-label={mode === 'salary' ? 'Líquido lido no contracheque (R$)' : 'Total lido na guia (R$)'} className={field} inputMode="decimal" disabled={busy || !state.canWrite} value={amount} onChange={(event) => { invalidate(); setAmount(event.target.value); }} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} disabled={busy || !state.canWrite} onChange={(event) => { invalidate(); setAck(event.target.checked); }} />Li o PDF selecionado e conferi pessoa ou contribuinte, competência e valor. Na guia, conferi também todas as linhas individuais e suas contas.</label>
      {!state.canWrite ? <p className="text-sm">Seu acesso permite consultar. Registrar conferência exige edição de despesas.</p> : <Button size="sm" variant="ds-secondary" disabled={busy || !ack} onClick={() => void compare()}>Comparar valores</Button>}
      {preview ? <div className="space-y-3 rounded-ds-md border border-ds-border p-3"><Comparison result={preview.comparison} />{!confirming ? <Button size="sm" variant="primary-modal" disabled={busy} onClick={() => setConfirming(true)}>Registrar conferência financeira</Button> : <InlineConfirm message="Registrar a conferência e preservar a anterior no histórico? Esta ação não cria lançamento nem registra pagamento." confirmLabel="Registrar" loadingLabel="Registrando…" loading={busy} onConfirm={() => void record()} onCancel={() => setConfirming(false)} />}</div> : null}
    </> : null}
    <Button size="sm" variant="ds-secondary" disabled={busy} onClick={() => { invalidate(); void loadOptions(); }}>Atualizar títulos</Button>
  </div>;
}
