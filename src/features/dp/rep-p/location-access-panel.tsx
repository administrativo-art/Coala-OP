'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { errorMessageOf } from '@/components/patterns/panel-form';

type Entry = { id: string; capturedAt: string | null; status: string;
  position: { latitude: number; longitude: number; accuracyMeters: number } | null };
type Result = { entries: Entry[]; nextCursor: string | null; auditId: string };
export function LocationAccessPanel({ firebaseUser, employeeUid, units, today }: {
  firebaseUser: User | null; employeeUid?: string; units: Map<string, string>; today: string;
}) {
  const [unitId, setUnitId] = useState('');
  const [workDate, setWorkDate] = useState(today);
  const [source, setSource] = useState('marking');
  const [reason, setReason] = useState(employeeUid ? 'operational_review' : 'own_data');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedUnit = unitId || units.keys().next().value || '';
  async function load(cursor?: string) {
    if (!firebaseUser || busy) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch('/api/dp/time-recording/location-access', {
        method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeUid: employeeUid ?? firebaseUser.uid, unitId: selectedUnit,
          workDate, source, reason, ...(cursor ? { cursor } : {}) }),
      });
      if (!response.ok) throw new Error('Não foi possível consultar a localização. Confira sua permissão e tente novamente.');
      setResult(await response.json() as Result);
    } catch (cause) { setError(errorMessageOf(cause, 'Não foi possível consultar a localização.')); }
    finally { setBusy(false); }
  }
  const field = 'w-full rounded-ds-md border border-ds-border bg-ds-surface p-2 text-sm';
  return <section className="space-y-3 rounded-ds-btn-lg border border-ds-border bg-ds-surface p-4" aria-label="Consulta de localização">
    <h2 className="text-sm font-bold">Localização</h2>
    <p className="text-xs text-ds-ink-muted">Consulte um dia e uma unidade. Cada consulta fica registrada. Para solicitar documentos ou esclarecimentos, procure o RH.</p>
    <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label className="block text-xs">Unidade<select className={field} value={selectedUnit} disabled={busy} onChange={(event) => { setUnitId(event.target.value); setResult(null); }}>
        {!units.size ? <option value="">Sem unidade disponível</option> : null}
        {[...units].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label className="block text-xs">Dia<input className={field} type="date" value={workDate} required disabled={busy} onChange={(event) => { setWorkDate(event.target.value); setResult(null); }} /></label>
      <label className="block text-xs">Captura<select className={field} value={source} disabled={busy} onChange={(event) => { setSource(event.target.value); setResult(null); }}>
        <option value="marking">Na marcação</option><option value="journey">Durante a jornada</option>
      </select></label>
      {employeeUid ? <label className="block text-xs">Motivo<select className={field} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setResult(null); }}>
        <option value="operational_review">Conferência operacional</option><option value="employee_request">Solicitação do colaborador</option><option value="privacy_review">Atendimento de privacidade</option>
      </select></label> : null}
      <Button type="submit" disabled={busy || !selectedUnit || !firebaseUser}>{busy ? 'Consultando…' : 'Consultar localização'}</Button>
    </form>
    {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
    {result ? <div aria-live="polite" className="space-y-2 text-xs">
      {!result.entries.length ? <p>Nenhuma localização disponível nesta página.</p> : null}
      {result.entries.map((entry) => <div key={entry.id} className="border-t border-ds-border pt-2">
        <p>{entry.capturedAt ? new Date(entry.capturedAt).toLocaleString('pt-BR') : 'Sem horário de captura'}</p>
        <p>{entry.position ? `${entry.position.latitude}, ${entry.position.longitude} · precisão ${entry.position.accuracyMeters} m` : 'Sem coordenadas'}</p>
      </div>)}
      {result.nextCursor ? <Button type="button" disabled={busy} onClick={() => void load(result.nextCursor!)}>Próxima página</Button> : null}
    </div> : null}
  </section>;
}
