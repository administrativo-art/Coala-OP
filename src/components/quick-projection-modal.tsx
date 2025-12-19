
"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products.tsx';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { format, addDays, differenceInDays, parseISO, getDaysInMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type BaseProduct } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, BellRing, CalendarDays, ShoppingCart, Info, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Label } from './ui/label';

interface QuickProjectionModalProps {
  baseProduct: BaseProduct;
  onOpenChange: (open: boolean) => void;
}

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function QuickProjectionModal({ baseProduct, onOpenChange }: QuickProjectionModalProps) {
  const { lots } = useExpiryProducts();
  const { products } = useProducts();
  const { reports: consumptionHistory } = useValidatedConsumptionData();
  const { toast } = useToast();
  const router = useRouter();

  const [coverageMonths, setCoverageMonths] = useState(baseProduct.consumptionMonths || 1);

  const projection = useMemo(() => {
    const productMap = new Map(products.map(p => [p.id, p]));
    
    // Use only 'matriz' data for stock
    const matrizLots = lots.filter(lot => lot.kioskId === 'matriz');
    
    // Aggregate consumption from all kiosks EXCEPT matriz itself to represent network consumption
    const networkConsumptionReports = consumptionHistory.filter(r => r.kioskId !== 'matriz');

    const monthlyConsumption: Record<string, number> = {};
    networkConsumptionReports.forEach(report => {
        const key = `${'report.year'}-${String(report.month).padStart(2, '0')}`;
        const totalForMonth = report.results
            .filter(res => res.baseProductId === baseProduct.id)
            .reduce((sum, res) => sum + res.consumedQuantity, 0);
        
        if (totalForMonth > 0) {
            monthlyConsumption[key] = (monthlyConsumption[key] || 0) + totalForMonth;
        }
    });

    const months = Object.values(monthlyConsumption);
    const monthlyAvg = months.length > 0 ? months.reduce((sum, val) => sum + val, 0) / months.length : 0;
    const dailyAvg = monthlyAvg / 30;

    let totalStock = 0;
    let hasConversionError = false;
    matrizLots.filter(lot => productMap.get(lot.productId)?.baseProductId === baseProduct.id)
      .forEach(lot => {
        const product = productMap.get(lot.productId);
        if (!product) return;
        try {
            const quantityInPackages = lot.quantity || 0;
            if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category === 'Embalagem' ? 'Unidade' : product.category;
                const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                totalStock += quantityInPackages * valueOfOnePackageInBase;
            } 
            else if (product.category === baseProduct.category) {
                 const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 totalStock += quantityInPackages * valueOfOnePackageInBase;
            }
        } catch {
            hasConversionError = true;
        }
    });
    
    const matrizStockLevels = baseProduct.stockLevels?.['matriz'];
    const safetyStock = matrizStockLevels?.safetyStock || 0;
    const effectiveStock = Math.max(0, totalStock - safetyStock);
    
    const daysOfCoverage = dailyAvg > 0 ? Math.floor(effectiveStock / dailyAvg) : Infinity;
    const ruptureDate = daysOfCoverage !== Infinity ? addDays(new Date(), daysOfCoverage) : null;
    
    let orderDate = null;
    let orderStatus: 'ok' | 'soon' | 'urgent' | 'sem_lead_time' = 'sem_lead_time';

    const leadTime = matrizStockLevels?.leadTime;

    if (ruptureDate && leadTime && leadTime > 0) {
        orderDate = addDays(ruptureDate, -leadTime);
        const daysToOrder = differenceInDays(orderDate, new Date());
        if (daysToOrder <= 0) orderStatus = 'urgent';
        else if (daysToOrder <= 7) orderStatus = 'soon';
        else orderStatus = 'ok';
    }

    const suggestedOrderQty = monthlyAvg * coverageMonths;

    let finalConsumptionDate = null;
    if (ruptureDate && dailyAvg > 0 && suggestedOrderQty > 0) {
        const daysOfNewStock = Math.floor(suggestedOrderQty / dailyAvg);
        finalConsumptionDate = addDays(ruptureDate, daysOfNewStock);
    }

    return {
      dailyAvg,
      monthlyAvg,
      totalStock,
      totalSafetyStock: safetyStock,
      effectiveStock,
      daysOfCoverage,
      ruptureDate,
      orderDate,
      orderStatus,
      leadTime,
      suggestedOrderQty,
      finalConsumptionDate,
    };
  }, [baseProduct, lots, products, consumptionHistory, coverageMonths]);

  const handleCopySummary = () => {
    const summary = `
Projeção para ${baseProduct.name}:
- Status do Pedido: ${projection.orderStatus.toUpperCase()}
- Data Ideal do Pedido: ${projection.orderDate ? format(projection.orderDate, 'dd/MM/yyyy') : 'N/A'}
- Data de Ruptura: ${projection.ruptureDate ? format(projection.ruptureDate, 'dd/MM/yyyy') : 'N/A'}
- Sugestão de Compra: ${projection.suggestedOrderQty.toFixed(0)} ${baseProduct.unit} (para ${coverageMonths} meses)
    `;
    navigator.clipboard.writeText(summary.trim());
    toast({ title: 'Resumo copiado!' });
  };
  
  const getOrderStatusBadge = () => {
    switch (projection.orderStatus) {
        case 'ok': return <Badge variant="secondary" className="bg-green-600 text-white">OK</Badge>;
        case 'soon': return <Badge variant="destructive" className="bg-yellow-500 text-white">Pedir em breve</Badge>;
        case 'urgent': return <Badge variant="destructive">Urgente</Badge>;
        case 'sem_lead_time': return <Badge variant="outline">Sem Lead Time</Badge>;
    }
  };

  const handleViewFullProjection = () => {
      onOpenChange(false);
      router.push(`/dashboard/stock/analysis/projection?baseProductId=${baseProduct.id}`);
  }

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projeção Rápida: {baseProduct.name}</DialogTitle>
          <DialogDescription>
            Análise de compra baseada na média de consumo da Matriz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
            <Card className="bg-muted/50">
                <CardContent className="p-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2"><Info className="h-4 w-4 text-primary"/><span>Estoque atual: <strong>{projection.totalStock.toFixed(1)} {baseProduct.unit}</strong></span></div>
                    <div className="flex items-center gap-2"><Info className="h-4 w-4 text-primary"/><span>Média diária: <strong>{projection.dailyAvg.toFixed(1)} {baseProduct.unit}</strong></span></div>
                    <div className="flex items-center gap-2"><Info className="h-4 w-4 text-primary"/><span>Cobertura: <strong>{isFinite(projection.daysOfCoverage) ? `${projection.daysOfCoverage} dias` : 'N/A'}</strong></span></div>
                    <div className="flex items-center gap-2"><Info className="h-4 w-4 text-primary"/><span>Lead Time: <strong>{projection.leadTime || 0} dias</strong></span></div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4">
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-base flex items-center justify-between">Quando Pedir? {getOrderStatusBadge()}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                        <div className="flex items-center gap-2"><BellRing className="h-5 w-5 text-destructive" /><span className="font-semibold">Pedir até: {projection.orderDate ? format(projection.orderDate, 'dd/MM/yyyy') : 'N/A'}</span></div>
                        <div className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span>Ruptura em: {projection.ruptureDate ? format(projection.ruptureDate, 'dd/MM/yyyy') : 'N/A'}</span></div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-base flex items-center justify-between">Quanto Pedir?</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-2">
                        <div className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-primary" /><span className="font-semibold text-xl">{projection.suggestedOrderQty.toFixed(0)} {baseProduct.unit}</span></div>
                        <div className="text-sm">Para cobrir {coverageMonths} mês(es) de consumo.</div>
                        {projection.finalConsumptionDate && (
                            <div className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span>Consumo até: {format(projection.finalConsumptionDate, 'dd/MM/yyyy')}</span></div>
                        )}
                    </CardContent>
                </Card>
            </div>
            
            <div>
              <Label>Ajustar cobertura do pedido</Label>
              <div className="flex items-center gap-4 mt-2">
                <Slider defaultValue={[coverageMonths]} min={0.5} max={3} step={0.5} onValueChange={(value) => setCoverageMonths(value[0])} />
                <span className="font-bold w-20 text-center">{coverageMonths} mês(es)</span>
              </div>
            </div>
        </div>

        <DialogFooter className="justify-between pt-4 border-t">
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={handleCopySummary}><Copy className="h-4 w-4"/></Button>
          </div>
          <div className="flex gap-2">
             <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
             <Button onClick={handleViewFullProjection}>Ver Projeção Completa</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
