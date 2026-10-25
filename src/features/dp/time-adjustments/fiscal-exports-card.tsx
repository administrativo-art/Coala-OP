"use client";

import { useCallback, useEffect, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { Download } from "lucide-react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

type Establishment = { id: string; legalName: string; cnpj: string; timeZone: string };
type ExportPackage = { filename: string; signatureFilename: string; sha256: string; lineCount: number; counts: Record<string, number>;
  afdBase64?: string; aejBase64?: string; signatureBase64: string };

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const cnpj = (value: string) => value.replace(/\D/g, "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

function downloadBase64(name: string, content: string, mime: string) {
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Exportação fiscal administrativa; cada geração baixa o TXT e sua assinatura CAdES destacada. */
export function FiscalExportsCard({ firebaseUser }: { firebaseUser: FirebaseUser | null }) {
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [establishmentId, setEstablishmentId] = useState("");
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [busy, setBusy] = useState<"afd" | "aej" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ kind: string; sha256: string; lineCount: number } | null>(null);
  const request = useCallback(<T,>(path: string, init: { method?: string; json?: unknown; fallbackError: string }) =>
    authenticatedApiRequest<T>(path, { ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null) }), [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    void request<{ establishments: Establishment[] }>("/api/dp/time-recording/fiscal-options", { fallbackError: "Não foi possível listar os estabelecimentos fiscais." })
      .then((response) => { setEstablishments(response.establishments); setEstablishmentId((current) => current || response.establishments[0]?.id || ""); })
      .catch((cause) => setError(errorMessageOf(cause, "Não foi possível listar os estabelecimentos fiscais.")));
  }, [firebaseUser, request]);

  async function generate(kind: "afd" | "aej") {
    if (!establishmentId || startDate > endDate) { setError("Selecione o estabelecimento e um período válido."); return; }
    setBusy(kind); setError(null); setLast(null);
    try {
      const result = await request<ExportPackage>(`/api/dp/time-recording/${kind}`, { method: "POST", json: { establishmentId, startDate, endDate },
        fallbackError: `Não foi possível gerar o ${kind.toUpperCase()}.` });
      const content = kind === "afd" ? result.afdBase64 : result.aejBase64;
      if (!content) throw new Error("O arquivo fiscal não veio no pacote de exportação.");
      downloadBase64(result.filename, content, "text/plain;charset=iso-8859-1");
      downloadBase64(result.signatureFilename, result.signatureBase64, "application/pkcs7-signature");
      setLast({ kind: kind.toUpperCase(), sha256: result.sha256, lineCount: result.lineCount });
    } catch (cause) { setError(errorMessageOf(cause, `Não foi possível gerar o ${kind.toUpperCase()}.`)); } finally { setBusy(null); }
  }

  return <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-3">
      <label className="space-y-1 text-xs font-bold text-ds-ink">Estabelecimento
        <Select value={establishmentId} onValueChange={setEstablishmentId}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>
          {establishments.map((item) => <SelectItem key={item.id} value={item.id}>{item.legalName} · {cnpj(item.cnpj)}</SelectItem>)}
        </SelectContent></Select>
      </label>
      <label className="space-y-1 text-xs font-bold text-ds-ink">Data inicial<Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label className="space-y-1 text-xs font-bold text-ds-ink">Data final<Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="ds-secondary" disabled={Boolean(busy) || !establishmentId} onClick={() => void generate("afd")}><Download className="h-4 w-4" />{busy === "afd" ? "Gerando AFD…" : "Exportar AFD + .p7s"}</Button>
      <Button variant="ds-secondary" disabled={Boolean(busy) || !establishmentId} onClick={() => void generate("aej")}><Download className="h-4 w-4" />{busy === "aej" ? "Gerando AEJ…" : "Exportar AEJ + .p7s"}</Button>
    </div>
    <p className="text-xs text-ds-ink-muted">O AFD extrai os registros originais. O AEJ exige todas as competências do período fechadas e inclui os tratamentos e o banco apurado.</p>
    {error ? <p role="alert" className="text-xs font-semibold text-ds-danger">{error}</p> : null}
    {last ? <p role="status" className="text-xs font-semibold text-ds-ok">{last.kind} gerado com {last.lineCount} linhas. SHA-256: <span className="font-ds-mono">{last.sha256}</span></p> : null}
  </div>;
}
