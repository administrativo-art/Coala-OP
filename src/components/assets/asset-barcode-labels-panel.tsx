"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAssets } from "@/hooks/use-assets";
import { useAuth } from "@/hooks/use-auth";
import { brand } from "@/config/brand";
import type { Asset } from "@/types";
import { ControlPanel, ControlSearch } from "@/components/patterns/control-panel";
import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { Segmented } from "@/components/patterns/segmented";
import { SidePanel } from "@/components/patterns/side-panel";
import { StatTile } from "@/components/patterns/stat-tile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";

const DEFAULT_GENERATED_UNTIL = 1000;
const GENERATE_INCREMENT = 100;
const LABELS_PER_PRINT_PAGE = 50;
const SCREEN_BATCH_SIZE = 100;
const LABELS_PER_SCREEN_PAGE = SCREEN_BATCH_SIZE;

type BarcodeSettings = {
  generatedUntil: number;
  defaultGeneratedUntil: number;
  productionRanges: ProductionRange[];
};

type ProductionRange = {
  from: number;
  to: number;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
};

type LabelRow = {
  code: string;
  asset?: Asset;
  status: "cadastrado" | "livre";
  productionSent: boolean;
  sequence: number;
};

type ProductionTab = "not-produced" | "produced";

function makeAssetCode(sequence: number) {
  return `PAT-${String(sequence).padStart(6, "0")}`;
}

function normalizeAssetCode(value?: string | null) {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (raw.startsWith("PEND-")) return raw;
  const match = raw.match(/^PAT[-_]?(\d+)$/);
  if (match) return makeAssetCode(Number(match[1]));
  const digits = raw.replace(/\D/g, "");
  return digits ? makeAssetCode(Number(digits)) : raw;
}

