"use client";

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Edit, X } from 'lucide-react';

import { type BaseProduct, type Product } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useProducts } from '@/hooks/use-products';
import { useClassifications } from '@/hooks/use-classifications';
import { useKiosks } from '@/hooks/use-kiosks';
import { useReplenishmentPolicy } from '@/hooks/use-replenishment-policy';
import { useDP } from '@/components/dp-context';
import { operationalMinimum } from '@/lib/replenishment-display';
import { unitFullName, unitSymbol } from '@/lib/base-product-unit-display';

const formatCurrency = (value?: number) => {
  if (!value || isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 3 });
};

type FichaTab = 'dados' | 'nutri';
type ProductFilter = 'all' | 'with' | 'without';

const TABS: ReadonlyArray<{ id: FichaTab; label: string }> = [
  { id: 'dados', label: 'Dados gerais' },
  { id: 'nutri', label: 'Insumos e nutrição' },
];
const FILTERS: ReadonlyArray<{ id: ProductFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'with', label: 'Com dados' },
  { id: 'without', label: 'Sem dados' },
];

interface BaseProductFichaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseProduct: BaseProduct | null;
  onEdit: (baseProduct: BaseProduct) => void;
}

const hasTranscribedData = (p: Product) => Boolean(p.nutritionalData || p.compositionText || p.detectedAllergens?.length);
const hasPhotos = (p: Product) => Boolean(p.nutritionalTableImageUrl || p.compositionImageUrl);
const hasContent = (p: Product) => hasTranscribedData(p) || hasPhotos(p);

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">{children}</span>;
}

function PhotoSlot({ url, label, height, onZoom }: { url?: string; label: string; height: number; onZoom: (url: string) => void }) {
  if (!url) {
    return (
      <div style={{ height }} className="flex items-end justify-center rounded-xl border border-dashed border-[#d6d2c8] bg-[repeating-linear-gradient(135deg,#f4f3ef_0_8px,#efede7_8px_16px)] pb-1.5 text-[10.5px] font-bold text-[#70757d]">
        Sem foto · {label}
      </div>
    );
  }
  return (
    <button type="button" onClick={() => onZoom(url)} aria-label={`Ampliar foto — ${label}`} style={{ height }} className="relative cursor-zoom-in overflow-hidden rounded-xl border border-[#d6d2c8]">
      <Image src={url} alt={label} fill sizes="150px" className="object-cover" />
      <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">{label}</span>
    </button>
  );
}

