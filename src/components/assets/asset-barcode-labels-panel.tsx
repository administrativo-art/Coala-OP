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

const DEFAULT_GENERATED_UNTIL = 1000;
const GENERATE_INCREMENT = 100;

type BarcodeSettings = {
  generatedUntil: number;
  defaultGeneratedUntil: number;
};

type LabelRow = {
  code: string;
  asset?: Asset;
  status: "cadastrado" | "livre";
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

function buildRows(assets: Asset[], generatedUntil: number): LabelRow[] {
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
    rows.push({ code, asset, status: asset ? "cadastrado" : "livre" });
    included.add(code);
  }

  normalizedAssets
    .filter((entry) => !included.has(entry.code))
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((entry) => {
      rows.push({ code: entry.code, asset: entry.asset, status: "cadastrado" });
    });

  return rows;
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
  });
  const [saving, setSaving] = useState(false);
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

  const rows = useMemo(
    () => buildRows(assets, settings.generatedUntil),
    [assets, settings.generatedUntil]
  );
  const visibleRows = useMemo(() => {
    const term = filter.trim().toUpperCase();
    if (!term) return rows;
    return rows.filter((row) =>
      row.code.includes(term) ||
      row.asset?.name?.toUpperCase().includes(term) ||
      row.status.toUpperCase().includes(term)
    );
  }, [filter, rows]);

  const registeredCount = rows.filter((row) => row.status === "cadastrado").length;
  const freeCount = rows.filter((row) => row.status === "livre").length;

  const handleGenerateMore = async () => {
    if (!firebaseUser) return;
    setSaving(true);
    try {
      const result = await authedJson<BarcodeSettings>(firebaseUser, "/api/assets/barcode-labels", {
        method: "POST",
        body: JSON.stringify({ incrementBy: GENERATE_INCREMENT }),
      });
      setSettings((current) => ({ ...current, generatedUntil: result.generatedUntil }));
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
            grid-template-columns: repeat(4, 45mm) !important;
            gap: 2mm !important;
            align-items: start !important;
            justify-content: start !important;
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
          size: A4;
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
          <div className="grid gap-3 md:grid-cols-4">
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
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filtrar por código, nome ou status..."
              className="max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleGenerateMore} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Gerar +100
              </Button>
              <Button type="button" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Exportar PDF
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            A exportação usa a impressão do navegador. Escolha “Salvar como PDF”. Cada etiqueta sai em 45x15mm.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="asset-label-print-controls rounded-xl border p-6 text-sm text-muted-foreground">
          Carregando patrimônios...
        </div>
      ) : null}

      <div className="asset-label-print-area rounded-xl border bg-white p-4">
        <div className="asset-label-grid grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleRows.map((row) => (
            <div key={row.code} className="asset-label-card rounded-md border bg-white p-2 text-zinc-950 shadow-sm">
              <div className="flex h-full min-h-0 items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.logo} alt="Coala" className="h-8 w-8 shrink-0 object-contain" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className="font-mono text-[11px] font-black leading-none tracking-tight">{row.code}</p>
                    <span className="asset-label-screen-only rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase text-zinc-500">
                      {row.status === "cadastrado" ? "Cadastrado" : "Livre"}
                    </span>
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
    </div>
  );
}
