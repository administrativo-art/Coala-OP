
"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { convertValue } from '@/lib/conversion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Package } from 'lucide-react';
import { type BaseProduct } from '@/types';
import { cn } from '@/lib/utils';

interface AnalysisResult {
  baseProduct: BaseProduct;
  currentStock: number;
  minimumStock: number;
  restockNeeded: number;
  status: 'ok' | 'repor' | 'excesso' | 'sem_meta';
  stockPercentage: number | null;
  hasConversionError: boolean;
}

export function RestockAnalysis() {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, loading: productsLoading } = useProducts();
  const [selectedKioskId, setSelectedKioskId] = useState<string>('');

  const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading;
  
  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);

  const analysisResults = useMemo((): AnalysisResult[] => {
    if (!selectedKioskId || loading) return [];
    
    const productMap = new Map(products.map(p => [p.id, p]));
    const lotsInKiosk = lots.filter(lot => lot.kioskId === selectedKioskId);

    return baseProducts.map(baseProduct => {
      const minimumStock = baseProduct.stockLevels?.[selectedKioskId]?.min;
      
      let currentStock = 0;
      let hasConversionError = false;

      const lotsForBaseProduct = lotsInKiosk.filter(lot => {
        const product = productMap.get(lot.productId);
        return product?.baseProductId === baseProduct.id;
      });

      for (const lot of lotsForBaseProduct) {
        const product = productMap.get(lot.productId);
        if (!product) {
          hasConversionError = true;
          continue;
        }

        try {
            let valueInBaseUnit = 0;
            const quantityInPackages = lot.quantity;

            if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category === 'Embalagem' ? 'Unidade' : product.category;
                const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                valueInBaseUnit = quantityInPackages * valueOfOnePackageInBase;
            } 
            else if (product.category === baseProduct.category) {
                 const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 valueInBaseUnit = quantityInPackages * valueOfOnePackageInBase;
            } else {
                throw new Error(`Cannot convert from category ${product.category} to ${baseProduct.category} without a secondary unit.`);
            }

            currentStock += valueInBaseUnit;
        } catch (error) {
            console.error("Conversion failed for product:", product, error);
            hasConversionError = true;
        }
      }

      let status: AnalysisResult['status'] = 'ok';
      let restockNeeded = 0;
      let stockPercentage: number | null = null;

      if (minimumStock === undefined || minimumStock === null) {
        status = 'sem_meta';
      } else if (hasConversionError) {
        // Cannot determine status if there's a conversion error
      } else {
        restockNeeded = Math.max(0, minimumStock - currentStock);
        if (currentStock < minimumStock) {
          status = 'repor';
        }
        if (minimumStock > 0) {
            stockPercentage = Math.min(100, (currentStock / minimumStock) * 100);
        }
      }

      return {
        baseProduct,
        currentStock,
        minimumStock: minimumStock ?? 0,
        restockNeeded,
        status,
        stockPercentage,
        hasConversionError,
      };
    }).sort((a, b) => a.baseProduct.name.localeCompare(b.baseProduct.name));
  }, [selectedKioskId, baseProducts, products, lots, loading]);
  
  const getStatusBadge = (result: AnalysisResult) => {
    if (result.hasConversionError) {
      return <Badge variant="destructive">Erro de Conversão</Badge>;
    }
    switch (result.status) {
      case 'repor':
        return <Badge variant="destructive" className="bg-orange-500 text-white"><AlertTriangle className="mr-1 h-3 w-3" /> Repor</Badge>;
      case 'ok':
        return <Badge variant="secondary" className="bg-green-600 text-white"><CheckCircle className="mr-1 h-3 w-3" /> OK</Badge>;
      case 'sem_meta':
        return <Badge variant="outline">Sem Meta</Badge>;
      default:
        return <Badge variant="secondary">{result.status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Análise de Reposição</CardTitle>
        <CardDescription>
          Selecione um quiosque para ver a necessidade de reposição com base nas metas de estoque mínimo.
        </CardDescription>
        <div className="pt-2">
            <Select value={selectedKioskId} onValueChange={setSelectedKioskId} disabled={loading}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Selecione um quiosque..." />
              </SelectTrigger>
              <SelectContent>
                {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
              </SelectContent>
            </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : !selectedKioskId ? (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Package className="mx-auto h-12 w-12" />
            <p className="mt-4 font-semibold">Selecione um quiosque para iniciar a análise.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Produto Base</TableHead>
                  <TableHead className="text-center">Estoque Mínimo</TableHead>
                  <TableHead className="text-center">Estoque Atual</TableHead>
                  <TableHead className="w-[20%] text-center">Nível</TableHead>
                  <TableHead className="text-center">Reposição Sugerida</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysisResults.length > 0 ? analysisResults.map(result => (
                  <TableRow key={result.baseProduct.id}>
                    <TableCell className="font-medium">{result.baseProduct.name}</TableCell>
                    <TableCell className="text-center">{result.minimumStock} {result.baseProduct.unit}</TableCell>
                    <TableCell className="text-center font-semibold">{result.hasConversionError ? 'N/A' : `${result.currentStock.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${result.baseProduct.unit}`}</TableCell>
                    <TableCell className="text-center">
                        {result.stockPercentage !== null ? (
                             <Progress value={result.stockPercentage} className={cn(result.stockPercentage < 100 ? '[&>*]:bg-orange-500' : '[&>*]:bg-green-500')} />
                        ) : '-'}
                    </TableCell>
                    <TableCell className="text-center font-bold text-primary">{result.restockNeeded > 0 ? `${result.restockNeeded.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${result.baseProduct.unit}` : '-'}</TableCell>
                    <TableCell className="text-center">{getStatusBadge(result)}</TableCell>
                  </TableRow>
                )) : (
                    <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                            Nenhum produto base encontrado para análise.
                        </TableCell>
                    </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
