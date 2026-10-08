
"use client"

import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { type Kiosk, type BaseProduct, type MovementRecord } from "@/types";
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CancelButton, LotModalShell, ShellEyebrow } from './stock/lot-modal-shell';
import { useKiosks } from '@/hooks/use-kiosks';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { useProducts } from '@/hooks/use-products';
import { format, startOfMonth, endOfMonth, parseISO, isWithinInterval, getMonth, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface FinancialPeriodAnalysisModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface AnalysisResult {
    baseProductId: string;
    baseProductName: string;
    unit: string;
    consumoTeorico: number;
}

const formatNumber = (value: number) => {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FinancialPeriodAnalysisModal({ open, onOpenChange }: FinancialPeriodAnalysisModalProps) {
    const { user } = useAuth();
    const { kiosks } = useKiosks();
    const { baseProducts } = useBaseProducts();
    const { products } = useProducts();
    const { history: movementHistory, loading: historyLoading, loaded: historyLoaded, loadHistory } = useMovementHistory();

    useEffect(() => {
      if (open && !historyLoaded) loadHistory();
    }, [open, historyLoaded, loadHistory]);

    const [kioskId, setKioskId] = useState<string>('');
    const [period, setPeriod] = useState({ month: '', year: '' });
    const [analysisResult, setAnalysisResult] = useState<AnalysisResult[] | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    
    const sortedKiosks = useMemo(() => {
        return [...kiosks].sort((a,b) => {
            if (a.id === 'matriz') return -1;
            if (b.id === 'matriz') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [kiosks]);

    const availableYears = useMemo(() => {
        if (!movementHistory || movementHistory.length === 0) return [];
        const years = new Set(movementHistory.map(h => {
            if (!h.timestamp || !isValid(parseISO(h.timestamp))) return null;
            return format(parseISO(h.timestamp), 'yyyy');
        }).filter(Boolean));
        return Array.from(years as Set<string>).sort((a, b) => b.localeCompare(a));
    }, [movementHistory]);

    const availableMonths = useMemo(() => {
        if (!period.year || !movementHistory || movementHistory.length === 0) return [];
        
        const today = new Date();
        const currentYear = today.getFullYear().toString();
        const currentMonth = today.getMonth(); // 0 a 11

        const months = new Set(movementHistory
            .filter(h => {
                if (!h.timestamp || !isValid(parseISO(h.timestamp))) return false;
                const date = parseISO(h.timestamp);
                
                // Se o ano analisado for o ano atual, permitimos meses até o mês de hoje
                if (format(date, 'yyyy') === period.year) {
                    if (period.year === currentYear) {
                        return getMonth(date) <= currentMonth;
                    }
                    return true;
                }
                return false;
            })
            .map(h => getMonth(parseISO(h.timestamp)))
        );
        
        return Array.from(months)
            .sort((a, b) => a - b)
            .map(m => ({ value: (m + 1).toString(), label: format(new Date(parseInt(period.year), m), 'MMMM', { locale: ptBR }) }));
    }, [period.year, movementHistory]);


    const handleAnalyze = async () => {
        if (!kioskId || !period.month || !period.year) return;
        setIsLoading(true);
        setAnalysisResult(null);

        await new Promise(resolve => setTimeout(resolve, 50)); 

        const startDate = startOfMonth(new Date(parseInt(period.year), parseInt(period.month) - 1));
        const endDate = endOfMonth(startDate);
        
        const results: AnalysisResult[] = [];
        
        for (const bp of baseProducts) {
            const productIdsForBase = products
                .filter(p => p.baseProductId === bp.id)
                .map(p => p.id);

            const movementsInPeriodForProduct = movementHistory.filter(h => {
                if (!h.timestamp || !productIdsForBase.includes(h.productId)) return false;

                const movementDate = parseISO(h.timestamp);
                return isValid(movementDate) && isWithinInterval(movementDate, { start: startDate, end: endDate }) &&
                       (h.fromKioskId === kioskId || h.toKioskId === kioskId);
            });

            // For now, EI and EF are simplified. A full historical calculation is needed for accuracy.
            const EI = 0; // Simplified
            const EF = 0; // Simplified

            const EC = movementsInPeriodForProduct.filter(h => h.type === 'ENTRADA' && h.toKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const TI = movementsInPeriodForProduct.filter(h => h.type === 'TRANSFERENCIA_ENTRADA' && h.toKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const TO = movementsInPeriodForProduct.filter(h => h.type === 'TRANSFERENCIA_SAIDA' && h.fromKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const AJ_plus = movementsInPeriodForProduct.filter(h => h.type === 'ENTRADA_CORRECAO' && h.toKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            const AJ_minus = movementsInPeriodForProduct.filter(h => (h.type === 'SAIDA_CORRECAO' || h.type?.startsWith('SAIDA_DESCARTE')) && h.fromKioskId === kioskId).reduce((sum, h) => sum + h.quantityChange, 0);
            
            const consumoTeorico = (EI + EC + TI + AJ_plus) - (TO + EF + AJ_minus);
            
            if (consumoTeorico !== 0) {
                 results.push({
                    baseProductId: bp.id,
                    baseProductName: bp.name,
                    unit: bp.unit,
                    consumoTeorico,
                });
            }
        }
        setAnalysisResult(results.sort((a, b) => a.baseProductName.localeCompare(b.baseProductName)));
        setIsLoading(false);
    };

    // Gera a análise assim que quiosque, ano e mês estão escolhidos.
    useEffect(() => {
        if (open && kioskId && period.year && period.month && historyLoaded) void handleAnalyze();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, kioskId, period.year, period.month, historyLoaded]);

    useEffect(() => {
        if (!open) {
            setKioskId('');
            setPeriod({ month: '', year: '' });
            setAnalysisResult(null);
        }
    }, [open]);

    const kioskButton = (on: boolean) => cn(
        'flex h-[38px] items-center rounded-xl border px-3.5 text-left text-[13px] font-bold',
        on ? 'border-[#f08bb1] bg-[#f08bb1]/15 text-white' : 'border-white/10 bg-transparent text-[#c8c7d0] hover:bg-white/5',
    );
    const pill = (on: boolean) => cn(
        'h-8 rounded-[9px] px-3 text-[12.5px] font-bold capitalize',
        on ? 'bg-white text-[#1a1b1f] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d] hover:bg-[#f0eee9]',
    );
    const kioskName = kiosks.find(k => k.id === kioskId)?.name;
    const monthName = availableMonths.find(m => m.value === period.month)?.label;
    const title = kioskName && monthName ? `${kioskName} · ${monthName} de ${period.year}` : 'Escolha o quiosque e o mês';

    return (
        <LotModalShell
            open={open}
            onOpenChange={onOpenChange}
            title="Análise de consumo por período"
            description="Calcule o consumo teórico dos insumos para o período selecionado."
            width={920}
            height={660}
            sidebarWidth={260}
            sidebar={
                <>
                    <ShellEyebrow>Consumo por período</ShellEyebrow>
                    <h2 className="m-0 text-[22px] font-extrabold leading-[1.2] tracking-[-.02em]">Consumo teórico por insumo</h2>
                    <div className="flex flex-col gap-2">
                        <ShellEyebrow>Quiosque</ShellEyebrow>
                        {sortedKiosks.map(k => (
                            <button key={k.id} type="button" onClick={() => setKioskId(k.id)} className={kioskButton(kioskId === k.id)}>{k.name}</button>
                        ))}
                    </div>
                    <div className="mt-auto rounded-[14px] border border-white/10 bg-white/5 p-3.5 text-[11.5px] leading-[1.6] text-[#a3a2ad]">
                        <b className="text-xs text-[#f3f2ee]">Como é calculado</b>
                        <br />
                        (Estoque inicial + Compras + Transferências recebidas + Ajustes de entrada) − (Transferências enviadas + Estoque final + Ajustes de saída)
                    </div>
                </>
            }
            footer={
                <>
                    <CancelButton onClick={() => onOpenChange(false)}>Fechar</CancelButton>
                    <span />
                </>
            }
        >
            <div className="flex items-start justify-between gap-4 border-b border-[#e6e2da] pb-4">
                <div className="flex flex-col gap-1">
                    <h3 className="m-0 text-[21px] font-extrabold tracking-[-.02em]">{title}</h3>
                    <span className="text-[13px] text-[#70757d]">Escolha o quiosque e o mês para gerar a análise.</span>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex gap-0.5 rounded-[11px] bg-[#e6e3dc] p-[3px]">
                    {availableYears.map(y => (
                        <button key={y} type="button" onClick={() => setPeriod({ year: y, month: '' })} className={pill(period.year === y)}>{y}</button>
                    ))}
                    {availableYears.length === 0 && <span className="px-3 py-1.5 text-[12.5px] text-[#70757d]">{historyLoading ? 'Carregando…' : 'Sem histórico'}</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                    {availableMonths.map(m => (
                        <button
                            key={m.value}
                            type="button"
                            onClick={() => setPeriod(p => ({ ...p, month: m.value }))}
                            className={cn('h-8 rounded-[9px] border px-3 text-[12.5px] font-bold capitalize', period.month === m.value ? 'border-[#5b5bd6] bg-[#eeeefc] text-[#3f3fb0]' : 'border-[#dcd9d1] bg-white text-[#4a4f57] hover:bg-[#f6f4ef]')}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>
            {isLoading ? (
                <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#9a9ba1]" /></div>
            ) : analysisResult === null ? (
                <div className="flex flex-col gap-1 rounded-2xl border border-dashed border-[#d6d2c8] px-5 py-12 text-center">
                    <b className="text-sm">Aguardando seleção</b>
                    <span className="text-[12.5px] text-[#70757d]">Selecione o quiosque e o período para gerar a análise.</span>
                </div>
            ) : analysisResult.length === 0 ? (
                <div className="rounded-[14px] border border-[#f5d9a3] bg-[#fff7e6] px-4 py-3.5 text-[12.5px] text-[#6b4500]">
                    <b>Nenhum dado encontrado.</b> Não há movimentações para o período e quiosque selecionados.
                </div>
            ) : (
                <div className="overflow-hidden rounded-2xl border border-[#e3dfd6] bg-white">
                    <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3 bg-[#f6f4ef] px-4 py-[11px] text-[10.5px] font-extrabold uppercase tracking-[.1em] text-[#9a9ba1]">
                        <span>Insumo</span><span className="text-right">Consumo teórico</span>
                    </div>
                    {analysisResult.map(res => (
                        <div key={res.baseProductId} className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-3 border-t border-[#f1eee8] px-4 py-3">
                            <b className="text-[13.5px]">{res.baseProductName}</b>
                            <span className="text-right text-sm font-extrabold tabular-nums">{formatNumber(res.consumoTeorico)} {res.unit}</span>
                        </div>
                    ))}
                </div>
            )}
        </LotModalShell>
    );
}
