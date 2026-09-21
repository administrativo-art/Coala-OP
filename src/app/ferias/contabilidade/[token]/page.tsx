'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from 'lucide-react';
import { useParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type PortalProcess = {
  employeeName: string;
  companyName: string;
  acquisitionCycle: string;
  startDate: string;
  endDate: string;
  status: string;
  receiptStatus: string;
  correctionReason?: string | null;
  alreadyUploaded: boolean;
  uploadedCount: number;
  uploadedFiles: Array<{ fileName: string; mimeType: string; status: string }>;
  selectionFinalized: boolean;
  acceptingUploads: boolean;
};

function dateBr(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function apiMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as { error?: string | { message?: string } };
  if (typeof value.error === 'string') return value.error;
  return value.error?.message || fallback;
}

export default function VacationAccountantPage() {
  const token = String(useParams().token ?? '');
  const [process, setProcess] = useState<PortalProcess | null>(null);
  const [message, setMessage] = useState('Carregando...');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/hr/vacation-accountant/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(apiMessage(payload, 'Não foi possível abrir o portal.'));
    setProcess(payload.process);
    setMessage('');
  }, [token]);

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Não foi possível abrir o portal.'));
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/hr/vacation-accountant/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: new FormData(formElement),
      });
      const payload = await response.json().catch(() => ({})) as { uploadedCount?: number };
      if (!response.ok) throw new Error(apiMessage(payload, 'Não foi possível enviar o recibo.'));
      const count = payload.uploadedCount ?? 1;
      setMessage(`${count} arquivo${count === 1 ? '' : 's'} recebido${count === 1 ? '' : 's'} e preservado${count === 1 ? '' : 's'}. O RH fará a seleção final.`);
      formElement.reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar o recibo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f0eee9] px-4 py-8 text-slate-950 sm:py-12">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.1em] text-pink-600">Coala Shakes · Portal seguro da contabilidade</p>
          <h1 className="mt-2 text-2xl font-black">Documentos das férias</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">Envie um ou mais arquivos em PDF, JPG ou PNG. Todos serão preservados e o RH confirmará qual é o recibo principal.</p>
        </header>

        {process ? (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle>{process.employeeName}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <p><b>Empresa:</b> {process.companyName}</p>
              <p><b>Período aquisitivo:</b> {process.acquisitionCycle}</p>
              <p><b>Início:</b> {dateBr(process.startDate)}</p>
              <p><b>Término:</b> {dateBr(process.endDate)}</p>
            </CardContent>
          </Card>
        ) : null}

        {process?.correctionReason ? (
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-black">Correção solicitada pelo RH</p><p className="mt-1">{process.correctionReason}</p></div>
          </div>
        ) : null}

        {process?.alreadyUploaded ? (
          <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
            <CheckCircle2 className="h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-black">{process.uploadedCount} arquivo{process.uploadedCount === 1 ? '' : 's'} recebido{process.uploadedCount === 1 ? '' : 's'}</p>
              <p className="mt-1 text-sm font-semibold">
                {process.selectionFinalized
                  ? 'O RH já confirmou o recibo principal.'
                  : 'Os arquivos estão em processamento ou aguardando a seleção final do RH.'}
              </p>
              <ul className="mt-3 space-y-1 text-xs font-semibold">
                {process.uploadedFiles.map((file, index) => <li key={`${file.fileName}-${file.mimeType}-${index}`} className="truncate">• {file.fileName}</li>)}
              </ul>
            </div>
          </div>
        ) : null}

        {process?.acceptingUploads ? (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">{process.alreadyUploaded ? 'Adicionar arquivos' : 'Enviar arquivos'}</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <label className="block rounded-2xl border-2 border-dashed border-pink-200 bg-pink-50/50 p-5 text-center text-sm font-black">
                  <FileText className="mx-auto mb-2 h-7 w-7 text-pink-600" />
                  PDF, JPG ou PNG · até 20 arquivos por envio
                  <Input name="files" type="file" accept="application/pdf,image/jpeg,image/png" multiple required className="mt-3 bg-white text-xs" />
                  <span className="mt-2 block text-[11px] font-semibold text-slate-500">15 MB por arquivo e 25 MB no conjunto. Se necessário, envie outro lote pelo mesmo link.</span>
                </label>
                <Button disabled={busy} className="w-full rounded-xl bg-pink-600 font-black hover:bg-pink-700">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {busy ? 'Enviando e processando...' : 'Enviar arquivos ao RH'}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {message ? <p className="rounded-xl border bg-white p-4 text-sm font-semibold">{message}</p> : null}
      </div>
    </main>
  );
}
