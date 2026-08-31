"use client";

import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileSignature, Loader2, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  defaultAdmissionSignatureLayout,
  moveAdmissionSignaturePlacement,
  type AdmissionSignatureElement,
  type AdmissionSignatureLayout,
  type AdmissionSignatureLayoutSigner,
  type AdmissionSignatureParty,
  type AdmissionSignaturePlacement,
} from "@/features/hr/documents/admission-signature-layout";

type PdfRenderTask = { cancel: () => void; promise: Promise<unknown> };
type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas: HTMLCanvasElement;
  }) => PdfRenderTask;
};
type PdfDocument = {
  numPages: number;
  getPage: (page: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

export type SignaturePlacementWorkflow = {
  templates: unknown[];
  documents: unknown[];
  packageTemplateIds?: string[];
  signaturePackage?: {
    status: string;
    packageHash: string | null;
    pageCount: number | null;
    placementReady: boolean;
    layout: AdmissionSignatureLayout | null;
    signers: AdmissionSignatureLayoutSigner[];
  } | null;
};

type Props = {
  onboardingId: string;
  getToken: () => Promise<string>;
  workflow: SignaturePlacementWorkflow;
  onClose: () => void;
  onWorkflowUpdated: (workflow: SignaturePlacementWorkflow) => void;
  onSent: () => void;
};

function markerId(position: AdmissionSignaturePlacement) {
  return `${position.party}:${position.element}:${position.page}`;
}

function markerLabel(position: AdmissionSignaturePlacement) {
  return position.element === "SIGNATURE" ? "Assinatura" : "Rubrica";
}

function DraggableMarker({
  position,
  active,
  onSelect,
}: {
  position: AdmissionSignaturePlacement;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: markerId(position),
  });
  const company = position.party === "company";
  const signature = position.element === "SIGNATURE";
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        onSelect();
        listeners?.onPointerDown?.(event);
      }}
      className={`absolute z-10 flex cursor-grab touch-none select-none items-center justify-center rounded-md border-2 px-2 text-[10px] font-black shadow-lg active:cursor-grabbing ${
        signature ? "h-10 min-w-[118px]" : "h-8 min-w-[72px]"
      } ${
        company
          ? "border-violet-600 bg-violet-100/95 text-violet-900"
          : "border-sky-600 bg-sky-100/95 text-sky-900"
      } ${active ? "ring-4 ring-amber-300/80" : ""} ${isDragging ? "opacity-80" : ""}`}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: CSS.Translate.toString(transform),
      }}
      aria-label={`${markerLabel(position)} de ${position.party === "employee" ? "colaborador" : "empresa"}`}
    >
      {markerLabel(position)}
    </button>
  );
}

function clamp(value: number, min = 0, max = 98) {
  return Math.min(max, Math.max(min, value));
}

