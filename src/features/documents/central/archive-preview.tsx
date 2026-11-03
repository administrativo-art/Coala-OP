"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";

/** Receives only an already-authorized local blob; PDF rendering stays in the browser. */
export function ArchivePreview({ url, mime, title }: { url: string; mime: string; title: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const isPdf = mime.toLowerCase().includes("pdf");
  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    setPdf(null); setPage(1); setError(null); setRendered(false);
    if (!isPdf || !url.startsWith("blob:")) return;
    setBusy(true);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const response = await fetch(url);
        if (cancelled) return;
        const data = await response.arrayBuffer();
        if (cancelled) return;
        task = pdfjs.getDocument({ data });
        const document = await task.promise;
        if (!cancelled) setPdf(document);
      } catch { if (!cancelled) setError("Não foi possível gerar a prévia. Use Baixar para consultar o arquivo."); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; if (task) void task.destroy().catch(() => undefined); };
  }, [url, isPdf]);
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
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
    {isPdf ? <>{busy && <p role="status" className="text-xs text-slate-500">Carregando prévia…</p>}{error ? <p role="alert" className="text-xs text-slate-500">{error}</p> : <canvas ref={canvasRef} role="img" aria-label={`Prévia de ${title}`} data-page={page} data-rendered={rendered ? "true" : "false"} className="h-auto w-full rounded border bg-white" />}{pdf && <div className="flex items-center justify-between gap-1 text-[10px]"><Button size="sm" variant="ghost" aria-label="Página anterior da prévia" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button><span>Página {page} de {pdf.numPages}</span><Button size="sm" variant="ghost" aria-label="Próxima página da prévia" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}>›</Button></div>}</> : mime.startsWith("image/") ? <img src={url} alt={title} className="max-h-96 w-full rounded border object-contain" /> : <p className="text-xs text-slate-500">Prévia indisponível para este formato. Use Baixar.</p>}
  </div>;
}
