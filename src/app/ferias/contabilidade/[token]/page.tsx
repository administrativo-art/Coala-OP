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
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/hr/vacation-accountant/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: new FormData(event.currentTarget),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiMessage(payload, 'Não foi possível enviar o recibo.'));
      setMessage('Recibo recebido e preservado. O RH já pode conferir o arquivo original e os dados processados.');
      event.currentTarget.reset();
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
          <h1 className="mt-2 text-2xl font-black">Recibo de férias</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">Envie o PDF original. O arquivo ficará preservado para a auditoria do RH.</p>
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
            <div><p className="font-black">Recibo recebido</p><p className="mt-1 text-sm font-semibold">O documento está em processamento ou conferência pelo RH.</p></div>
          </div>
        ) : process ? (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">Enviar arquivo original</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <label className="block rounded-2xl border-2 border-dashed border-pink-200 bg-pink-50/50 p-5 text-center text-sm font-black">
                  <FileText className="mx-auto mb-2 h-7 w-7 text-pink-600" />
                  Recibo de férias em PDF
                  <Input name="file" type="file" accept="application/pdf" required className="mt-3 bg-white text-xs" />
                </label>
                <Button disabled={busy} className="w-full rounded-xl bg-pink-600 font-black hover:bg-pink-700">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {busy ? 'Enviando e processando...' : 'Enviar recibo ao RH'}
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
