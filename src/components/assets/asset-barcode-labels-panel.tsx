"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Printer, Tags } from "lucide-react";

import { useAssets } from "@/hooks/use-assets";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { brand } from "@/config/brand";
import type { Asset } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_GENERATED_UNTIL = 1000;
const GENERATE_INCREMENT = 100;
const LABELS_PER_PRINT_PAGE = 50;

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

function BarcodeSvg({ code }: { code: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let active = true;
    import("jsbarcode")
      .then((module) => {
        if (!active || !svgRef.current) return;
        module.default(svgRef.current, code, {
          format: "CODE128",
          displayValue: false,
          height: 18,
          width: 0.8,
          margin: 0,
        });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [code]);

  return <svg ref={svgRef} aria-label={`Código de barras ${code}`} className="h-[6mm] w-full" />;
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
  const { toast } = useToast();
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
  }, [firebaseUser, toast]);

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
  const printRows = printRowsOverride ?? visibleRows;
  const labelPages = useMemo(
    () => chunkRows(printRows, LABELS_PER_PRINT_PAGE),
    [printRows]
  );

  const registeredCount = rows.filter((row) => row.status === "cadastrado").length;
  const freeCount = rows.filter((row) => row.status === "livre").length;
  const producedCount = countProducedLabels(settings.generatedUntil, settings.productionRanges ?? []);

  const openProductionDialog = () => {
    const first = findFirstNotProduced(settings.generatedUntil, settings.productionRanges ?? []);
    const safeFirst = Math.min(first, settings.generatedUntil);
    const safeLast = Math.min(settings.generatedUntil, safeFirst + LABELS_PER_PRINT_PAGE - 1);
    setProductionFrom(String(safeFirst || 1));
    setProductionTo(String(safeLast || Math.min(settings.generatedUntil, LABELS_PER_PRINT_PAGE)));
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
    return <p className="text-sm text-muted-foreground">Sem permissão para gerar etiquetas de patrimônio.</p>;
  }

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .asset-label-print-area,
          .asset-label-print-area * { visibility: visible !important; }
          .asset-label-print-area {
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

      <Card className="asset-label-print-controls">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-pink-600" />
            Etiquetas patrimoniais
          </CardTitle>
          <CardDescription>
            Sequência fixa para fabricação de placas metálicas 45x15mm com logo, numeração e código de barras CODE-128.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Geradas até</p>
              <p className="mt-1 font-mono text-xl font-bold">{makeAssetCode(settings.generatedUntil)}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Total de etiquetas</p>
              <p className="mt-1 text-xl font-bold">{rows.length}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Já cadastradas</p>
              <p className="mt-1 text-xl font-bold">{registeredCount}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Livres</p>
              <p className="mt-1 text-xl font-bold">{freeCount}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Enviadas à produção</p>
              <p className="mt-1 text-xl font-bold">{producedCount}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filtrar por código, nome ou status..."
              className="max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Gerar +100
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Gerar mais 100 etiquetas?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso vai liberar a próxima sequência de placas patrimoniais, de {makeAssetCode(settings.generatedUntil + 1)} até {makeAssetCode(settings.generatedUntil + GENERATE_INCREMENT)}. Após gerar, essas numerações passam a poder ser vinculadas a novos patrimônios.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleGenerateMore} disabled={saving}>
                      Confirmar geração
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button type="button" variant="outline" onClick={openProductionDialog}>
                <Printer className="mr-2 h-4 w-4" />
                Exportar para produzir
              </Button>
              <Button type="button" onClick={() => { setPrintRowsOverride(null); window.print(); }}>
                <Printer className="mr-2 h-4 w-4" />
                Exportar PDF
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            A exportação usa a impressão do navegador. Escolha “Salvar como PDF”. Cada etiqueta sai em 45x15mm, com 50 etiquetas por página.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="asset-label-print-controls rounded-xl border p-6 text-sm text-muted-foreground">
          Carregando patrimônios...
        </div>
      ) : null}

      <div className="asset-label-print-area space-y-4 rounded-xl border bg-white p-4">
        {labelPages.map((pageRows, pageIndex) => (
          <div key={`page-${pageIndex}`} className="asset-label-page">
            <div className="asset-label-grid grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pageRows.map((row) => (
                <div key={row.code} className="asset-label-card rounded-md border bg-white p-2 text-zinc-950 shadow-sm">
                  <div className="flex h-full min-h-0 items-center gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={brand.logo} alt="Coala" className="h-8 w-8 shrink-0 object-contain" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="font-mono text-[11px] font-black leading-none tracking-tight">{row.code}</p>
                        <div className="asset-label-screen-only flex items-center gap-1">
                          {row.productionSent ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-700">
                              Produção
                            </span>
                          ) : null}
                          <span className="rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase text-zinc-500">
                            {row.status === "cadastrado" ? "Cadastrado" : "Livre"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-0.5">
                        <BarcodeSvg code={row.code} />
                      </div>
                      <p className="asset-label-screen-only truncate text-[9px] leading-none text-zinc-500">
                        {row.asset?.name ?? "Código livre para novo patrimônio"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={productionDialogOpen} onOpenChange={setProductionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar etiquetas para produção física</DialogTitle>
            <DialogDescription>
              Informe o intervalo que será enviado para fabricação. Ao confirmar, o intervalo será marcado como enviado à produção física e o PDF será aberto.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">De</label>
              <Input
                type="number"
                min={1}
                max={settings.generatedUntil}
                value={productionFrom}
                onChange={(event) => setProductionFrom(event.target.value)}
                placeholder="1"
              />
              <p className="text-xs text-muted-foreground">{makeAssetCode(Math.max(1, Math.floor(Number(productionFrom)) || 1))}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Até</label>
              <Input
                type="number"
                min={1}
                max={settings.generatedUntil}
                value={productionTo}
                onChange={(event) => setProductionTo(event.target.value)}
                placeholder="500"
              />
              <p className="text-xs text-muted-foreground">{makeAssetCode(Math.max(1, Math.floor(Number(productionTo)) || 1))}</p>
            </div>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Exemplo: preencher <span className="font-semibold text-foreground">1</span> até <span className="font-semibold text-foreground">500</span> exporta 500 etiquetas em 10 páginas de 50 etiquetas.
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProductionDialogOpen(false)} disabled={productionSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleExportForProduction} disabled={productionSaving}>
              {productionSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              Marcar e exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
