"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import type { FinancialInboxMessage } from "@/features/financial/inbox/types";

type Page = { messages: FinancialInboxMessage[]; nextCursor: string | null };

/** Read-only view; file access and document decisions remain authorized by their source. */
export function FinancialDocumentArchive() {
  const { firebaseUser } = useAuth();
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    if (!firebaseUser) return;
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/financial/inbox?view=identified&limit=25${archived ? "&stage=archive" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || "Não foi possível consultar o Acervo financeiro.");
      if (sequence.current !== requestId) return;
      setPage((previous) => ({ messages: cursor ? [...(previous?.messages ?? []), ...payload.messages] : payload.messages, nextCursor: payload.nextCursor }));
    } catch (cause) {
      if (sequence.current === requestId) setError(cause instanceof Error ? cause.message : "Falha na consulta.");
    } finally {
      if (sequence.current === requestId) setLoading(false);
    }
  }, [firebaseUser, archived]);

  useEffect(() => {
    setPage(null); setFolder(null); setSelected(null);
    void load();
    return () => { sequence.current++; };
  }, [load]);

  const files = (page?.messages ?? []).flatMap((message) => message.attachments.filter((file) => file.storagePath).map((file) => ({
    message, file, key: `${message.id}:${file.id}`,
    folder: file.documentNaming?.counterpartyId ? `CONTRAPARTE-${file.documentNaming.counterpartyId}` : "Sem nomenclatura confirmada",
  })));
  const folders = [...new Set(files.map((entry) => entry.folder))].sort();
  const active = files.find((entry) => entry.key === selected);

  async function openFile(download: boolean) {
    if (!active || !firebaseUser) return;
    const preview = download ? null : window.open("", "_blank");
    if (preview) preview.opener = null;
    setOpening(true); setError(null);
    try {
      const response = await fetch(`/api/financial/inbox/${encodeURIComponent(active.message.id)}/files/${encodeURIComponent(active.file.id)}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Não foi possível acessar o arquivo. Confira suas permissões e tente novamente.");
      const url = URL.createObjectURL(await response.blob());
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = active.file.documentNaming?.downloadName || active.file.filename;
        anchor.click();
      } else if (preview) preview.location.href = url;
      else throw new Error("Permita a abertura de uma nova aba para visualizar o arquivo.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      preview?.close(); setError(cause instanceof Error ? cause.message : "Falha ao abrir arquivo.");
    } finally { setOpening(false); }
  }

  return <section className="space-y-4">
    <div><h1 className="text-2xl font-bold">Acervo financeiro</h1><p className="text-sm text-muted-foreground">Documentos identificados, organizados pela contraparte confirmada. As pastas representam a organização documental.</p></div>
    <div className="flex flex-wrap gap-2"><Button variant={archived ? "outline" : "default"} onClick={() => setArchived(false)}>Identificados</Button><Button variant={archived ? "default" : "outline"} onClick={() => setArchived(true)}>Arquivados</Button><Button variant="outline" disabled={loading} onClick={() => void load()}>Atualizar</Button><Button asChild variant="ghost"><Link href="/dashboard/financial/inbox">Abrir caixa de cobranças</Link></Button></div>
    {error && <p role="alert" className="rounded-lg border p-3 text-sm text-destructive">{error}</p>}
    <div className="grid min-h-80 gap-4 rounded-xl border p-4 md:grid-cols-[220px_1fr_280px]">
      <nav aria-label="Pastas financeiras" className="space-y-2"><Button variant={folder === null ? "secondary" : "ghost"} className="w-full justify-start" onClick={() => setFolder(null)}>Todos os arquivos carregados</Button>{folders.map((name) => <Button key={name} variant={folder === name ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal break-all text-left" onClick={() => setFolder(name)}><Folder className="mr-2 h-4 w-4 shrink-0" />{name}</Button>)}</nav>
      <div className="space-y-2">{files.filter((entry) => folder === null || entry.folder === folder).map((entry) => <button key={entry.key} onClick={() => setSelected(entry.key)} aria-pressed={selected === entry.key} className={`flex w-full items-start gap-2 rounded-lg border p-3 text-left ${selected === entry.key ? "bg-muted" : ""}`}><FileText className="h-5 w-5 shrink-0" /><span className="min-w-0 break-all text-sm">{entry.file.documentNaming?.downloadName || entry.file.filename}<span className="mt-1 block text-xs text-muted-foreground">{entry.folder}</span></span></button>)}{loading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Carregando documentos…</p>}{!loading && !error && files.length === 0 && <p className="text-sm text-muted-foreground">Nenhum arquivo nesta página. Outras páginas podem conter documentos.</p>}{page?.nextCursor && <Button variant="outline" disabled={loading} onClick={() => void load(page.nextCursor!)}>Carregar mais</Button>}</div>
      <aside aria-label="Detalhes do documento" className="space-y-3 border-t pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">{active ? <><h2 className="break-all font-semibold">{active.file.documentNaming?.downloadName || active.file.filename}</h2><p className="break-all text-xs">Original: {active.file.filename}</p><p className="break-all text-xs">Pasta: {active.file.documentNaming?.destination || "Destino documental não confirmado"}</p><p className="text-xs">{active.file.contentType} · {Math.ceil(active.file.size / 1024)} KB</p><div className="flex flex-wrap gap-2"><Button disabled={opening} onClick={() => void openFile(false)}>Visualizar</Button><Button variant="outline" disabled={opening} onClick={() => void openFile(true)}>Baixar</Button></div><Button asChild variant="outline"><Link href={`/dashboard/financial/inbox?sourceId=${encodeURIComponent(active.message.id)}`}>Revisar na origem</Link></Button><Button asChild variant="ghost"><Link href={`/dashboard/documents/history?source=financial&documentId=${encodeURIComponent(active.message.id)}`}>Ver histórico</Link></Button></> : <p className="text-sm text-muted-foreground">Selecione um arquivo para consultar seus detalhes.</p>}</aside>
    </div>
    <p className="text-xs text-muted-foreground">A lista cresce por página; as pastas refletem os arquivos carregados. Mover ou classificar exige ação explícita na origem e mantém os bytes preservados.</p>
  </section>;
}