export default function SignaturePlacementEditor({
  onboardingId,
  getToken,
  workflow,
  onClose,
  onWorkflowUpdated,
  onSent,
}: Props) {
  const packageState = workflow.signaturePackage;
  const [layout, setLayout] = useState<AdmissionSignatureLayout | null>(packageState?.layout ?? null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(1);
  const [pageRatio, setPageRatio] = useState(1.414);
  const [stageWidth, setStageWidth] = useState(0);
  const [activeParty, setActiveParty] = useState<AdmissionSignatureParty>("employee");
  const [activeElement, setActiveElement] = useState<AdmissionSignatureElement>("INITIALS");
  const [busy, setBusy] = useState<"loading" | "saving" | "sending" | null>("loading");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderIdRef = useRef(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    setLayout(packageState?.layout ?? null);
  }, [packageState?.layout]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    async function loadPdf() {
      try {
        setBusy("loading");
        const token = await getToken();
        const response = await fetch(
          `/api/hr/onboarding/${onboardingId}/signature-documents?package=draft`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error || "Não foi possível abrir o PDF congelado.");
        }
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        loaded = await pdfjs.getDocument({ data: await response.arrayBuffer() }).promise as unknown as PdfDocument;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        if (!layout || loaded.numPages !== layout.pageCount) {
          throw new Error("O PDF aberto não corresponde ao posicionamento preparado.");
        }
        setPdf(loaded);
        setBusy(null);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Falha ao abrir o PDF.");
          setBusy(null);
        }
      }
    }
    void loadPdf();
    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [getToken, onboardingId, layout?.packageHash, layout?.pageCount]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || stageWidth < 80) return;
    const renderId = ++renderIdRef.current;
    let renderTask: PdfRenderTask | null = null;
    void pdf.getPage(page).then((pdfPage) => {
      if (renderId !== renderIdRef.current || !canvasRef.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      setPageRatio(base.height / base.width);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: (stageWidth / base.width) * pixelRatio });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      renderTask = pdfPage.render({ canvasContext: context, viewport, canvas });
      return renderTask.promise;
    }).catch((caught) => {
      if (caught instanceof Error && caught.name === "RenderingCancelledException") return;
      setError("Não foi possível renderizar esta página.");
    });
    return () => {
      renderIdRef.current += 1;
      renderTask?.cancel();
    };
  }, [page, pdf, stageWidth]);

  const pagePositions = useMemo(
    () => layout?.positions.filter((position) => position.page === page) ?? [],
    [layout, page],
  );
  const activeInitial = layout?.positions.find(
    (position) => position.party === activeParty
      && position.element === "INITIALS"
      && position.page === page,
  );

  const updatePosition = useCallback((position: AdmissionSignaturePlacement, delta: { x: number; y: number }) => {
    const stage = stageRef.current;
    if (!layout || !stage) return;
    const x = clamp(position.x + (delta.x / stage.clientWidth) * 100);
    const y = clamp(position.y + (delta.y / stage.clientHeight) * 100, 0, 96);
    setLayout(moveAdmissionSignaturePlacement({
      layout,
      party: position.party,
      element: position.element,
      page: position.page,
      x,
      y,
    }));
  }, [layout]);

  function onDragEnd(event: DragEndEvent) {
    if (!layout) return;
    const position = layout.positions.find((candidate) => markerId(candidate) === event.active.id);
    if (!position) return;
    updatePosition(position, event.delta);
  }

  function applyInitialToEveryPage() {
    if (!layout || !activeInitial) return;
    setLayout(moveAdmissionSignaturePlacement({
      layout,
      party: activeInitial.party,
      element: "INITIALS",
      page,
      x: activeInitial.x,
      y: activeInitial.y,
      repeatInitials: true,
    }));
  }

  function restoreDefaults() {
    if (!packageState?.packageHash || !packageState.pageCount) return;
    setLayout(defaultAdmissionSignatureLayout({
      packageHash: packageState.packageHash,
      pageCount: packageState.pageCount,
    }));
  }

  async function post(action: "save_positions" | "send", body: Record<string, unknown>) {
    const token = await getToken();
    const response = await fetch(`/api/hr/onboarding/${onboardingId}/signature-documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const payload = await response.json().catch(() => ({})) as SignaturePlacementWorkflow & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Falha ao salvar o posicionamento.");
    return payload;
  }

  async function save(sendAfter: boolean) {
    if (!layout) return;
    setBusy(sendAfter ? "sending" : "saving");
    setError(null);
    try {
      const saved = await post("save_positions", { layout });
      onWorkflowUpdated(saved);
      if (!sendAfter) return;
      const sent = await post("send", { expectedPackageHash: layout.packageHash });
      onWorkflowUpdated(sent);
      onSent();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao concluir o posicionamento.");
    } finally {
      setBusy(null);
    }
  }

  const signers = packageState?.signers ?? [];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm">
      <div className="flex max-h-[96vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-violet-700">Posicionamento no pacote completo</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">Assinaturas e rubricas</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Arraste os campos sobre o PDF exato que será enviado ao Autentique.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy === "sending"} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50" aria-label="Fechar editor">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_330px]">
          <main className="min-h-0 overflow-auto bg-slate-100 p-4 lg:p-6">
            <div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 pb-3">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex h-9 items-center gap-1 rounded-xl border bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Anterior</button>
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm">Página {page} de {layout?.pageCount ?? 0}</span>
              <button type="button" disabled={!layout || page >= layout.pageCount} onClick={() => setPage((current) => Math.min(layout?.pageCount ?? current, current + 1))} className="inline-flex h-9 items-center gap-1 rounded-xl border bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40">Próxima<ChevronRight className="h-4 w-4" /></button>
            </div>
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div
                ref={stageRef}
                className="relative mx-auto w-full max-w-[820px] overflow-hidden bg-white shadow-xl"
                style={{ aspectRatio: `1 / ${pageRatio}` }}
              >
                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
                {pagePositions.map((position) => (
                  <DraggableMarker
                    key={markerId(position)}
                    position={position}
                    active={position.party === activeParty && position.element === activeElement}
                    onSelect={() => {
                      setActiveParty(position.party);
                      setActiveElement(position.element);
                    }}
                  />
                ))}
                {busy === "loading" ? (
                  <div className="absolute inset-0 grid place-items-center bg-white/90"><Loader2 className="h-8 w-8 animate-spin text-violet-700" /></div>
                ) : null}
              </div>
            </DndContext>
          </main>

          <aside className="min-h-0 overflow-auto border-l border-slate-200 p-5">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Signatários</p>
            <div className="mt-3 space-y-2">
              {signers.map((signer) => (
                <button
                  key={signer.party}
                  type="button"
                  onClick={() => setActiveParty(signer.party)}
                  className={`w-full rounded-xl border p-3 text-left ${activeParty === signer.party ? signer.party === "company" ? "border-violet-400 bg-violet-50" : "border-sky-400 bg-sky-50" : "border-slate-200"}`}
                >
                  <span className="block text-xs font-black text-slate-900">{signer.party === "employee" ? "Colaborador" : "Empregador"} · {signer.name}</span>
                  <span className="mt-1 block break-all text-[10.5px] font-semibold text-slate-500">{signer.email}</span>
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black text-slate-900">Campo selecionado</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">{activeParty === "employee" ? "Colaborador" : "Empregador"} · {activeElement === "INITIALS" ? "Rubrica" : "Assinatura"}</p>
              {activeElement === "INITIALS" && activeInitial ? (
                <button type="button" onClick={applyInitialToEveryPage} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 text-[11px] font-black text-violet-700 hover:bg-violet-50">
                  <Check className="h-3.5 w-3.5" />Aplicar esta rubrica em todas as páginas
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              O padrão mantém rubricas das duas partes em todas as páginas e assinaturas na última. Revise principalmente áreas com texto próximo às bordas.
            </div>
            {error ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p> : null}

            <div className="mt-5 space-y-2">
              <button type="button" onClick={restoreDefaults} disabled={!!busy} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="h-4 w-4" />Restaurar padrão</button>
              <button type="button" onClick={() => void save(false)} disabled={!!busy || !layout} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 text-xs font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50">{busy === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar rascunho</button>
              <button type="button" onClick={() => void save(true)} disabled={!!busy || !layout} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-xs font-black text-white shadow-lg shadow-pink-600/20 hover:bg-pink-700 disabled:opacity-50">{busy === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}Confirmar e enviar pacote</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
