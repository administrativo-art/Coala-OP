"use client";

import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Check, FileSignature, Loader2, Plus, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  addAdmissionSignaturePlacement,
  canRemoveAdmissionSignaturePlacement,
  defaultAdmissionSignatureLayout,
  moveAdmissionSignaturePlacement,
  removeAdmissionSignaturePlacement,
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
};

function markerLabel(position: AdmissionSignaturePlacement) {
  return position.element === "SIGNATURE" ? "Assinatura" : "Rubrica";
}

function DraggableMarker({
  position,
  active,
  removable,
  onSelect,
  onRemove,
}: {
  position: AdmissionSignaturePlacement;
  active: boolean;
  removable: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: position.id,
  });
  const company = position.party === "company";
  const signature = position.element === "SIGNATURE";
  const label = `${markerLabel(position)} de ${company ? "empregador" : "colaborador"}`;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={(event) => {
        onSelect();
        listeners?.onPointerDown?.(event);
      }}
      onClick={onSelect}
      className={`absolute z-10 flex cursor-grab touch-none select-none items-center justify-center gap-1 rounded-md border-2 px-1.5 text-[9px] font-black shadow-lg active:cursor-grabbing sm:px-2 sm:text-[10px] ${
        signature ? "h-10 min-w-[92px] sm:min-w-[118px]" : "h-8 min-w-[44px] sm:min-w-[72px]"
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
      aria-label={label}
    >
      <span>{markerLabel(position)}</span>
      <button
        type="button"
        disabled={!removable}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/90 text-current shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
        aria-label={`Remover ${label.toLowerCase()}`}
        title={removable ? `Remover ${label.toLowerCase()}` : "Cada signatário precisa manter ao menos uma assinatura"}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function PdfPageStage({
  pdf,
  pageNumber,
  positions,
  activePlacementId,
  onSelectPage,
  onSelectPlacement,
  onRemovePlacement,
  canRemovePlacement,
  onStageRef,
  onRenderTaskChange,
  onVisibilityChange,
  onRenderError,
  scrollRootRef,
}: {
  pdf: PdfDocument;
  pageNumber: number;
  positions: AdmissionSignaturePlacement[];
  activePlacementId: string | null;
  onSelectPage: (page: number) => void;
  onSelectPlacement: (position: AdmissionSignaturePlacement) => void;
  onRemovePlacement: (position: AdmissionSignaturePlacement) => void;
  canRemovePlacement: (position: AdmissionSignaturePlacement) => boolean;
  onStageRef: (page: number, node: HTMLDivElement | null) => void;
  onRenderTaskChange: (page: number, task: PdfRenderTask | null, completedTask?: PdfRenderTask) => void;
  onVisibilityChange: (page: number, ratio: number) => void;
  onRenderError: () => void;
  scrollRootRef: RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [pageRatio, setPageRatio] = useState(1.414);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    onStageRef(pageNumber, stage);
    const observer = new ResizeObserver(([entry]) => {
      setStageWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      onStageRef(pageNumber, null);
    };
  }, [onStageRef, pageNumber]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const lazyObserver = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { root: scrollRootRef.current, rootMargin: "900px 0px" },
    );
    const activeObserver = new IntersectionObserver(
      ([entry]) => onVisibilityChange(pageNumber, entry.intersectionRatio),
      { root: scrollRootRef.current, threshold: [0, 0.15, 0.3, 0.5, 0.75, 1] },
    );
    lazyObserver.observe(stage);
    activeObserver.observe(stage);
    return () => {
      lazyObserver.disconnect();
      activeObserver.disconnect();
      onVisibilityChange(pageNumber, 0);
    };
  }, [onVisibilityChange, pageNumber, scrollRootRef]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      const previousTask = renderTaskRef.current;
      if (previousTask) {
        previousTask.cancel();
        await previousTask.promise.catch(() => undefined);
      }
      if (cancelled) return;
      if (!nearViewport || !canvasRef.current || stageWidth < 80) {
        if (canvasRef.current) {
          canvasRef.current.width = 1;
          canvasRef.current.height = 1;
        }
        return;
      }
      try {
        const pdfPage = await pdf.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setPageRatio(base.height / base.width);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: (stageWidth / base.width) * pixelRatio });
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const renderTask = pdfPage.render({ canvasContext: context, viewport, canvas });
        renderTaskRef.current = renderTask;
        onRenderTaskChange(pageNumber, renderTask);
        try {
          await renderTask.promise;
        } catch (caught) {
          if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
            onRenderError();
          }
        } finally {
          if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
          onRenderTaskChange(pageNumber, null, renderTask);
        }
      } catch (caught) {
        if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          onRenderError();
        }
      }
    }
    void renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [nearViewport, onRenderError, onRenderTaskChange, pageNumber, pdf, stageWidth]);

  return (
    <section className="scroll-mt-4" aria-label={`Página ${pageNumber}`}>
      <button
        type="button"
        onClick={() => onSelectPage(pageNumber)}
        className="mx-auto mb-2 block rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm"
      >
        Página {pageNumber}
      </button>
      <div
        ref={stageRef}
        onPointerDown={() => onSelectPage(pageNumber)}
        className="relative mx-auto w-full max-w-[820px] overflow-hidden bg-white shadow-xl"
        style={{ aspectRatio: `1 / ${pageRatio}` }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {positions.map((position) => (
          <DraggableMarker
            key={position.id}
            position={position}
            active={position.id === activePlacementId}
            removable={canRemovePlacement(position)}
            onSelect={() => onSelectPlacement(position)}
            onRemove={() => onRemovePlacement(position)}
          />
        ))}
        {!nearViewport ? (
          <div className="absolute inset-0 grid place-items-center bg-white text-xs font-bold text-slate-400">
            Página {pageNumber}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function clamp(value: number, min = 0, max = 98) {
  return Math.min(max, Math.max(min, value));
}

function serializedLayout(layout: AdmissionSignatureLayout | null) {
  return layout ? JSON.stringify(layout) : "";
}

export default function SignaturePlacementEditor({
  onboardingId,
  getToken,
  workflow,
  onClose,
  onWorkflowUpdated,
}: Props) {
  const packageState = workflow.signaturePackage;
  const [layout, setLayout] = useState<AdmissionSignatureLayout | null>(packageState?.layout ?? null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [activeParty, setActiveParty] = useState<AdmissionSignatureParty>("employee");
  const [activePlacementId, setActivePlacementId] = useState<string | null>(
    packageState?.layout?.positions[0]?.id ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<"saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedLayoutRef = useRef(serializedLayout(packageState?.layout ?? null));
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const stageRefs = useRef(new Map<number, HTMLDivElement>());
  const renderTasks = useRef(new Map<number, PdfRenderTask>());
  const visibleRatios = useRef(new Map<number, number>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const next = packageState?.layout ?? null;
    setLayout(next);
    savedLayoutRef.current = serializedLayout(next);
    setActivePlacementId((current) => (
      next?.positions.some((position) => position.id === current)
        ? current
        : next?.positions[0]?.id ?? null
    ));
  }, [packageState?.layout]);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    async function loadPdf() {
      try {
        setLoading(true);
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
          await loaded.destroy().catch(() => undefined);
          return;
        }
        if (!packageState?.layout || loaded.numPages !== packageState.layout.pageCount) {
          throw new Error("O PDF aberto não corresponde ao posicionamento preparado.");
        }
        setPdf(loaded);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Falha ao abrir o PDF.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPdf();
    return () => {
      cancelled = true;
      for (const task of renderTasks.current.values()) task.cancel();
      renderTasks.current.clear();
      if (loaded) void loaded.destroy().catch(() => undefined);
    };
  }, [getToken, onboardingId, packageState?.layout?.packageHash, packageState?.layout?.pageCount]);

  const registerStage = useCallback((page: number, node: HTMLDivElement | null) => {
    if (node) stageRefs.current.set(page, node);
    else stageRefs.current.delete(page);
  }, []);

  const registerRenderTask = useCallback((page: number, task: PdfRenderTask | null, completedTask?: PdfRenderTask) => {
    if (task) renderTasks.current.set(page, task);
    else if (!completedTask || renderTasks.current.get(page) === completedTask) renderTasks.current.delete(page);
  }, []);

  const handleVisibilityChange = useCallback((page: number, ratio: number) => {
    visibleRatios.current.set(page, ratio);
    let mostVisiblePage = page;
    let largestRatio = -1;
    for (const [candidatePage, candidateRatio] of visibleRatios.current) {
      if (candidateRatio > largestRatio) {
        largestRatio = candidateRatio;
        mostVisiblePage = candidatePage;
      }
    }
    if (largestRatio > 0) setActivePage(mostVisiblePage);
  }, []);

  const handleRenderError = useCallback(() => {
    setError("Não foi possível renderizar uma das páginas.");
  }, []);

  const positionsByPage = useMemo(() => {
    const grouped = new Map<number, AdmissionSignaturePlacement[]>();
    for (const position of layout?.positions ?? []) {
      const current = grouped.get(position.page) ?? [];
      current.push(position);
      grouped.set(position.page, current);
    }
    return grouped;
  }, [layout]);

  const activePlacement = layout?.positions.find((position) => position.id === activePlacementId) ?? null;
  const activeInitial = layout?.positions.find(
    (position) => position.party === activeParty
      && position.element === "INITIALS"
      && position.page === activePage,
  );
  const hasActiveInitial = Boolean(activeInitial);
  const dirty = serializedLayout(layout) !== savedLayoutRef.current;
  const needsSave = dirty || !packageState?.placementReady;

  function updatePosition(position: AdmissionSignaturePlacement, delta: { x: number; y: number }) {
    const stage = stageRefs.current.get(position.page);
    if (!layout || !stage) return;
    const x = clamp(position.x + (delta.x / stage.clientWidth) * 100);
    const y = clamp(position.y + (delta.y / stage.clientHeight) * 100, 0, 96);
    setLayout(moveAdmissionSignaturePlacement({
      layout,
      placementId: position.id,
      x,
      y,
    }));
  }

  function onDragEnd(event: DragEndEvent) {
    if (!layout) return;
    const position = layout.positions.find((candidate) => candidate.id === event.active.id);
    if (!position) return;
    updatePosition(position, event.delta);
  }

  function addPlacement(element: AdmissionSignatureElement) {
    if (!layout) return;
    const next = addAdmissionSignaturePlacement({
      layout,
      party: activeParty,
      element,
      page: activePage,
    });
    const previousIds = new Set(layout.positions.map((position) => position.id));
    const added = next.positions.find((position) => !previousIds.has(position.id));
    setLayout(next);
    if (added) setActivePlacementId(added.id);
  }

  function removePlacement(position: AdmissionSignaturePlacement) {
    if (!layout) return;
    const next = removeAdmissionSignaturePlacement({ layout, placementId: position.id });
    if (next === layout) return;
    setLayout(next);
    setActivePlacementId((current) => current === position.id
      ? next.positions.find((candidate) => candidate.page === position.page)?.id
        ?? next.positions[0]?.id
        ?? null
      : current);
  }

  function applyInitialsToEveryPage() {
    if (!layout || !activeInitial) return;
    setLayout(moveAdmissionSignaturePlacement({
      layout,
      placementId: activeInitial.id,
      x: activeInitial.x,
      y: activeInitial.y,
      repeatInitials: true,
    }));
  }

  function restoreDefaults() {
    if (!packageState?.packageHash || !packageState.pageCount) return;
    const next = defaultAdmissionSignatureLayout({
      packageHash: packageState.packageHash,
      pageCount: packageState.pageCount,
    });
    setLayout(next);
    setActivePage(1);
    setActivePlacementId(next.positions[0]?.id ?? null);
  }

  async function post(action: "save_positions", body: Record<string, unknown>) {
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

  async function save(closeAfter: boolean) {
    if (!layout || actionBusy) return;
    setActionBusy("saving");
    setError(null);
    try {
      const saved = await post("save_positions", { layout });
      const savedLayout = saved.signaturePackage?.layout ?? layout;
      savedLayoutRef.current = serializedLayout(savedLayout);
      setLayout(savedLayout);
      onWorkflowUpdated(saved);
      if (closeAfter) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar o posicionamento.");
    } finally {
      setActionBusy(null);
    }
  }

  function requestClose() {
    if (actionBusy) return;
    if (needsSave) {
      void save(true);
      return;
    }
    onClose();
  }

  const signers = packageState?.signers ?? [];
  const pageCount = layout?.pageCount ?? 0;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm">
      <div className="flex max-h-[96vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-violet-700">Posicionamento no pacote completo</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">Assinaturas e rubricas</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Role o documento e arraste os campos sobre o PDF exato que será enviado.</p>
          </div>
          <button type="button" onClick={requestClose} disabled={!!actionBusy} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50" aria-label="Voltar à preparação do envio">
            {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_330px] lg:grid-rows-1">
          <main ref={scrollRootRef} className="min-h-0 overflow-auto bg-slate-100 p-4 lg:p-6">
            {loading ? (
              <div className="grid min-h-[420px] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-violet-700" /></div>
            ) : pdf && layout ? (
              <DndContext sensors={sensors} onDragEnd={onDragEnd}>
                <div className="mx-auto max-w-[860px] space-y-7">
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                    <PdfPageStage
                      key={pageNumber}
                      pdf={pdf}
                      pageNumber={pageNumber}
                      positions={positionsByPage.get(pageNumber) ?? []}
                      activePlacementId={activePlacementId}
                      onSelectPage={setActivePage}
                      onSelectPlacement={(position) => {
                        setActivePage(position.page);
                        setActiveParty(position.party);
                        setActivePlacementId(position.id);
                      }}
                      onRemovePlacement={removePlacement}
                      canRemovePlacement={(position) => canRemoveAdmissionSignaturePlacement(layout, position.id)}
                      onStageRef={registerStage}
                      onRenderTaskChange={registerRenderTask}
                      onVisibilityChange={handleVisibilityChange}
                      onRenderError={handleRenderError}
                      scrollRootRef={scrollRootRef}
                    />
                  ))}
                </div>
              </DndContext>
            ) : null}
          </main>

          <aside className="max-h-[42vh] min-h-0 overflow-auto border-t border-slate-200 p-5 lg:max-h-none lg:border-l lg:border-t-0">
            <div className="sticky top-0 bg-white pb-1">
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-black text-slate-700">
                Página ativa: {activePage} de {pageCount}
              </span>
            </div>
            <p className="mt-4 text-[11px] font-black uppercase tracking-wider text-slate-500">Signatários</p>
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
              <p className="text-xs font-black text-slate-900">Adicionar na página {activePage}</p>
              <p className="mt-1 text-[11px] font-semibold text-slate-500">Para {activeParty === "employee" ? "o colaborador" : "o empregador"}</p>
              <div className="mt-3 grid gap-2">
                <button type="button" onClick={() => addPlacement("SIGNATURE")} disabled={!layout || !!actionBusy} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 text-[11px] font-black text-violet-700 hover:bg-violet-50 disabled:opacity-50">
                  <Plus className="h-3.5 w-3.5" />Adicionar assinatura
                </button>
                <button type="button" onClick={() => addPlacement("INITIALS")} disabled={!layout || hasActiveInitial || !!actionBusy} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                  <Plus className="h-3.5 w-3.5" />{hasActiveInitial ? "Rubrica já adicionada" : "Adicionar rubrica"}
                </button>
              </div>
            </div>

            {activePlacement ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-black text-slate-900">Campo selecionado</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">
                  {activePlacement.party === "employee" ? "Colaborador" : "Empregador"} · {activePlacement.element === "INITIALS" ? "Rubrica" : "Assinatura"} · página {activePlacement.page}
                </p>
                {activePlacement.element === "INITIALS" ? (
                  <button type="button" onClick={applyInitialsToEveryPage} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-3 text-[11px] font-black text-violet-700 hover:bg-violet-50">
                    <Check className="h-3.5 w-3.5" />Alinhar rubricas nesta altura em todas as páginas
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold leading-relaxed text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              As assinaturas são obrigatórias. Rubricas são opcionais e, quando as duas existem na mesma página, permanecem alinhadas lado a lado na lateral.
            </div>
            {error ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p> : null}

            <div className="mt-5 space-y-2">
              <button type="button" onClick={restoreDefaults} disabled={!!actionBusy} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="h-4 w-4" />Restaurar padrão</button>
              <button type="button" onClick={() => void save(false)} disabled={!!actionBusy || !layout || !needsSave} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 text-xs font-black text-violet-700 hover:bg-violet-100 disabled:opacity-50">{actionBusy === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar rascunho</button>
              <button type="button" onClick={requestClose} disabled={!!actionBusy || !layout} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-xs font-black text-white shadow-lg shadow-pink-600/20 hover:bg-pink-700 disabled:opacity-50">{actionBusy === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}{needsSave ? "Salvar e voltar ao envio" : "Voltar ao envio"}</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
