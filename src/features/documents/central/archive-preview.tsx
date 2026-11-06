"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { openPdfDocument, prefersNativePdfViewer } from "@/lib/pdf/pdfjs-client";

/** "expanded" = prévia ampliada; no computador usa o visualizador de PDF do navegador. */
export type ArchivePreviewVariant = "inline" | "expanded";
export const ArchivePreviewVariantContext = createContext<ArchivePreviewVariant>("inline");

const noSubscribe = () => () => undefined;
function useNativePdfViewer() {
  return useSyncExternalStore(noSubscribe, prefersNativePdfViewer, () => false);
}

/** Espera a largura parar de mudar para não redesenhar a página a cada quadro do redimensionamento. */
const RESIZE_SETTLE_MS = 120;
/** Mudanças menores que isso não justificam redesenhar. */
const RESIZE_MIN_DELTA = 8;

/** Receives only an already-authorized local blob; PDF rendering stays in the browser. */
export function ArchivePreview({ url, mime, title, variant }: { url: string; mime: string; title: string; variant?: ArchivePreviewVariant }) {
  const contextVariant = useContext(ArchivePreviewVariantContext);
  const nativeViewer = useNativePdfViewer();
  const isPdf = mime.toLowerCase().includes("pdf");
  if (isPdf && (variant ?? contextVariant) === "expanded" && nativeViewer && url.startsWith("blob:")) {
    return <iframe src={`${url}#view=FitH`} title={`Prévia de ${title}`} data-viewer="native" className="h-[75vh] w-full rounded-ds-sm border border-ds-border bg-white" />;
  }
  if (isPdf) return <PdfCanvasPreview url={url} title={title} />;
  if (mime.startsWith("image/")) return <img src={url} alt={title} className="max-h-96 w-full rounded border object-contain" />;
  return <p className="text-xs text-slate-500">Prévia indisponível para este formato. Use Baixar.</p>;
}

function PdfCanvasPreview({ url, title }: { url: string; title: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = (next: number) => setWidth((current) => current === 0 || Math.abs(next - current) >= RESIZE_MIN_DELTA ? next : current);
    apply(Math.max(120, target.clientWidth));
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      const next = Math.max(120, entry.contentRect.width);
      timer = setTimeout(() => apply(next), RESIZE_SETTLE_MS);
    });
    observer.observe(target);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let task: Awaited<ReturnType<typeof openPdfDocument>> | undefined;
    setPdf(null); setPage(1); setError(null); setRendered(false);
    if (!url.startsWith("blob:")) return;
    setBusy(true);
    void (async () => {
      try {
        const response = await fetch(url);
        if (cancelled) return;
        const data = await response.arrayBuffer();
        if (cancelled) return;
        task = await openPdfDocument(data);
        if (cancelled) { void task.destroy().catch(() => undefined); return; }
        const document = await task.promise;
        if (!cancelled) setPdf(document);
      } catch { if (!cancelled) setError("Não foi possível gerar a prévia. Use Baixar para consultar o arquivo."); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; if (task) void task.destroy().catch(() => undefined); };
  }, [url]);
  useEffect(() => {
    if (!pdf || !canvasRef.current || width === 0) return;
    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setBusy(true); setRendered(false);
    void (async () => {
      try {
        const source = await pdf.getPage(page);
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const base = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({ scale: width / base.width * Math.min(window.devicePixelRatio || 1, 2) });
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        task = source.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch { if (!cancelled) setError("Não foi possível exibir esta página. Use Baixar para consultar o arquivo."); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, width]);
  return <div ref={containerRef} className="min-w-0 space-y-2">
    {busy && <p role="status" className="text-xs text-slate-500">Carregando prévia…</p>}{error ? <p role="alert" className="text-xs text-slate-500">{error}</p> : <canvas ref={canvasRef} role="img" aria-label={`Prévia de ${title}`} data-page={page} data-rendered={rendered ? "true" : "false"} className="h-auto w-full rounded border bg-white" />}{pdf && <div className="flex items-center justify-between gap-1 text-[10px]"><Button size="sm" variant="ghost" aria-label="Página anterior da prévia" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button><span>Página {page} de {pdf.numPages}</span><Button size="sm" variant="ghost" aria-label="Próxima página da prévia" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}>›</Button></div>}
  </div>;
}
