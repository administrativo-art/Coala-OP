"use client";

import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, X, Trophy, Minus, Scale } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { type PriceHistoryEntry } from "@/types";

type Entity = { id: string; name: string; fantasyName?: string };

export type ComparisonProductOption = {
  id: string; // productId
  label: string; // full product name
  baseItemId: string; // baseProductId
  unit: string;
  searchText: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: ComparisonProductOption[];
  priceHistory: PriceHistoryEntry[];
  entities: Entity[];
  initialProductId?: string;
}

function fmt(v?: number | null) {
  if (typeof v !== "number" || Number.isNaN(v)) {
    return "—";
  }

  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeSearch(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function PriceComparisonSheet({
  open,
  onOpenChange,
  products,
  priceHistory,
  entities,
  initialProductId,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialProductId ? [initialProductId] : [],
  );

  // Keep selectedIds in sync when the initial product changes
  const [lastInitial, setLastInitial] = useState(initialProductId);
  if (initialProductId !== lastInitial) {
    setLastInitial(initialProductId);
    setSelectedIds(initialProductId ? [initialProductId] : []);
  }

  const toggle = (id: string) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const filteredProducts = useMemo(() => {
    const tokens = normalizeSearch(search).split(/\s+/).filter(Boolean);
    if (!tokens.length) return products;
    return products.filter((p) =>
      tokens.every((t) => p.searchText.includes(t)),
    );
  }, [products, search]);

  // Build comparison rows: for each selected product, get its latest price entry
  type ComparisonRow = {
    product: ComparisonProductOption;
    entry: PriceHistoryEntry | null;
    entityName: string;
  };

  const rows = useMemo<ComparisonRow[]>(() => {
    return selectedIds
      .map((id) => {
        const product = products.find((p) => p.id === id);
        if (!product) return null;

        const entries = priceHistory
          .filter((e) => e.productId === id)
          .sort(
            (a, b) =>
              new Date(b.confirmedAt).getTime() -
              new Date(a.confirmedAt).getTime(),
          );

        const entry = entries[0] ?? null;
        const entity = entry
          ? entities.find((e) => e.id === entry.entityId)
          : null;
        const hasValidPrices =
          entry !== null &&
          typeof entry.price === "number" &&
          !Number.isNaN(entry.price) &&
          typeof entry.pricePerUnit === "number" &&
          !Number.isNaN(entry.pricePerUnit);

        return {
          product,
          entry: hasValidPrices ? entry : null,
          entityName: entity?.fantasyName ?? entity?.name ?? "—",
        };
      })
      .filter(Boolean) as ComparisonRow[];
  }, [selectedIds, products, priceHistory, entities]);

  // Find best price (lowest pricePerUnit among rows with history)
  const bestPricePerUnit = useMemo(() => {
    const withHistory = rows.filter((r) => r.entry !== null);
    if (!withHistory.length) return null;
    return Math.min(...withHistory.map((r) => r.entry!.pricePerUnit));
  }, [rows]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="font-purchasing flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 border-b border-violet-200 bg-violet-50/80 px-6 py-5 pr-12 text-left">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <Scale className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                Comparar preços
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                Compare o último preço efetivado por unidade base.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f6f6f7]">
          {/* Search + product list */}
          <div className="shrink-0 space-y-3 border-b border-zinc-200 bg-white p-4 sm:px-5">
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.08em] text-zinc-900">
                Produtos
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Selecione um ou mais itens para montar o comparativo.
              </p>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                placeholder="Buscar produto..."
                className="h-10 rounded-[9px] border-zinc-200 bg-zinc-50 pl-9 shadow-none"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-[12px] border border-zinc-200 bg-white">
              {filteredProducts.length === 0 ? (
                <p className="px-3 py-5 text-center text-sm text-zinc-500">
                  Nenhum produto encontrado.
                </p>
              ) : (
                filteredProducts.map((p) => {
                  const selected = selectedIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        selected
                          ? "bg-violet-50 font-bold text-violet-800"
                          : "text-zinc-700 hover:bg-zinc-50",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
                          selected
                            ? "border-violet-600 bg-violet-600"
                            : "border-zinc-300",
                        )}
                      >
                        {selected && (
                          <svg
                            viewBox="0 0 10 8"
                            className="h-2.5 w-2.5 fill-white"
                          >
                            <path
                              d="M1 4l3 3 5-6"
                              stroke="white"
                              strokeWidth="1.5"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                      <span className="flex-1 truncate">{p.label}</span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {p.unit}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {selectedIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedIds.map((id) => {
                  const p = products.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="max-w-[200px] gap-1 rounded-md bg-violet-100 pr-1 text-xs text-violet-800 hover:bg-violet-100"
                    >
                      <span className="truncate">{p.label}</span>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        className="shrink-0 rounded hover:text-rose-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Comparison table */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            {rows.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-zinc-300 bg-white text-sm text-zinc-500">
                <Scale className="h-8 w-8 text-zinc-300" />
                <span className="font-medium">
                  Selecione produtos acima para comparar.
                </span>
              </div>
            ) : (
              <>
                {/* Header labels */}
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-1 text-[10px] font-black uppercase tracking-[0.08em] text-zinc-500">
                  <span>Produto</span>
                  <span className="text-right">Preço pago</span>
                  <span className="text-right">Por unid. base</span>
                </div>

                {rows
                  .slice()
                  .sort((a, b) => {
                    if (!a.entry && !b.entry) return 0;
                    if (!a.entry) return 1;
                    if (!b.entry) return -1;
                    return a.entry.pricePerUnit - b.entry.pricePerUnit;
                  })
                  .map((row) => {
                    const isBest =
                      row.entry !== null &&
                      row.entry.pricePerUnit === bestPricePerUnit;
                    const pctAboveBest =
                      row.entry && bestPricePerUnit
                        ? ((row.entry.pricePerUnit - bestPricePerUnit) /
                            bestPricePerUnit) *
                          100
                        : null;

                    return (
                      <div
                        key={row.product.id}
                        className={cn(
                          "space-y-3 rounded-[14px] border bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)] transition-colors",
                          isBest
                            ? "border-emerald-300 bg-emerald-50/50"
                            : "border-zinc-200",
                          !row.entry && "opacity-60",
                        )}
                      >
                        {/* Product name + best badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {isBest && (
                            <Trophy className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          )}
                          <span className="text-sm font-black leading-tight text-zinc-900">
                            {row.product.label}
                          </span>
                          {isBest && (
                            <Badge className="shrink-0 rounded-md bg-emerald-600 text-xs hover:bg-emerald-600">
                              Melhor preço
                            </Badge>
                          )}
                          {pctAboveBest !== null && pctAboveBest > 0 && (
                            <Badge
                              variant="outline"
                              className="shrink-0 rounded-md border-zinc-200 bg-white text-xs text-zinc-500"
                            >
                              +{pctAboveBest.toFixed(1)}% acima
                            </Badge>
                          )}
                        </div>

                        {row.entry ? (
                          <div className="grid grid-cols-[1fr_auto_auto] items-end gap-x-4 border-t border-zinc-100 pt-3">
                            {/* Supplier + date */}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-zinc-700">
                                {row.entityName}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {format(
                                  parseISO(row.entry.confirmedAt),
                                  "dd/MM/yyyy",
                                  { locale: ptBR },
                                )}
                              </p>
                            </div>
                            {/* Price paid */}
                            <div className="text-right">
                              <p className="text-sm font-bold text-zinc-900">
                                {fmt(row.entry.price)}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {row.product.unit}
                              </p>
                            </div>
                            {/* Price per base unit */}
                            <div className="text-right">
                              <p
                                className={cn(
                                  "text-sm font-black text-zinc-900",
                                  isBest && "text-emerald-700",
                                )}
                              >
                                {fmt(row.entry.pricePerUnit)}
                              </p>
                              <p className="text-xs text-zinc-500">
                                unid. base
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 border-t border-zinc-100 pt-3 text-sm text-zinc-500">
                            <Minus className="h-3.5 w-3.5" />
                            Sem histórico efetivado
                          </div>
                        )}
                      </div>
                    );
                  })}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
