"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import type { ClosureReleasePreview } from "./closure-types";
import { ProviderClosureContentView } from "./closure-content";

type Candidates = { competence: string; closureVersion: number; people: { uid: string; name: string; releaseId: string | null; hasOtherEmployer?: boolean }[] };
export function ClosureReleasePanel({ grantId, firebaseUser }: { grantId: string; firebaseUser: User | null }) {
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [employeeUid, setEmployeeUid] = useState("");
  const [includePayslip, setIncludePayslip] = useState(false);
  const [preview, setPreview] = useState<ClosureReleasePreview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const api = useCallback(<T,>(body?: unknown) => authenticatedApiRequest<T>(
    "/api/dp/service-providers/closures" + (body === undefined ? "?grantId=" + encodeURIComponent(grantId) : ""), {
      getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null),
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    }), [grantId, firebaseUser]);
  useEffect(() => { setPreview(null); requestId.current = null; setMessage(""); }, [employeeUid, includePayslip]);
  async function load() {
    setBusy(true); setError("");
    try { setCandidates(await api<Candidates>()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar o fechamento."); }
    finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(""); setPreview(null); setMessage("");
    try {
      setPreview(await api<ClosureReleasePreview>({ action: "preview", grantId, employeeUid, includePayslip }));
      requestId.current = crypto.randomUUID();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível preparar a entrega."); }
    finally { setBusy(false); }
  }
  async function release() {
    if (!preview || !requestId.current) return;
    setBusy(true); setError("");
    try {
      await api({ action: "release", grantId, employeeUid, includePayslip, requestId: requestId.current,
        expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash });
      setMessage("Fechamento de " + preview.content.employee.name + " disponibilizado ao contador.");
      setPreview(null); requestId.current = null;
      setCandidates(await api<Candidates>());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível liberar o fechamento."); }
    finally { setBusy(false); }
  }
  return <section className="w-full space-y-3 border-t border-ds-border pt-3">
    <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => { setExpanded(!expanded); if (!expanded) void load(); }}>Disponibilizar fechamento por colaborador</Button>
    {expanded ? <div className="space-y-4 rounded-ds-md bg-ds-page p-4">
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
      {candidates ? <>
        <p className="text-sm">Competência fechada · versão {candidates.closureVersion}</p>
        <label className="block space-y-1 text-sm">Colaborador
          <span className="relative block"><select aria-label="Colaborador" className="h-10 w-full appearance-none rounded-md border border-ds-border bg-ds-surface pl-3 pr-9" value={employeeUid} disabled={busy} onChange={(event) => setEmployeeUid(event.target.value)}>
            <option value="">Selecione uma pessoa</option>
            {candidates.people.map((person) => <option key={person.uid} value={person.uid}>{person.name}{person.hasOtherEmployer ? " · Vínculo do mês em conferência" : person.releaseId ? " · Já disponibilizado" : ""}</option>)}
          </select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" /></span>
        </label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={includePayslip} disabled={busy} onChange={(event) => setIncludePayslip(event.target.checked)} />
          Liberar também o contracheque vinculado a esta versão do fechamento
        </label>
        <Button variant="ds-secondary" size="sm" disabled={busy || !employeeUid} onClick={() => void prepare()}>{busy ? "Conferindo…" : "Conferir informações para liberação"}</Button>
      </> : busy ? <p role="status" className="text-sm">Consultando pessoas da competência…</p> : null}
      {preview ? <section className="space-y-5 rounded-ds-card border border-ds-border bg-ds-surface p-4">
        <ProviderClosureContentView content={preview.content} />
        {preview.content.documents.map((document) => <p key={document.kind} className="text-sm">Documento selecionado · {document.filename}</p>)}
        <Button variant="primary-modal" disabled={busy} onClick={() => void release()}>{busy ? "Disponibilizando…" : includePayslip ? "Confirmar liberação dos dados e do contracheque" : "Confirmar liberação deste fechamento"}</Button>
      </section> : null}
    </div> : null}
  </section>;
}