function assetCodeSequence(code?: string | null) {
  const normalized = normalizeAssetCode(code);
  const match = normalized.match(/^PAT-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isSequenceInProduction(sequence: number, productionRanges: ProductionRange[]) {
  return productionRanges.some((range) => sequence >= range.from && sequence <= range.to);
}

function countProducedLabels(generatedUntil: number, productionRanges: ProductionRange[]) {
  let count = 0;
  for (let sequence = 1; sequence <= generatedUntil; sequence += 1) {
    if (isSequenceInProduction(sequence, productionRanges)) count += 1;
  }
  return count;
}

function findFirstNotProduced(generatedUntil: number, productionRanges: ProductionRange[]) {
  for (let sequence = 1; sequence <= generatedUntil; sequence += 1) {
    if (!isSequenceInProduction(sequence, productionRanges)) return sequence;
  }
  return generatedUntil + 1;
}

function buildRows(assets: Asset[], generatedUntil: number, productionRanges: ProductionRange[]): LabelRow[] {
  const normalizedAssets = assets
    .map((asset) => ({
      asset,
      code: normalizeAssetCode(asset.code),
      sequence: assetCodeSequence(asset.code),
    }))
    .filter((entry): entry is { asset: Asset; code: string; sequence: number } =>
      /^PAT-\d+$/.test(entry.code) && Number.isFinite(entry.sequence)
    );

  const assetsByCode = new Map(normalizedAssets.map((entry) => [entry.code, entry.asset]));
  const rows: LabelRow[] = [];
  const included = new Set<string>();

  for (let sequence = 1; sequence <= generatedUntil; sequence += 1) {
    const code = makeAssetCode(sequence);
    const asset = assetsByCode.get(code);
    rows.push({
      code,
      asset,
      status: asset ? "cadastrado" : "livre",
      productionSent: isSequenceInProduction(sequence, productionRanges),
      sequence,
    });
    included.add(code);
  }

  normalizedAssets
    .filter((entry) => !included.has(entry.code))
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((entry) => {
      rows.push({
        code: entry.code,
        asset: entry.asset,
        status: "cadastrado",
        productionSent: isSequenceInProduction(entry.sequence, productionRanges),
        sequence: entry.sequence,
      });
    });

  return rows;
}

function chunkRows(rows: LabelRow[], size: number) {
  const chunks: LabelRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function BarcodeSvg({ code, variant = "print" }: { code: string; variant?: "print" | "preview" }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let active = true;
    import("jsbarcode")
      .then((module) => {
        if (!active || !svgRef.current) return;
        module.default(svgRef.current, code, {
          format: "CODE128",
          displayValue: false,
          height: variant === "preview" ? 34 : 18,
          width: variant === "preview" ? 1.1 : 0.8,
          margin: 0,
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [code, variant]);

  return (
    <svg
      ref={svgRef}
      aria-label={`Código de barras ${code}`}
      className={variant === "preview" ? "h-10 w-full" : "h-[6mm] w-full"}
    />
  );
}

function AssetLabelPrintCard({ row }: { row: LabelRow }) {
  return (
    <div className="asset-label-card rounded-md border bg-white p-2 text-zinc-950 shadow-sm">
      <div className="flex h-full min-h-0 items-center gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo} alt="Coala" className="h-8 w-8 shrink-0 object-contain" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-black leading-none tracking-tight">{row.code}</p>
          <div className="mt-0.5">
            <BarcodeSvg code={row.code} />
          </div>
          <p className="asset-label-screen-only truncate text-[9px] leading-none text-zinc-500">
            {row.asset?.name ?? "Código livre para novo patrimônio"}
          </p>
        </div>
      </div>
    </div>
  );
}

function AssetLabelScreenCard({ row }: { row: LabelRow }) {
  return (
    <div className="rounded-ds-btn-lg border border-ds-border bg-white px-4 py-3 text-ds-ink">
      <div className="grid min-h-[76px] grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,320px)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo} alt="Coala" className="h-9 w-9 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="font-ds-mono text-sm font-bold leading-tight tracking-tight">{row.code}</p>
            <p className="mt-1 text-xs leading-snug text-ds-ink-muted">
              {row.asset?.name ?? "Código livre para novo patrimônio"}
            </p>
          </div>
        </div>

        <div className="min-w-0 rounded-ds-btn border border-ds-border bg-ds-warm px-3 py-2">
          <BarcodeSvg code={row.code} variant="preview" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
          <StatusPill variant={row.productionSent ? "ok" : "warn"}>{row.productionSent ? "Produção" : "Não exportada"}</StatusPill>
          <StatusPill variant="neutral">{row.status === "cadastrado" ? "Cadastrado" : "Livre"}</StatusPill>
        </div>
      </div>
    </div>
  );
}

async function authedJson<T>(
  firebaseUser: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await firebaseUser.getIdToken();
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Falha ao carregar etiquetas de patrimônio.");
  }
  return payload as T;
}

export function AssetBarcodeLabelsPanel() {
  const { assets, loading } = useAssets();
  const { firebaseUser, permissions } = useAuth();
  /* Resultado e falha em texto fixo na tela, não em toast (docs/design/feedback.md). */
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; title: string; description?: string } | null>(null);
  const toast = ({ variant, title, description }: { variant?: "destructive"; title: string; description?: string }) =>
    setNotice({ kind: variant === "destructive" ? "error" : "ok", title, description });
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  const [settings, setSettings] = useState<BarcodeSettings>({
    generatedUntil: DEFAULT_GENERATED_UNTIL,
    defaultGeneratedUntil: DEFAULT_GENERATED_UNTIL,
    productionRanges: [],
  });
  const [saving, setSaving] = useState(false);
  const [productionSaving, setProductionSaving] = useState(false);
  const [productionDialogOpen, setProductionDialogOpen] = useState(false);
  const [productionFrom, setProductionFrom] = useState("1");
  const [productionTo, setProductionTo] = useState("50");
  const [printRowsOverride, setPrintRowsOverride] = useState<LabelRow[] | null>(null);
  const [filter, setFilter] = useState("");
  const [productionTab, setProductionTab] = useState<ProductionTab>("not-produced");
  const [screenPage, setScreenPage] = useState(1);

  const loadSettings = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      setSettings(await authedJson<BarcodeSettings>(firebaseUser, "/api/assets/barcode-labels"));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao carregar sequência",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const clearProductionPrintMode = () => setPrintRowsOverride(null);
    window.addEventListener("afterprint", clearProductionPrintMode);
    return () => window.removeEventListener("afterprint", clearProductionPrintMode);
  }, []);

  const rows = useMemo(
    () => buildRows(assets, settings.generatedUntil, settings.productionRanges ?? []),
    [assets, settings.generatedUntil, settings.productionRanges]
  );
  const visibleRows = useMemo(() => {
    const term = filter.trim().toUpperCase();
    if (!term) return rows;
    return rows.filter((row) =>
      row.code.includes(term) ||
      row.asset?.name?.toUpperCase().includes(term) ||
      row.status.toUpperCase().includes(term) ||
      (row.productionSent && "PRODUCAO PRODUÇÃO ENVIADA".includes(term))
    );
  }, [filter, rows]);
  const notProducedRows = useMemo(
    () => visibleRows.filter((row) => !row.productionSent),
    [visibleRows]
  );
  const producedRows = useMemo(
    () => visibleRows.filter((row) => row.productionSent),
    [visibleRows]
  );
  const activeRows = productionTab === "produced" ? producedRows : notProducedRows;
  const screenPageCount = Math.max(1, Math.ceil(activeRows.length / LABELS_PER_SCREEN_PAGE));
  const currentScreenPage = Math.min(screenPage, screenPageCount);
  const screenRowsStartIndex = (currentScreenPage - 1) * LABELS_PER_SCREEN_PAGE;
  const screenRows = activeRows.slice(screenRowsStartIndex, screenRowsStartIndex + LABELS_PER_SCREEN_PAGE);
  const screenBatches = useMemo(
    () => chunkRows(screenRows, SCREEN_BATCH_SIZE),
    [screenRows]
  );
  const printRows = printRowsOverride ?? activeRows;
  const labelPages = useMemo(
    () => chunkRows(printRows, LABELS_PER_PRINT_PAGE),
    [printRows]
  );

  useEffect(() => {
    setScreenPage(1);
  }, [filter, productionTab]);

  useEffect(() => {
    setScreenPage((current) => Math.min(current, screenPageCount));
  }, [screenPageCount]);

  const registeredCount = rows.filter((row) => row.status === "cadastrado").length;
  const freeCount = rows.filter((row) => row.status === "livre").length;
  const producedCount = countProducedLabels(settings.generatedUntil, settings.productionRanges ?? []);

  const openProductionDialog = () => {
    const first = findFirstNotProduced(settings.generatedUntil, settings.productionRanges ?? []);
    if (first > settings.generatedUntil) {
      toast({
        title: "Todas as etiquetas já foram exportadas",
        description: "Gere uma nova sequência ou consulte a aba de etiquetas já exportadas.",
      });
      return;
    }
    const safeFirst = Math.min(first, settings.generatedUntil);
    const safeLast = Math.min(settings.generatedUntil, safeFirst + LABELS_PER_SCREEN_PAGE - 1);
    setProductionFrom(String(safeFirst || 1));
    setProductionTo(String(safeLast || Math.min(settings.generatedUntil, LABELS_PER_SCREEN_PAGE)));
    setProductionDialogOpen(true);
  };

  const handleGenerateMore = async () => {
    if (!firebaseUser) return;
    setSaving(true);
    try {
      const result = await authedJson<BarcodeSettings>(firebaseUser, "/api/assets/barcode-labels", {
        method: "POST",
        body: JSON.stringify({ incrementBy: GENERATE_INCREMENT }),
      });
      setSettings((current) => ({
        ...current,
        generatedUntil: result.generatedUntil,
        productionRanges: result.productionRanges ?? current.productionRanges,
      }));
      toast({
        title: "Numeração gerada",
        description: `Foram liberadas mais ${GENERATE_INCREMENT} etiquetas, até ${makeAssetCode(result.generatedUntil)}.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao gerar numeração",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
      setConfirmingGenerate(false);
    }
  };

  const handleExportForProduction = async () => {
    if (!firebaseUser) return;
    const from = Math.floor(Number(productionFrom));
    const to = Math.floor(Number(productionTo));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      toast({
        variant: "destructive",
        title: "Intervalo inválido",
        description: "Informe um intervalo válido. Exemplo: 1 até 500.",
      });
      return;
    }
    if (to > settings.generatedUntil) {
      toast({
        variant: "destructive",
        title: "Intervalo acima da numeração gerada",
        description: `Hoje existem etiquetas geradas até ${makeAssetCode(settings.generatedUntil)}.`,
      });
      return;
    }

    setProductionSaving(true);
    try {
      const selectedRows = rows.filter((row) => row.sequence >= from && row.sequence <= to);
      const result = await authedJson<BarcodeSettings>(firebaseUser, "/api/assets/barcode-labels", {
        method: "POST",
        body: JSON.stringify({ action: "mark-production", from, to }),
      });
      setSettings((current) => ({
        ...current,
        generatedUntil: result.generatedUntil,
        productionRanges: result.productionRanges ?? current.productionRanges,
      }));
      setPrintRowsOverride(selectedRows);
      setProductionDialogOpen(false);
      toast({
        title: "Intervalo enviado para produção",
        description: `${makeAssetCode(from)} até ${makeAssetCode(to)} foi marcado e será exportado para PDF.`,
      });
      window.setTimeout(() => window.print(), 100);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao exportar para produção",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setProductionSaving(false);
    }
  };

  if (!permissions.assets?.printLabels) {
    return <p className="text-sm text-ds-ink-muted">Sem permissão para gerar etiquetas de patrimônio.</p>;
  }

  return (
    <div className="space-y-5">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .asset-label-print-area,
          .asset-label-print-area * { visibility: visible !important; }
          .asset-label-print-area {
            display: block !important;
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            background: white !important;
            color: black !important;
            padding: 0 !important;
          }
          .asset-label-print-controls,
          .asset-label-print-controls * {
            display: none !important;
          }
          .asset-label-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 45mm) !important;
            grid-template-rows: repeat(10, 15mm) !important;
            gap: 2mm !important;
            align-items: start !important;
            justify-content: start !important;
          }
          .asset-label-page {
            break-after: page !important;
            page-break-after: always !important;
            margin: 0 !important;
          }
          .asset-label-page:last-child {
            break-after: auto !important;
            page-break-after: auto !important;
          }
          .asset-label-card {
            width: 45mm !important;
            height: 15mm !important;
            break-inside: avoid !important;
            overflow: hidden !important;
            border: 0.25mm solid #111 !important;
            border-radius: 1.5mm !important;
            padding: 1mm 1.25mm !important;
            box-shadow: none !important;
          }
          .asset-label-screen-only { display: none !important; }
        }
        @page {
          size: A4 landscape;
          margin: 8mm;
        }
      `}</style>

      <div className="asset-label-print-controls space-y-5">
        <ControlPanel className="flex flex-col gap-[18px] px-[26px] pb-5 pt-[22px]">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Etiquetas patrimoniais</span>
          <p className="max-w-3xl text-[13px] text-ds-on-dark-sub">
            Sequência fixa para placas metálicas 45x15mm com logo, numeração e código de barras CODE-128.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <ControlSearch value={filter} onChange={setFilter} placeholder="Filtrar por código, nome ou status" />
            <Button type="button" variant="on-dark-secondary" size="xl" disabled={saving} onClick={() => setConfirmingGenerate(true)} className="whitespace-nowrap">
              Gerar +100
            </Button>
            <Button type="button" variant="on-dark-secondary" size="xl" onClick={openProductionDialog} className="whitespace-nowrap">
              Exportar para produzir
            </Button>
            <Button
              type="button"
              variant="primary-page"
              size="xl"
              onClick={() => { setPrintRowsOverride(null); window.print(); }}
              disabled={activeRows.length === 0}
              className="whitespace-nowrap"
            >
              Exportar PDF
            </Button>
          </div>
        </ControlPanel>

        {confirmingGenerate ? (
          <InlineConfirm
            message={`Gerar mais ${GENERATE_INCREMENT} etiquetas, de ${makeAssetCode(settings.generatedUntil + 1)} até ${makeAssetCode(settings.generatedUntil + GENERATE_INCREMENT)}? Essas numerações passam a poder ser vinculadas a novos patrimônios.`}
            confirmLabel="Confirmar geração"
            loadingLabel="Gerando…"
            loading={saving}
            onCancel={() => setConfirmingGenerate(false)}
            onConfirm={() => void handleGenerateMore()}
          />
        ) : null}

        {notice ? (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`flex items-start justify-between gap-3 rounded-ds-btn border px-3.5 py-3 text-[12.5px] font-semibold ${
              notice.kind === "error" ? "border-ds-confirm-border bg-ds-confirm-bg text-ds-confirm-ink" : "border-ds-border bg-ds-surface text-ds-ink-2"
            }`}
          >
            <span>
              {notice.title}
              {notice.description ? <span className="block font-normal">{notice.description}</span> : null}
            </span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 font-bold underline-offset-2 hover:underline">Dispensar</button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile label="Geradas até" value={<span className="font-ds-mono text-[22px]">{makeAssetCode(settings.generatedUntil)}</span>} />
          <StatTile label="Total de etiquetas" value={rows.length} />
          <StatTile label="Já cadastradas" value={registeredCount} />
          <StatTile label="Livres" value={freeCount} />
          <StatTile label="Enviadas à produção" value={producedCount} />
        </div>

        <p className="text-xs text-ds-ink-muted">
          A visualização mostra um lote de 100 etiquetas por página. No PDF, cada etiqueta sai em 45x15mm e o navegador monta 50 etiquetas por página.
        </p>

        {loading ? (
          <div role="status" className="rounded-ds-card border border-ds-border p-6 text-sm text-ds-ink-muted">Carregando patrimônios…</div>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Segmented
            value={productionTab}
            onChange={setProductionTab}
            aria-label="Situação das etiquetas"
            options={[
              { value: "not-produced", label: `Não exportadas · ${notProducedRows.length}` },
              { value: "produced", label: `Exportadas para produção · ${producedRows.length}` },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-ds-ink-muted">
            <span className="font-ds-mono">
              {screenRows.length > 0 ? `${screenRows[0].code} a ${screenRows[screenRows.length - 1].code}` : "Sem etiquetas nesta aba"}
            </span>
            <Button type="button" variant="ds-secondary" size="xs" aria-label="Página anterior" onClick={() => setScreenPage((page) => Math.max(1, page - 1))} disabled={currentScreenPage <= 1}>‹</Button>
            <span className="min-w-24 text-center">Página {currentScreenPage} de {screenPageCount}</span>
            <Button type="button" variant="ds-secondary" size="xs" aria-label="Próxima página" onClick={() => setScreenPage((page) => Math.min(screenPageCount, page + 1))} disabled={currentScreenPage >= screenPageCount}>›</Button>
          </div>
        </div>

        {screenBatches.length === 0 ? (
          <div className="rounded-ds-card-lg border border-dashed border-ds-border-input p-8 text-center text-sm text-ds-ink-muted">
            Nenhuma etiqueta encontrada para esta aba.
          </div>
        ) : (
          screenBatches.map((batchRows, batchIndex) => {
            const batchNumber = (currentScreenPage - 1) * (LABELS_PER_SCREEN_PAGE / SCREEN_BATCH_SIZE) + batchIndex + 1;
            return (
              <section key={`batch-${currentScreenPage}-${batchIndex}`} className="rounded-ds-card-lg border border-ds-border bg-ds-warm p-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-extrabold">Lote {batchNumber}</p>
                    <p className="font-ds-mono text-xs text-ds-ink-muted">{batchRows[0]?.code} a {batchRows[batchRows.length - 1]?.code}</p>
                  </div>
                  <span className="text-xs font-semibold text-ds-ink-muted">{batchRows.length} etiqueta(s)</span>
                </div>
                <div className="grid grid-cols-1 gap-2 2xl:grid-cols-2">
                  {batchRows.map((row) => (
                    <AssetLabelScreenCard key={row.code} row={row} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      <div className="asset-label-print-area hidden space-y-4 bg-white">
        {labelPages.map((pageRows, pageIndex) => (
          <div key={`page-${pageIndex}`} className="asset-label-page">
            <div className="asset-label-grid grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pageRows.map((row) => (
                <AssetLabelPrintCard key={row.code} row={row} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <SidePanel
        open={productionDialogOpen}
        onOpenChange={(open) => { if (!productionSaving) setProductionDialogOpen(open); }}
        kicker="Produção física"
        title="Exportar etiquetas para produzir"
        subtitle="Marca o intervalo como enviado à produção e abre o PDF."
        className="asset-label-print-controls"
      >
        <form
          noValidate
          className="flex flex-1 flex-col gap-5"
          onSubmit={(event) => { event.preventDefault(); void handleExportForProduction(); }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="De" htmlFor="production-from" hint={makeAssetCode(Math.max(1, Math.floor(Number(productionFrom)) || 1))}>
              <Input id="production-from" type="number" min={1} max={settings.generatedUntil} value={productionFrom} onChange={(event) => setProductionFrom(event.target.value)} placeholder="1" className={fieldInputClass} />
            </Field>
            <Field label="Até" htmlFor="production-to" hint={makeAssetCode(Math.max(1, Math.floor(Number(productionTo)) || 1))}>
              <Input id="production-to" type="number" min={1} max={settings.generatedUntil} value={productionTo} onChange={(event) => setProductionTo(event.target.value)} placeholder="500" className={fieldInputClass} />
            </Field>
          </div>
          <p className="rounded-ds-btn border border-ds-border bg-ds-surface px-3.5 py-3 text-xs text-ds-ink-muted">
            Exemplo: de <strong className="text-ds-ink">1</strong> até <strong className="text-ds-ink">500</strong> exporta 500 etiquetas em 10 páginas de 50. Hoje há etiquetas geradas até {makeAssetCode(settings.generatedUntil)}.
          </p>
          {notice?.kind === "error" ? (
            <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{notice.title}{notice.description ? ` ${notice.description}` : ""}</p>
          ) : null}
          <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
            <Button type="button" variant="ds-secondary" size="md" disabled={productionSaving} onClick={() => setProductionDialogOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary-modal" size="md" loading={productionSaving}>Marcar e exportar</Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
