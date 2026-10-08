"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/use-validated-consumption-data';
import { convertValue, units, type UnitCategory } from '@/lib/conversion';
import { format, addDays, differenceInDays } from 'date-fns';
import { type BaseProduct } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CancelButton, LotModalShell, PrimaryButton, ShellEyebrow, ShellFacts } from './stock/lot-modal-shell';
import { useRouter } from 'next/navigation';
import { useReplenishmentPolicy } from '@/hooks/use-replenishment-policy';
import { availablePackages, operationalMinimum, shortage } from '@/lib/replenishment-display';

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
  const { enabled: policyEnabled, error: policyError } = useReplenishmentPolicy();
  const minimumState = operationalMinimum(baseProduct.stockLevels?.['matriz'], policyEnabled);

  const [coverageMonths, setCoverageMonths] = useState(baseProduct.consumptionMonths || 1);

   const formatNumber = (value: number) => {
    if (Number.isInteger(value)) {
      return value.toLocaleString('pt-BR');
    }
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  };

  const projection = useMemo(() => {
    const productMap = new Map(products.map(p => [p.id, p]));
    
    // Use only 'matriz' data for stock
    const matrizLots = lots.filter(lot => lot.kioskId === 'matriz');
    
    // Aggregate consumption from all kiosks EXCEPT matriz itself to represent network consumption
    const networkConsumptionReports = consumptionHistory.filter(r => r.kioskId !== 'matriz');

    const monthlyConsumption: Record<string, number> = {};
    networkConsumptionReports.forEach(report => {
        const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
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
            const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
            totalStock += quantityInPackages * valueOfOnePackageInBase;
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
    const physicalAvailable = matrizLots.reduce((sum, lot) => {
      const product = productMap.get(lot.productId);
      if (!product || product.baseProductId !== baseProduct.id) return sum;
      try { return sum + availablePackages(lot.quantity, lot.reservedQuantity) * convertValue(product.packageSize, product.unit, baseProduct.unit, product.category); }
      catch { return sum; }
    }, 0);

    let finalConsumptionDate = null;
    if (ruptureDate && dailyAvg > 0 && suggestedOrderQty > 0) {
        const daysOfNewStock = Math.floor(suggestedOrderQty / dailyAvg);
        finalConsumptionDate = addDays(ruptureDate, daysOfNewStock);
    }
    
    const representativeProduct = products.find(p => p.baseProductId === baseProduct.id);
    let logisticInfo = null;

    if (representativeProduct && representativeProduct.multiplo_caixa && representativeProduct.rotulo_caixa) {
        const unitsPerPackage = convertValue(representativeProduct.packageSize, representativeProduct.unit, baseProduct.unit, representativeProduct.category);
        if (unitsPerPackage > 0) {
            const packagesNeeded = suggestedOrderQty / unitsPerPackage;
            const boxesNeeded = packagesNeeded / representativeProduct.multiplo_caixa;
            logisticInfo = {
                quantity: boxesNeeded,
                label: representativeProduct.rotulo_caixa,
            };
        }
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
      physicalAvailable,
      finalConsumptionDate,
      logisticInfo,
    };
  }, [baseProduct, lots, products, consumptionHistory, coverageMonths]);

  const handleCopySummary = () => {
    const summary = `
Simulação de cobertura para ${baseProduct.name}:
- Status do Pedido: ${projection.orderStatus.toUpperCase()}
- Data Ideal do Pedido: ${projection.orderDate ? format(projection.orderDate, 'dd/MM/yyyy') : 'N/A'}
- Data de Ruptura: ${projection.ruptureDate ? format(projection.ruptureDate, 'dd/MM/yyyy') : 'N/A'}
- Quantidade simulada: ${formatNumber(projection.suggestedOrderQty)} ${baseProduct.unit} (para ${coverageMonths} meses)
- Falta física pela meta: ${policyEnabled === null || minimumState.minimum === null ? minimumState.label : `${formatNumber(shortage(minimumState.minimum, projection.physicalAvailable) ?? 0)} ${baseProduct.unit}`}
    `;
    navigator.clipboard.writeText(summary.trim());
    toast({ title: 'Resumo copiado!' });
  };
  
  const handleViewFullProjection = () => {
      onOpenChange(false);
      router.push(`/dashboard/stock/analysis/projection?baseProductId=${baseProduct.id}`);
  }

  const STATUS_PILLS = {
    ok: { label: 'OK', className: 'bg-[#e8f5ee] text-[#15803d]' },
    soon: { label: 'Pedir em breve', className: 'bg-[#fff1e6] text-[#c2410c]' },
    urgent: { label: 'Urgente', className: 'bg-[#ffe4e8] text-[#be123c]' },
    sem_lead_time: { label: 'Sem lead time', className: 'bg-[#eceae5] text-[#70757d]' },
  } as const;
  const statusPill = STATUS_PILLS[projection.orderStatus];
  const fmtDate = (date: Date | null) => (date ? format(date, 'dd/MM/yyyy') : 'N/A');
  const COVERAGE_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3];
  const monthsLabel = `${coverageMonths.toLocaleString('pt-BR')} ${coverageMonths === 1 ? 'mês' : 'meses'}`;

  // Linha do tempo: estoque atual até a ruptura, depois o pedido sugerido.
  const coverageDays = isFinite(projection.daysOfCoverage) ? projection.daysOfCoverage : null;
  const newStockDays = projection.finalConsumptionDate && projection.ruptureDate ? differenceInDays(projection.finalConsumptionDate, projection.ruptureDate) : 0;
  const horizon = coverageDays !== null ? Math.max(coverageDays + newStockDays, 1) : 0;
  const pct = (days: number) => `${Math.min(100, Math.max(0, (days / horizon) * 100))}%`;
  const orderDays = projection.orderDate ? Math.max(0, differenceInDays(projection.orderDate, new Date())) : null;

  const shortageLine = minimumState.minimum === null
    ? minimumState.label
    : `${formatNumber(shortage(minimumState.minimum, projection.physicalAvailable) ?? 0)} ${baseProduct.unit}`;

  return (
    <LotModalShell
      open
      onOpenChange={onOpenChange}
      title={`Projeção rápida: ${baseProduct.name}`}
      description="Simulação de cobertura baseada na média histórica da rede."
      width={900}
      sidebarWidth={280}
      sidebar={
        <>
          <ShellEyebrow>Projeção rápida · Matriz</ShellEyebrow>
          <h2 className="m-0 text-2xl font-extrabold tracking-[-.03em]">{baseProduct.name}</h2>
          <span className="text-[12.5px] leading-normal text-[#a3a2ad]">
            Estoque do Centro de Distribuição contra a média de consumo da rede. A meta operacional aparece separadamente.
          </span>
          <ShellFacts
            rows={[
              { label: 'Estoque atual', value: `${formatNumber(projection.totalStock)} ${baseProduct.unit}` },
              { label: 'Média diária', value: `${formatNumber(projection.dailyAvg)} ${baseProduct.unit}` },
              { label: 'Cobertura', value: coverageDays !== null ? `${coverageDays} dias` : 'N/A' },
              { label: 'Lead time', value: `${projection.leadTime || 0} dias` },
              { label: 'Meta operacional', value: minimumState.minimum === null ? minimumState.label : `${formatNumber(minimumState.minimum)} ${baseProduct.unit}` },
            ]}
          />
          {minimumState.minimum !== null && (
            <span className="text-[12.5px] text-[#a3a2ad]">Falta física pela meta: <b className="text-[#f3f2ee]">{shortageLine}</b></span>
          )}
          {policyEnabled === null && policyError && (
            <span role="alert" className="rounded-xl border border-[#f5d9a3]/40 bg-[#f5d9a3]/10 px-3 py-2 text-xs text-[#f5d9a3]">Política indisponível.</span>
          )}
        </>
      }
      footer={
        <>
          <button type="button" onClick={handleCopySummary} className="h-11 whitespace-nowrap rounded-xl border border-[#dcd9d1] bg-white px-4 text-[13.5px] font-bold hover:bg-[#f6f4ef]">
            Copiar resumo
          </button>
          <div className="flex gap-2.5">
            <CancelButton onClick={() => onOpenChange(false)}>Fechar</CancelButton>
            <PrimaryButton type="button" onClick={handleViewFullProjection}>Ver projeção completa →</PrimaryButton>
          </div>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#e3dfd6] bg-white p-[18px]">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.12em] text-[#9a9ba1]">Quando pedir</span>
            <span className={cn('inline-flex h-[21px] items-center whitespace-nowrap rounded-full px-[9px] text-[11.5px] font-bold', statusPill.className)}>{statusPill.label}</span>
          </span>
          <span className="text-[30px] font-extrabold tracking-[-.03em]">{fmtDate(projection.orderDate)}</span>
          <span className="text-[12.5px] text-[#70757d]">Ruptura em <b className="text-[#1a1b1f]">{fmtDate(projection.ruptureDate)}</b> · lead time de {projection.leadTime || 0} dias</span>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#e3dfd6] bg-white p-[18px]">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.12em] text-[#9a9ba1]">Quanto pedir</span>
          <span className="text-[30px] font-extrabold tracking-[-.03em]">{formatNumber(projection.suggestedOrderQty)} {baseProduct.unit}</span>
          <span className="text-[12.5px] text-[#70757d]">
            {projection.logisticInfo ? <>≈ {formatNumber(projection.logisticInfo.quantity)} {projection.logisticInfo.label}(s) · </> : null}
            dura até <b className="text-[#1a1b1f]">{fmtDate(projection.finalConsumptionDate)}</b>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="flex justify-between text-xs font-bold text-[#4a4f57]">Cobertura do pedido <b className="text-[13px] text-[#1a1b1f]">{monthsLabel}</b></span>
        <div className="flex flex-wrap gap-1.5">
          {COVERAGE_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => setCoverageMonths(option)}
              className={cn(
                'h-10 whitespace-nowrap rounded-full px-4 text-[13px] font-bold',
                coverageMonths === option ? 'border-2 border-[#5b5bd6] bg-[#eeeefc] text-[#3f3fb0]' : 'border border-[#dcd9d1] bg-white text-[#4a4f57] hover:bg-[#f6f4ef]',
              )}
            >
              {option.toLocaleString('pt-BR')} {option === 1 ? 'mês' : 'meses'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.12em] text-[#9a9ba1]">Linha do tempo</span>
        {coverageDays === null ? (
          <span className="rounded-xl border border-dashed border-[#d6d2c8] px-3.5 py-3 text-[12.5px] text-[#70757d]">Sem consumo registrado: não há como projetar a ruptura.</span>
        ) : (
          <div className="relative mt-2.5 h-11">
            <div className="absolute inset-x-0 top-3 h-2 rounded-[9px] bg-[#ebe7df]" />
            <div className="absolute left-0 top-3 h-2 rounded-[9px] bg-[#15151c]" style={{ width: pct(coverageDays) }} />
            {newStockDays > 0 && (
              <div className="absolute top-3 h-2 rounded-[9px] bg-[#5b5bd6]" style={{ left: pct(coverageDays), width: pct(newStockDays) }} />
            )}
            {orderDays !== null && <div className="absolute top-2 h-4 w-[3px] -translate-x-1/2 rounded bg-[#e0457f]" style={{ left: pct(orderDays) }} />}
            <span className="absolute left-0 top-[26px] text-[11px] text-[#70757d]">Hoje</span>
            {orderDays !== null && <span className="absolute top-[26px] -translate-x-1/2 text-[11px] font-bold text-[#e0457f]" style={{ left: pct(orderDays) }}>Pedir</span>}
            <span className="absolute top-[26px] -translate-x-1/2 text-[11px] text-[#70757d]" style={{ left: pct(coverageDays) }}>Ruptura</span>
          </div>
        )}
        <div className="flex gap-4 text-[11.5px] text-[#70757d]">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#15151c]" />Estoque atual</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#5b5bd6]" />Pedido sugerido</span>
        </div>
      </div>
    </LotModalShell>
  );
}