function ProductPanel({ product, onZoom }: { product: Product; onZoom: (url: string) => void }) {
  if (!hasContent(product)) {
    return (
      <div className="rounded-xl border border-dashed border-[#d6d2c8] p-3.5 text-center text-[12.5px] leading-normal text-[#70757d]">
        Sem fotos nem dados transcritos.<br />Adicione fotos da embalagem no cadastro do insumo.
      </div>
    );
  }
  const nutrition = product.nutritionalData;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <PhotoSlot url={product.nutritionalTableImageUrl} label="Nutricional" height={96} onZoom={onZoom} />
        <PhotoSlot url={product.compositionImageUrl} label="Composição" height={72} onZoom={onZoom} />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        {nutrition && (
          <div className="overflow-hidden rounded-xl border border-[#e6e2da]">
            <div className="flex items-baseline justify-between gap-2.5 bg-[#15151c] px-3 py-2 text-[#f3f2ee]">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[.14em]">Informação nutricional</span>
              <span className="text-[11px] text-[#a3a2ad]">Porção: {nutrition.portionSize}{nutrition.portionDescription ? ` (${nutrition.portionDescription})` : ''}</span>
            </div>
            {nutrition.nutrients.map((n, i) => (
              <div key={i} className="flex justify-between gap-2.5 border-t border-[#f0ede7] px-3 py-1.5 text-[12.5px]">
                <span className="text-[#4a4f57]">{n.name}</span>
                <span className="flex gap-2.5">
                  <b className="tabular-nums">{n.amount}{n.unit}</b>
                  <span className="min-w-[34px] text-right text-[#8a8f99]">{n.dailyValue}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {product.compositionText && (
          <div className="flex flex-col gap-1">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-[#8a8f99]">Composição</span>
            <span className="text-[12.5px] leading-normal text-[#4a4f57]">{product.compositionText}</span>
          </div>
        )}
        {product.detectedAllergens && product.detectedAllergens.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-[#c2410c]">Alérgenos</span>
            {product.detectedAllergens.map((a) => (
              <span key={a} className="rounded-full border border-[#fed7aa] bg-[#ffedd5] px-[9px] py-0.5 text-[11px] font-bold text-[#c2410c]">{a}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BaseProductFichaModal({ open, onOpenChange, baseProduct, onEdit }: BaseProductFichaModalProps) {
  const { products } = useProducts();
  const { classifications } = useClassifications();
  const { kiosks } = useKiosks();
  const { enabled: policyEnabled } = useReplenishmentPolicy();
  const { units: operationalUnits } = useDP();

  const [tab, setTab] = useState<FichaTab>('dados');
  const [showHow, setShowHow] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const baseProductId = baseProduct?.id;
  useEffect(() => {
    if (open) { setTab('dados'); setShowHow(false); setQuery(''); setFilter('all'); setOpenIds({}); setZoomedImage(null); }
  }, [open, baseProductId]);

  const linkedProducts = useMemo(() => {
    if (!baseProduct) return [];
    return products.filter(p => p.baseProductId === baseProduct.id && !p.isArchived);
  }, [products, baseProduct]);

  const classificationName = useMemo(() => {
    if (!baseProduct?.classification) return null;
    return classifications.find(c => c.id === baseProduct.classification)?.name ?? null;
  }, [baseProduct, classifications]);

  const kiosksWithStockParams = useMemo(() => {
    if (!baseProduct) return [];
    return kiosks
      .filter(k => Boolean(baseProduct.stockLevels?.[k.id]))
      .map(k => ({ kiosk: k, level: baseProduct.stockLevels[k.id] }));
  }, [baseProduct, kiosks]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return linkedProducts
      .filter(p => [p.baseName, p.brand, p.packageType, p.packageSize].filter(Boolean).join(' ').toLowerCase().includes(q))
      .filter(p => filter === 'all' || (filter === 'with' ? hasContent(p) : !hasContent(p)));
  }, [linkedProducts, query, filter]);

  if (!baseProduct) return null;

  const effectivePrice = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit;
  const legacy = policyEnabled === false;
  const withContent = linkedProducts.filter(hasContent).length;
  const linkedLabel = `${linkedProducts.length} insumo${linkedProducts.length === 1 ? '' : 's'} vinculado${linkedProducts.length === 1 ? '' : 's'}`;
  const cycleLabel = legacy ? 'Sugerir pedido (meses)' : 'Ciclo de cobertura';
  const cycleValue = legacy
    ? String(baseProduct.consumptionMonths ?? '—')
    : policyEnabled ? (baseProduct.minStockRecalcPeriod === 'biweekly' ? 'Quinzenal · 15 dias' : 'Mensal · 30 dias') : 'Política não verificada';
  const policyLine = policyEnabled === true
    ? 'Ativa. Mínimo automático com margem de 30%.'
    : legacy ? 'Regra legada. A política nova permanece em comparação até sua ativação.' : 'Indisponível. Os mínimos não puderam ser verificados.';
  const gridTemplateColumns = legacy ? 'minmax(0,1.1fr) minmax(0,1.6fr) 120px 90px' : 'minmax(0,1.1fr) minmax(0,1.8fr) 90px';
  const firstProductId = visibleProducts[0]?.id;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent hideClose className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] gap-0 overflow-y-auto overflow-x-hidden rounded-[26px] border-0 bg-[#faf9f6] p-0 sm:w-[calc(100vw-2rem)] sm:max-w-[1080px] sm:rounded-[26px] sm:p-0">
          <DialogTitle className="sr-only">Ficha cadastral de {baseProduct.name}</DialogTitle>
          <DialogDescription className="sr-only">Informações completas do insumo base.</DialogDescription>
          <div className="grid min-h-0 grid-cols-1 lg:h-[780px] lg:grid-cols-[380px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col gap-[26px] overflow-hidden bg-[#15151c] px-6 py-7 text-[#f3f2ee] sm:px-[30px] sm:py-8">
              <div className="flex flex-col gap-3">
                <Eyebrow>Ficha cadastral · insumo base</Eyebrow>
                <h2 className="break-words text-[40px] font-extrabold leading-none tracking-[-.035em]">{baseProduct.name}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {classificationName && <span className="whitespace-nowrap rounded-full bg-[rgba(185,185,255,.14)] px-2.5 py-[3px] text-[11.5px] font-bold text-[#d4d4ff]">{classificationName}</span>}
                  <span className="whitespace-nowrap rounded-full border border-white/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#c8c7d0]">{linkedLabel}</span>
                </div>
              </div>

              <div className="flex items-center gap-[18px]">
                <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-3xl border border-[rgba(185,185,255,.28)] bg-[rgba(185,185,255,.12)]">
                  <span className="text-[56px] font-extrabold leading-none tracking-[-.05em] text-[#b9b9ff]">{unitSymbol(baseProduct.unit)}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="break-words text-[22px] font-extrabold tracking-[-.02em] text-white">{unitFullName(baseProduct.unit)}</span>
                  <span className="text-xs text-[#8e8d99]">no sistema: <b className="font-bold text-[#c8c7d0]">{baseProduct.unit} · categoria {baseProduct.category}</b></span>
                </div>
              </div>

              <div className="flex flex-col rounded-[14px] border border-white/10 bg-white/5">
                <div className="flex flex-col gap-1 border-b border-white/5 px-4 py-3.5">
                  <Eyebrow>Custo por {baseProduct.unit}</Eyebrow>
                  <span className="whitespace-nowrap font-mono text-[30px] font-bold tracking-[-.03em]">{formatCurrency(effectivePrice)}</span>
                </div>
                <div className="flex flex-col gap-1 px-4 py-3.5">
                  <Eyebrow>{cycleLabel}</Eyebrow>
                  <span className="text-base font-bold">{cycleValue}</span>
                </div>
              </div>

              <div className="mt-auto flex flex-col gap-1.5 border-t border-white/10 pt-5">
                <Eyebrow>Política de reposição</Eyebrow>
                <span className="text-[12.5px] leading-normal text-[#c8c7d0]">{policyLine}</span>
              </div>
            </aside>

            <div className="flex min-h-0 flex-col">
              <header className="flex flex-col gap-4 border-b border-[#e6e2da] px-5 pb-3.5 pt-6 sm:px-[30px]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div role="tablist" aria-label="Seções da ficha" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#efede7] p-1">
                    {TABS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        onClick={() => setTab(item.id)}
                        className={cn('h-8 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold', tab === item.id ? 'bg-white text-[#15151c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d]')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onEdit(baseProduct)} className="flex h-[38px] items-center rounded-xl border border-[#dcd9d1] bg-white px-4 text-[13px] font-bold hover:border-[#15151c]">
                      <Edit className="mr-1.5 h-3.5 w-3.5" /> Editar
                    </button>
                    <button type="button" aria-label="Fechar" onClick={() => onOpenChange(false)} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#efede7] text-[#4a4f57]"><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="text-[13px] text-[#70757d]">
                  {tab === 'dados' ? 'Parâmetros de estoque por local, como estão salvos hoje.' : `${withContent} de ${linkedProducts.length} insumos vinculados têm fotos ou dados nutricionais.`}
                </p>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="px-5 py-[22px] sm:px-[30px]">
                  {tab === 'dados' && (
                    <div className="flex flex-col gap-3.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[15px] font-extrabold tracking-[-.01em]">Estoque por quiosque</span>
                        <button type="button" onClick={() => setShowHow((v) => !v)} aria-expanded={showHow} className="text-[12.5px] font-bold text-[#5b5bd6]">{showHow ? 'Ocultar detalhes' : 'Como é calculado?'}</button>
                      </div>
                      {showHow && (
                        <ul className="flex list-disc flex-col gap-1.5 rounded-xl bg-[#f1efe9] py-3 pl-7 pr-3.5 text-[12.5px] leading-[1.55] text-[#4a4f57]">
                          <li>Nos dias 1 e 16, o sistema recalcula o estoque mínimo, com margem de 30%. A recomendação considera o estoque físico líquido de reservas, sem abater compras a caminho.</li>
                          <li>A base do cálculo (mensal ou quinzenal) é definida na edição do insumo. Itens em unidades são arredondados para cima; itens em kg/L mantêm casas decimais.</li>
                          <li>{legacy
                            ? 'No modelo legado, unidades com "Travado" mantêm o valor manual. A política nova permanece em comparação até sua ativação.'
                            : 'O modelo automático exige dados utilizáveis. Cálculo pendente não equivale a mínimo zero. O CD considera apenas unidades abastecidas por ele.'}</li>
                        </ul>
                      )}
                      {kiosksWithStockParams.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-[#d6d2c8] px-4 py-8 text-center text-[13px] text-[#70757d]">Nenhum parâmetro de estoque por local salvo para este insumo.</div>
                      ) : (
                        <div className="overflow-hidden rounded-2xl border border-[#e6e2da] bg-white">
                          <div style={{ gridTemplateColumns }} className="grid gap-3.5 border-b border-[#eeebe4] bg-[#f8f7f3] px-4 py-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-[#8a8f99]">
                            <span>Quiosque</span><span>Mínimo</span>
                            {legacy && <span className="text-right">Segurança legada</span>}
                            <span className="text-right">Lead time</span>
                          </div>
                          {kiosksWithStockParams.map(({ kiosk, level }, i) => {
                            const minimum = operationalMinimum(level, policyEnabled);
                            const isSupply = operationalUnits.find(u => u.externalSource === 'kiosk' && u.externalId === kiosk.id)?.stockRole === 'supply';
                            const lead = policyEnabled ? level.effectiveLeadTime : level.leadTime;
                            const badge = legacy && level.override ? 'Travado' : minimum.minimum !== null && (policyEnabled === true || level.lastAutoCalculatedAt) ? 'Auto' : '';
                            const sub = policyEnabled === true
                              ? `${isSupply ? 'Abastecimento' : level.supplyMode === 'direct' ? 'Compra direta' : 'Via CD'} · ${minimum.label}${minimum.limitation ? ` · ${minimum.limitation}` : ''}`
                              : minimum.limitation ?? '';
                            return (
                              <div key={kiosk.id} style={{ gridTemplateColumns }} className={cn('grid items-center gap-3.5 px-4 py-3', i > 0 && 'border-t border-[#f0ede7]')}>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="text-[13.5px] font-bold">{kiosk.name}</span>
                                  <span className="text-[11.5px] text-[#8a8f99]">{isSupply ? 'Abastecimento' : 'Unidade comercial'}</span>
                                </div>
                                <div className="flex min-w-0 flex-col gap-[3px]">
                                  <div className="flex flex-wrap items-center gap-[7px]">
                                    {minimum.minimum !== null
                                      ? <span className="whitespace-nowrap font-mono text-[15px] font-bold">{minimum.minimum} {baseProduct.unit}</span>
                                      : <span className="inline-block rounded-[10px] border border-[#f5d9a3] bg-[#fff7e6] px-[9px] py-[3px] text-xs font-bold leading-snug text-[#8a5a00]">{minimum.label}</span>}
                                    {badge && <span className={cn('rounded-full px-[7px] py-0.5 text-[10px] font-extrabold uppercase tracking-[.06em]', badge === 'Travado' ? 'bg-[#fef3c7] text-[#b45309]' : 'bg-[#d1fae5] text-[#047857]')}>{badge}</span>}
                                  </div>
                                  {sub && <span className="text-[11.5px] text-[#70757d]">{sub}</span>}
                                </div>
                                {legacy && <span className="text-right text-[13.5px] tabular-nums">{level.safetyStock ? `${level.safetyStock} ${baseProduct.unit}` : '—'}</span>}
                                <span className="text-right text-[13.5px] tabular-nums">{lead ? `${lead}d` : '—'}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {tab === 'nutri' && (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-[#e0ddd5] bg-white px-3.5">
                          <span aria-hidden className="text-sm text-[#8a8f99]">⌕</span>
                          <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Buscar insumo, marca ou embalagem"
                            aria-label="Buscar insumo, marca ou embalagem"
                            className="flex-1 bg-transparent text-[13.5px] outline-none"
                          />
                        </div>
                        <div role="radiogroup" aria-label="Filtrar por dados" className="flex gap-0.5 rounded-[10px] bg-[#efede7] p-[3px]">
                          {FILTERS.map((f) => (
                            <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)}
                              className={cn('h-8 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold', filter === f.id ? 'bg-white text-[#15151c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-[#70757d]')}>
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {linkedProducts.length === 0 ? (
                        <div className="py-10 text-center text-[13px] text-[#70757d]">Nenhum insumo vinculado a este produto base.</div>
                      ) : visibleProducts.length === 0 ? (
                        <div className="py-10 text-center text-[13px] text-[#70757d]">Nenhum insumo encontrado.</div>
                      ) : visibleProducts.map((product) => {
                        const isOpen = openIds[product.id] ?? product.id === firstProductId;
                        const withData = hasContent(product);
                        return (
                          <div key={product.id} className="overflow-hidden rounded-2xl border border-[#e6e2da] bg-white">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => setOpenIds((prev) => ({ ...prev, [product.id]: !isOpen }))}
                              className="flex w-full items-center justify-between gap-3 px-4 py-[13px] text-left"
                            >
                              <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate text-[13.5px] font-bold text-[#15151c]">{product.baseName}</span>
                                <span className="text-[11.5px] text-[#70757d]">{product.brand ? `${product.brand} · ` : ''}{product.packageSize} {product.unit} · {product.packageType || 'Embalagem'}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2.5">
                                <span className={cn('whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11px] font-bold', withData ? 'bg-[#d1fae5] text-[#047857]' : 'bg-[#efede7] text-[#70757d]')}>{withData ? 'Com dados' : 'Sem dados'}</span>
                                <span aria-hidden className="text-[11px] text-[#8a8f99]">{isOpen ? '▴' : '▾'}</span>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="border-t border-[#f0ede7] px-4 pb-4 pt-3.5">
                                <ProductPanel product={product} onZoom={setZoomedImage} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="flex justify-end border-t border-[#e6e2da] px-5 py-3.5 sm:px-[30px]">
                <button type="button" onClick={() => onOpenChange(false)} className="h-[42px] whitespace-nowrap rounded-xl border border-[#dcd9d1] bg-white px-5 text-[13.5px] font-bold">Fechar</button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {zoomedImage && (
        <Dialog open onOpenChange={() => setZoomedImage(null)}>
          <DialogContent className="max-w-3xl border-none bg-black p-2">
            <DialogTitle className="sr-only">Foto ampliada</DialogTitle>
            <DialogDescription className="sr-only">Foto da embalagem ampliada.</DialogDescription>
            <Image src={zoomedImage} alt="Ampliado" width={800} height={1000} className="h-auto max-h-[85vh] w-full rounded object-contain" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
