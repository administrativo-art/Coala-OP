
"use client";

import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useKiosks } from "@/hooks/use-kiosks";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { convertValue } from "@/lib/conversion";
import { type BaseProduct, type LotEntry, type Product } from "@/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle, PackageOpen, TrendingDown, Inbox, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface RestockResult {
  baseProduct: BaseProduct;
  currentStock: number;
  minimumStock: number;
  restockNeeded: number;
  status: "ok" | "repor" | "excesso" | "sem_meta";
  stockPercentage: number | null;
}

function calcRestockResults(
  kioskId: string,
  lots: LotEntry[],
  baseProducts: BaseProduct[],
  products: Product[]
): RestockResult[] {
  return baseProducts.map((baseProduct) => {
    const minimumStock = baseProduct.stockLevels?.[kioskId]?.min;

    let currentStock = 0;
    let hasConversionError = false;

    const kioskLots = lots.filter(
      (lot) => lot.kioskId === kioskId && lot.quantity > 0
    );

    kioskLots.forEach((lot) => {
      const product = products.find((p) => p.id === lot.productId);
      if (!product || product.baseProductId !== baseProduct.id) return;

      try {
        if (baseProduct.category === "Unidade") {
          currentStock += lot.quantity * product.packageSize;
        } else if (product.category === baseProduct.category) {
          const valueInBaseUnit = convertValue(
            lot.quantity * product.packageSize,
            product.unit,
            baseProduct.unit,
            product.category
          );
          currentStock += valueInBaseUnit;
        }
      } catch {
        hasConversionError = true;
      }
    });

    let status: RestockResult["status"] = "ok";
    let restockNeeded = 0;
    let stockPercentage: number | null = null;

    if (minimumStock === undefined || minimumStock === null) {
      status = "sem_meta";
    } else if (!hasConversionError) {
      restockNeeded = Math.max(0, minimumStock - currentStock);
      stockPercentage = minimumStock > 0 ? (currentStock / minimumStock) * 100 : null;

      if (currentStock < minimumStock) {
        status = "repor";
      } else if (minimumStock > 0 && currentStock > minimumStock * 1.5) {
        status = "excesso";
      } else {
        status = "ok";
      }
    }

    return {
      baseProduct,
      currentStock,
      minimumStock: minimumStock ?? 0,
      restockNeeded,
      status,
      stockPercentage,
    };
  });
}

function StatusBadge({ status }: { status: RestockResult["status"] }) {
  if (status === "repor")
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Repor
      </Badge>
    );
  if (status === "ok")
    return (
      <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700 hover:bg-green-100">
        <CheckCircle className="h-3 w-3" /> OK
      </Badge>
    );
  if (status === "excesso")
    return (
      <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 hover:bg-blue-100">
        <TrendingDown className="h-3 w-3" /> Excesso
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      Sem meta
    </Badge>
  );
}

export function RestockPanel() {
  const { user, permissions } = useAuth();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, loading: productsLoading } = useProducts();

  const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading;

  // Filtra quiosques pelo usuário logado
  const isAdmin = permissions.settings.manageUsers;
  const availableKiosks = useMemo(() => {
    if (isAdmin) return kiosks;
    return kiosks.filter((k) => user?.assignedKioskIds?.includes(k.id));
  }, [kiosks, user, isAdmin]);

  const [selectedKioskId, setSelectedKioskId] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (loading) return;
    if (isAdmin) {
      const matriz = kiosks.find(k => k.name.toLowerCase().includes('matriz'));
      setSelectedKioskId(matriz?.id ?? kiosks[0]?.id ?? "all");
    } else {
      setSelectedKioskId(availableKiosks[0]?.id ?? "all");
    }
  }, [loading, isAdmin, kiosks, availableKiosks]);

  // Quiosques a analisar
  const kioskIdsToAnalyze = useMemo(() => {
    if (selectedKioskId === "all") return availableKiosks.map((k) => k.id);
    return [selectedKioskId];
  }, [selectedKioskId, availableKiosks]);

  // Calcula resultados por quiosque
  const resultsByKiosk = useMemo(() => {
    if (loading) return [];
    return kioskIdsToAnalyze.map((kioskId) => {
      const kiosk = kiosks.find((k) => k.id === kioskId);
      const results = calcRestockResults(kioskId, lots, baseProducts, products)
        .filter((r) => r.status === "repor") // Só mostra quem precisa repor
        .filter((r) => r.baseProduct.name.toLowerCase().includes(search.toLowerCase())) // Busca por nome
        .sort((a, b) => (a.stockPercentage ?? 0) - (b.stockPercentage ?? 0)); // Menor percentual primeiro
      return { kiosk, results };
    });
  }, [kioskIdsToAnalyze, lots, baseProducts, products, kiosks, loading, search]);

  const totalRepor = useMemo(
    () =>
      resultsByKiosk.reduce(
        (sum, { results }) => sum + results.length,
        0
      ),
    [resultsByKiosk]
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PackageOpen className="h-5 w-5" />
              Painel de Reposição
              {totalRepor > 0 && (
                <Badge variant="destructive" className="ml-1">
                  {totalRepor} item{totalRepor > 1 ? "s" : ""} crítico{totalRepor > 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Itens com estoque abaixo do mínimo configurado.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Selecione um quiosque" />
              </SelectTrigger>
              <SelectContent>
                {availableKiosks.length > 1 && (
                  <SelectItem value="all">Todos os quiosques</SelectItem>
                )}
                {availableKiosks.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar insumo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {resultsByKiosk.length === 0 || resultsByKiosk.every(k => k.results.length === 0) ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground py-10">
            <CheckCircle className="h-10 w-10 mb-3 text-green-500" />
            <p className="font-semibold text-foreground">Estoque em dia!</p>
            <p className="text-sm">Nenhuma necessidade de reposição encontrada.</p>
          </div>
        ) : (
          resultsByKiosk.map(({ kiosk, results }) => {
            if (results.length === 0) return null;
            
            return (
              <div key={kiosk?.id}>
                {selectedKioskId === "all" && (
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
                    {kiosk?.name}
                  </h3>
                )}
                <div className="space-y-3">
                  {results.map(({ baseProduct, currentStock, minimumStock, restockNeeded, status, stockPercentage }) => (
                    <div
                      key={baseProduct.id}
                      className={cn(
                        "p-4 rounded-lg border transition-colors",
                        status === "repor" && "border-destructive/40 bg-destructive/5 shadow-sm"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{baseProduct.name}</span>
                        <StatusBadge status={status} />
                      </div>

                      {/* Barra de progresso */}
                      <Progress
                        value={Math.min(stockPercentage ?? 0, 100)}
                        className={cn(
                          "h-2 mb-2",
                          status === "repor" && "[&>div]:bg-destructive"
                        )}
                      />

                      {/* Dados numéricos */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex gap-4">
                          <span>
                            Atual:{" "}
                            <span className={cn("font-semibold", status === "repor" && "text-destructive")}>
                              {currentStock.toFixed(1)} {baseProduct.unit}
                            </span>
                          </span>
                          <span>
                            Mínimo:{" "}
                            <span className="font-semibold text-foreground">
                              {minimumStock.toFixed(1)} {baseProduct.unit}
                            </span>
                          </span>
                        </div>
                        {status === "repor" && (
                          <span className="font-semibold text-destructive">
                            Faltam: {restockNeeded.toFixed(1)} {baseProduct.unit}
                          </span>
                        )}
                        {stockPercentage !== null && (
                          <span className="text-muted-foreground">
                            {Math.min(stockPercentage, 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
