"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Clock,
  Weight,
  X,
  ChevronLeft,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canViewTechnicalSheets } from '@/lib/commercial-permissions';
import { ControlPanel } from '@/components/patterns/control-panel';
import { FilterChips } from '@/components/patterns/filter-chips';
import { SidePanel, PanelField } from '@/components/patterns/side-panel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SheetContent, SheetThumb, fmtTime, fmtWeight, sheetKicker } from '@/components/technical-sheet/sheet-content';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = { id: string; text: string; quantity?: number; unit?: string; imageUrl?: string };
type Phase = { id: string; name: string; etapas: Step[] };
type Ingredient = { name: string; quantity: number; unit: string };
type Product = {
  id: string;
  name: string;
  lineId: string | null;
  imageUrl: string | null;
  preparationTime: number | null;
  portionWeight: number | null;
  portionTolerance: number | null;
  assemblyInstructions: Phase[];
  qualityStandard: { id: string; text: string }[];
  allergens: { id: string; text: string }[];
  assemblyVideoUrl: string | null;
  ingredients: Ingredient[];
};
type Line = { id: string; name: string; color?: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesSearch(name: string, query: string): boolean {
  if (!query.trim()) return true;
  const words = query.trim().toLowerCase().split(/\s+/);
  const target = name.toLowerCase();
  return words.every(w => target.includes(w));
}

// ─── Peças ────────────────────────────────────────────────────────────────────

const NO_LINE = '__none__';
const kicker = sheetKicker;

function ProductCard({ product, lineName, selected, onOpen }: { product: Product; lineName: string | null; selected: boolean; onOpen: () => void }) {
  const hasInstructions = product.assemblyInstructions.length > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      data-ui="product-card"
      className={cn(
        'flex flex-col overflow-hidden rounded-ds-card border bg-ds-surface text-left outline-none',
        'transition-[transform,box-shadow] duration-[180ms] ease-ds-lift hover:-translate-y-[3px] hover:shadow-ds-lift',
        'focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2 motion-reduce:hover:translate-y-0',
        selected ? 'border-ds-accent-ink bg-ds-accent-row' : 'border-ds-border',
      )}
    >
      <SheetThumb imageUrl={product.imageUrl} name={product.name} className="aspect-[4/3] w-full" sizes="(min-width:1280px) 20vw, (min-width:768px) 28vw, 50vw" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        {lineName && <p className={kicker}>{lineName}</p>}
        <p className="line-clamp-2 text-[14px] font-extrabold leading-tight text-ds-ink">{product.name}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-ds-ink-muted">
          {product.preparationTime != null && <span className="inline-flex items-center gap-1"><Clock aria-hidden="true" size={12} />{fmtTime(product.preparationTime)}</span>}
          {product.portionWeight != null && <span className="inline-flex items-center gap-1"><Weight aria-hidden="true" size={12} />{fmtWeight(product.portionWeight)}</span>}
          <span className={cn('ml-auto', hasInstructions ? 'text-ds-ok' : 'text-ds-ink-faint')}>{hasInstructions ? 'Com montagem' : 'Sem montagem'}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Painel lateral (resumo) ──────────────────────────────────────────────────

function ProductSummaryPanel({ product, lineName, onClose, onOpenSheet }: { product: Product | null; lineName: string | null; onClose: () => void; onOpenSheet: () => void }) {
  const firstPhase = product?.assemblyInstructions[0];
  const allergenText = product && product.allergens.length > 0 ? product.allergens.map(a => a.text).join(', ') : 'Nenhum';
  return (
    <SidePanel
      open={!!product}
      onOpenChange={open => { if (!open) onClose(); }}
      kicker={lineName ?? 'Ficha técnica'}
      title={product?.name ?? ''}
      subtitle={product ? `${product.ingredients.length} ingrediente(s) · ${product.assemblyInstructions.length} fase(s) de montagem` : undefined}
      highlights={product ? (
        <>
          <span>{product.preparationTime ? fmtTime(product.preparationTime) : '—'}<span className="ml-1 text-[11px] font-bold text-ds-on-dark-sub">tempo</span></span>
          <span>{product.portionWeight ? fmtWeight(product.portionWeight) : '—'}<span className="ml-1 text-[11px] font-bold text-ds-on-dark-sub">peso</span></span>
        </>
      ) : undefined}
    >
      {product && (
        <>
          <SheetThumb imageUrl={product.imageUrl} name={product.name} className="aspect-[16/10] w-full rounded-ds-card border border-ds-border" sizes="460px" />
          <div className="grid grid-cols-2 gap-4">
            <PanelField label="Tolerância">{product.portionTolerance ? `±${product.portionTolerance} g` : '—'}</PanelField>
            <PanelField label="Alergênicos">{allergenText}</PanelField>
          </div>
          <div>
            <p className={kicker}>{firstPhase ? `Montagem · ${firstPhase.name}` : 'Montagem'}</p>
            {firstPhase ? (
              <ol className="mt-2 space-y-1.5">
                {firstPhase.etapas.slice(0, 3).map((step, i) => (
                  <li key={step.id} className="flex gap-2 text-[13px] font-semibold text-ds-ink">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-ds-sm bg-ds-muted text-[11px] font-extrabold text-ds-ink-2">{i + 1}</span>
                    <span className="line-clamp-2">{step.text}</span>
                  </li>
                ))}
                {firstPhase.etapas.length > 3 && <li className="pl-7 text-[12px] font-semibold text-ds-ink-faint">+{firstPhase.etapas.length - 3} etapa(s)</li>}
              </ol>
            ) : (
              <p className="mt-2 text-[13px] font-semibold text-ds-ink-faint">Sem instruções cadastradas.</p>
            )}
          </div>
          <Button variant="primary-modal" size="md" onClick={onOpenSheet}>Ver ficha completa</Button>
        </>
      )}
    </SidePanel>
  );
}

// ─── Ficha completa (subtela) ─────────────────────────────────────────────────

function ExpandedPanel({ product, lineName, origin, onClose }: { product: Product; lineName: string | null; origin: DOMRect | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);

  const clipFor = useCallback(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!origin) return null;
    return `inset(${((origin.top / vh) * 100).toFixed(1)}% ${(((vw - origin.right) / vw) * 100).toFixed(1)}% ${(((vh - origin.bottom) / vh) * 100).toFixed(1)}% ${((origin.left / vw) * 100).toFixed(1)}% round 16px)`;
  }, [origin]);

  useEffect(() => {
    const el = panelRef.current;
    backRef.current?.focus();
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = clipFor();
    if (reduce || !from) { el.style.opacity = '1'; return; }
    el.animate([{ clipPath: from, opacity: 0 }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
  }, [clipFor]);

  const handleClose = useCallback(() => {
    const el = panelRef.current;
    if (!el || closing) return;
    setClosing(true);
    const to = clipFor();
    if (!to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    el.animate([{ clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 }, { clipPath: to, opacity: 0 }], { duration: 320, easing: 'cubic-bezier(0.64, 0, 0.78, 0)', fill: 'forwards' }).finished.then(onClose);
  }, [closing, onClose, clipFor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);



  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Ficha técnica de ${product.name}`} className="fixed inset-0 z-50 overflow-y-auto bg-ds-page font-ds" style={{ opacity: 0 }}>
      <header className="sticky top-0 z-10 bg-ds-dark text-ds-on-dark">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:px-6">
          <button
            ref={backRef}
            type="button"
            onClick={handleClose}
            aria-label="Voltar para as fichas técnicas"
            className="flex h-9 w-9 items-center justify-center rounded-ds-btn border border-white/[.12] text-ds-on-dark-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <div className="min-w-0">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">{lineName ?? 'Ficha técnica'}</p>
            <h2 className="truncate text-[18px] font-extrabold">{product.name}</h2>
          </div>
        </div>
      </header>

      <SheetContent product={product} className="mx-auto max-w-7xl px-4 pb-10 pt-5 md:px-6" />
    </div>
  );
}

// ─── CatalogoView ─────────────────────────────────────────────────────────────

export function CatalogoView({ embedded = false }: { embedded?: boolean } = {}) {
  const { firebaseUser, loading: authLoading, permissions } = useAuth();
  const canAccessCatalog = canViewTechnicalSheets(permissions);
  const [lines, setLines] = useState<Line[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lineFilter, setLineFilter] = useState<string | null>(null);
  const [summary, setSummary] = useState<Product | null>(null);
  const [expanded, setExpanded] = useState<{ product: Product; origin: DOMRect | null } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;

    const loadCatalog = async () => {
      if (authLoading) {
        setLoading(true);
        return;
      }

      if (!firebaseUser) {
        setLines([]);
        setProducts([]);
        setErrorMessage('Faça login no sistema para consultar as fichas técnicas.');
        setLoading(false);
        return;
      }

      if (!canAccessCatalog) {
        setLines([]);
        setProducts([]);
        setErrorMessage('Seu perfil não tem permissão para consultar fichas técnicas.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage(null);

      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/catalogo', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Falha ao carregar fichas técnicas.');
        }

        if (!active) return;
        if (data?.products && Array.isArray(data.products)) {
          setProducts(data.products);
          setLines(data.lines ?? []);
        } else {
          throw new Error('Resposta inválida ao carregar fichas técnicas.');
        }
      } catch (error) {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'Erro ao carregar produtos.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadCatalog();

    return () => {
      active = false;
    };
  }, [authLoading, firebaseUser, canAccessCatalog]);

  const lineNameById = useMemo(() => new Map(lines.map(l => [l.id, l.name])), [lines]);
  const lineNameOf = (product: Product | null) => (product?.lineId ? lineNameById.get(product.lineId) ?? null : null);

  const visibleProducts = useMemo(
    () => products.filter(p => matchesSearch(p.name, search) && (lineFilter === null || (lineFilter === NO_LINE ? !p.lineId : p.lineId === lineFilter))),
    [products, search, lineFilter],
  );

  const chips = useMemo(() => {
    const items = lines.map(l => ({ value: l.id, label: l.name, count: products.filter(p => p.lineId === l.id).length }));
    const noLine = products.filter(p => !p.lineId).length;
    return noLine > 0 ? [...items, { value: NO_LINE, label: 'Sem linha', count: noLine }] : items;
  }, [lines, products]);

  const filtering = search.trim().length > 0 || lineFilter !== null;
  const ready = !loading && !errorMessage;

  function openSheet() {
    if (!summary) return;
    const card = openerRef.current?.getBoundingClientRect() ?? null;
    setExpanded({ product: summary, origin: card });
    setSummary(null);
  }

  return (
    <>
      <div className={cn('flex flex-col gap-4 font-ds', embedded ? '' : 'min-h-screen bg-ds-page p-4 md:p-6')}>
        <div className="mx-auto w-full max-w-[1600px] space-y-4">
          <ControlPanel>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Comercial</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <h1 className="text-2xl font-extrabold">Fichas técnicas</h1>
              {ready && <p className="text-[13px] font-bold text-ds-on-dark-2">{visibleProducts.length} de {products.length} mercadoria(s)</p>}
            </div>
            <div className="relative mt-4">
              <Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-on-dark-muted" />
              <input
                type="search"
                aria-label="Buscar mercadoria"
                placeholder="Buscar em todas as mercadorias..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-11 w-full rounded-ds-btn border border-white/[.12] bg-white/[.06] pl-9 pr-10 text-[14px] font-semibold text-ds-on-dark outline-none placeholder:text-ds-on-dark-muted focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
              />
              {search && (
                <button type="button" aria-label="Limpar busca" onClick={() => setSearch('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-ds-sm text-ds-on-dark-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker">
                  <X aria-hidden="true" size={14} />
                </button>
              )}
            </div>
            {chips.length > 0 && <FilterChips className="mt-4" value={lineFilter} onChange={setLineFilter} allCount={products.length} chips={chips} />}
          </ControlPanel>

          {loading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5" aria-busy="true">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-ds-card bg-ds-muted" />)}
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="flex flex-col items-center rounded-ds-card border border-dashed border-ds-border-input px-4 py-16 text-center">
              <AlertCircle aria-hidden="true" size={32} className="mb-3 text-ds-ink-faint" />
              <p className="text-[14px] font-bold text-ds-ink-2">{errorMessage}</p>
              <Button className="mt-4" variant="ds-secondary" size="md" onClick={() => { if (!firebaseUser) window.location.href = '/login'; else window.location.reload(); }}>
                {!firebaseUser ? 'Ir para o login' : 'Tentar novamente'}
              </Button>
            </div>
          )}

          {ready && (visibleProducts.length === 0 ? (
            <div className="rounded-ds-card border border-dashed border-ds-border-input px-4 py-16 text-center">
              <p className="text-[14px] font-bold text-ds-ink-2">{filtering ? 'Nenhuma mercadoria encontrada para esses filtros.' : 'Nenhuma ficha técnica cadastrada.'}</p>
              {filtering && <Button className="mt-3" variant="ds-link" size="md" onClick={() => { setSearch(''); setLineFilter(null); }}>Limpar filtros</Button>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {visibleProducts.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  lineName={lineNameOf(product)}
                  selected={summary?.id === product.id}
                  onOpen={() => { openerRef.current = document.activeElement as HTMLElement | null; setSummary(product); }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <ProductSummaryPanel product={summary} lineName={lineNameOf(summary)} onClose={() => setSummary(null)} onOpenSheet={openSheet} />

      {expanded && (
        <ExpandedPanel
          product={expanded.product}
          lineName={lineNameOf(expanded.product)}
          origin={expanded.origin}
          onClose={() => { setExpanded(null); openerRef.current?.focus(); }}
        />
      )}
    </>
  );
}
