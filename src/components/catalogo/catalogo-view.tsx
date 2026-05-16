"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Search,
  Clock,
  Weight,
  X,
  Play,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  UtensilsCrossed,
  Layers,
  ChevronRight,
  FileText,
  Award,
  Video,
  LayoutDashboard,
} from 'lucide-react';

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

const PALETTE = [
  { bg: '#EDE7FF', dot: '#7C3AED', text: '#4C1D95' },
  { bg: '#FFE4E6', dot: '#E11D48', text: '#881337' },
  { bg: '#D1FAE5', dot: '#059669', text: '#064E3B' },
  { bg: '#FEF3C7', dot: '#D97706', text: '#78350F' },
  { bg: '#DBEAFE', dot: '#2563EB', text: '#1E3A8A' },
  { bg: '#FCE7F3', dot: '#DB2777', text: '#831843' },
  { bg: '#CCFBF1', dot: '#0D9488', text: '#134E4A' },
  { bg: '#FFF7ED', dot: '#EA580C', text: '#7C2D12' },
];

function colorFor(idx: number) {
  return PALETTE[idx % PALETTE.length];
}

function matchesSearch(name: string, query: string): boolean {
  if (!query.trim()) return true;
  const words = query.trim().toLowerCase().split(/\s+/);
  const target = name.toLowerCase();
  return words.every(w => target.includes(w));
}

function getEmbedUrl(url: string): { type: 'iframe' | 'video'; src: string } | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return { type: 'video', src: url };
  return null;
}

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

function fmtWeight(g: number) {
  return g >= 1000 ? `${(g / 1000).toFixed(1).replace('.0', '')} kg` : `${g} g`;
}

// ─── ProductCard ──────────────────────────────────────────────────────────────

function ProductCard({
  product,
  colorIdx,
  onExpand,
}: {
  product: Product;
  colorIdx: number;
  onExpand: (product: Product, origin: DOMRect) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const color = colorFor(colorIdx);
  const firstPhase = product.assemblyInstructions[0];
  const previewSteps = firstPhase?.etapas.slice(0, 3) ?? [];
  const hasInstructions = product.assemblyInstructions.length > 0;

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (cardRef.current) onExpand(product, cardRef.current.getBoundingClientRect());
    },
    [onExpand, product],
  );

  return (
    <div ref={cardRef} style={{ perspective: '1200px', aspectRatio: '3/4' }}>
      <div
        className="w-full h-full relative"
        style={{
          transformStyle: 'preserve-3d',
          transition: 'transform 0.65s cubic-bezier(0.4, 0, 0.2, 1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          cursor: 'pointer',
        }}
        onClick={() => setFlipped(f => !f)}
      >
        {/* FRONT */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow select-none"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {/* Full-bleed image — top 65% */}
          <div className="relative" style={{ height: '65%', background: color.bg }}>
            {product.imageUrl ? (
              <Image src={product.imageUrl} alt={product.name} fill className="object-cover" sizes="300px" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <UtensilsCrossed size={40} style={{ color: color.dot, opacity: 0.4 }} />
              </div>
            )}
            {/* Subtle gradient at bottom for text legibility if ever overlapping */}
            <div className="absolute inset-x-0 bottom-0 h-6" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.4), transparent)' }} />
          </div>

          {/* Info — bottom 35% */}
          <div className="flex flex-col justify-between px-2.5 py-2" style={{ height: '35%' }}>
            <p className="font-semibold text-center leading-tight text-xs" style={{ color: '#1a1a2e' }}>
              {product.name}
            </p>
            <div className="flex items-center gap-1 flex-wrap justify-center">
              {product.preparationTime != null && (
                <span className="flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: color.bg, color: color.text }}>
                  <Clock size={8} />{fmtTime(product.preparationTime)}
                </span>
              )}
              {product.portionWeight != null && (
                <span className="flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: color.bg, color: color.text }}>
                  <Weight size={8} />{fmtWeight(product.portionWeight)}
                </span>
              )}
            </div>
            <p className="text-[9px] text-gray-400 text-center">
              {hasInstructions ? 'Toque para ver montagem' : 'Sem montagem'}
            </p>
          </div>
        </div>

        {/* BACK */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden flex flex-col select-none"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', background: '#1a1a2e' }}
        >
          <div className="px-3 py-2 flex items-center justify-between flex-shrink-0" style={{ background: color.dot }}>
            <span className="text-white text-[9px] font-bold uppercase tracking-wider truncate">{product.name}</span>
            <Layers size={11} className="text-white opacity-80 flex-shrink-0 ml-1" />
          </div>
          <div className="flex-1 overflow-hidden px-2.5 py-2 space-y-1.5">
            {!hasInstructions ? (
              <p className="text-gray-400 text-xs text-center mt-6">Sem instruções cadastradas</p>
            ) : (
              <>
                {firstPhase && (
                  <p className="text-gray-400 text-[8px] uppercase tracking-wide font-medium">{firstPhase.name}</p>
                )}
                {previewSteps.map((step, i) => (
                  <div key={step.id} className="flex gap-1.5 items-start">
                    <span className="flex-shrink-0 rounded-full text-[8px] font-bold flex items-center justify-center mt-0.5"
                      style={{ width: 14, height: 14, background: color.dot, color: 'white' }}>
                      {i + 1}
                    </span>
                    <p className="text-white text-[10px] leading-snug line-clamp-2">
                      {step.text}
                      {step.quantity && step.unit && (
                        <span style={{ color: color.bg }}> ({step.quantity} {step.unit})</span>
                      )}
                    </p>
                  </div>
                ))}
                {firstPhase && firstPhase.etapas.length > 3 && (
                  <p className="text-gray-500 text-[8px] pl-4">+{firstPhase.etapas.length - 3} etapas...</p>
                )}
              </>
            )}
          </div>
          <div className="px-2.5 pb-2.5 flex-shrink-0">
            <button
              className="w-full py-1.5 rounded-xl text-[10px] font-semibold transition-opacity active:opacity-70"
              style={{ background: color.dot, color: 'white' }}
              onClick={handleExpand}
            >
              Ver ficha completa
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ExpandedPanel ────────────────────────────────────────────────────────────

function ExpandedPanel({ product, origin, onClose }: { product: Product; origin: DOMRect; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cl = `${((origin.left / vw) * 100).toFixed(1)}%`;
    const ct = `${((origin.top / vh) * 100).toFixed(1)}%`;
    const cr = `${(((vw - origin.right) / vw) * 100).toFixed(1)}%`;
    const cb = `${(((vh - origin.bottom) / vh) * 100).toFixed(1)}%`;
    el.animate([
      { clipPath: `inset(${ct} ${cr} ${cb} ${cl} round 16px)`, opacity: 0 },
      { clipPath: `inset(${parseFloat(ct) * 0.3}% ${parseFloat(cr) * 0.3}% 0% ${parseFloat(cl) * 0.3}% round 24px)`, opacity: 1, offset: 0.35 },
      { clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 },
    ], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
  }, [origin]);

  const handleClose = useCallback(() => {
    const el = panelRef.current;
    if (!el || closing) return;
    setClosing(true);
    const vw = window.innerWidth, vh = window.innerHeight;
    const cl = `${((origin.left / vw) * 100).toFixed(1)}%`;
    const ct = `${((origin.top / vh) * 100).toFixed(1)}%`;
    const cr = `${(((vw - origin.right) / vw) * 100).toFixed(1)}%`;
    const cb = `${(((vh - origin.bottom) / vh) * 100).toFixed(1)}%`;
    el.animate([
      { clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 },
      { clipPath: `inset(${parseFloat(ct) * 0.3}% ${parseFloat(cr) * 0.3}% 0% ${parseFloat(cl) * 0.3}% round 24px)`, opacity: 1, offset: 0.65 },
      { clipPath: `inset(${ct} ${cr} ${cb} ${cl} round 16px)`, opacity: 0 },
    ], { duration: 380, easing: 'cubic-bezier(0.64, 0, 0.78, 0)', fill: 'forwards' }).finished.then(onClose);
  }, [closing, onClose, origin]);

  const allergenText = product.allergens.length > 0
    ? product.allergens.map(a => a.text).join(', ')
    : 'Nenhum';

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-50 bg-white overflow-y-auto"
      style={{ opacity: 0 }}
    >
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10" style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
        <button
          onClick={handleClose}
          className="flex items-center gap-1.5 text-white/80 hover:text-white px-4 py-3"
        >
          <ChevronLeft size={20} />
          <span className="text-sm font-medium">Voltar</span>
        </button>
      </div>

      {/* Two-column layout on desktop, stacked on mobile */}
      <div className="max-w-7xl mx-auto px-4 md:px-6 pt-4 pb-10 md:grid md:gap-8 md:items-start"
        style={{ gridTemplateColumns: '300px 1fr' }}>

        {/* LEFT — photo + metrics (sticky on desktop) */}
        <div className="md:sticky md:top-14 space-y-3 mb-6 md:mb-0">
          {product.imageUrl ? (
            <div className="rounded-2xl overflow-hidden relative shadow-md" style={{ aspectRatio: '3/4' }}>
              <Image src={product.imageUrl} alt={product.name} fill className="object-cover" sizes="300px" />
              <div className="absolute inset-x-0 bottom-0 p-4"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 70%)' }}>
                <p className="text-white/70 text-[9px] font-bold uppercase tracking-widest">Foto de Referência</p>
                <h2 className="text-white font-black text-lg leading-tight">{product.name}</h2>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center bg-gray-50 text-gray-400"
              style={{ aspectRatio: '3/4' }}>
              <UtensilsCrossed size={36} className="mb-2 opacity-20" />
              <p className="text-sm font-medium text-center px-4">{product.name}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100">
              <Clock size={16} className="text-blue-500" />
              <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide text-center">Tempo</p>
              <p className="text-sm font-black text-gray-900">{product.preparationTime ? fmtTime(product.preparationTime) : '—'}</p>
            </div>
            <div className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100">
              <Weight size={16} className="text-pink-500" />
              <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide text-center">Peso</p>
              <p className="text-sm font-black text-gray-900">{product.portionWeight ? fmtWeight(product.portionWeight) : '—'}</p>
            </div>
            <div className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100">
              <Award size={16} className="text-orange-500" />
              <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide text-center">Tolerância</p>
              <p className="text-sm font-black text-gray-900">{product.portionTolerance ? `±${product.portionTolerance}g` : '—'}</p>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-orange-100">
              <AlertCircle size={16} className="text-orange-500" />
              <p className="text-[8px] font-bold text-orange-700 uppercase tracking-wide text-center">Alergênicos</p>
              <p className="text-[10px] font-bold text-orange-900 text-center leading-tight">{allergenText}</p>
            </div>
          </div>

          {/* Nutritional table placeholder */}
          <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: '#1a1a2e' }}>
              <FileText size={13} className="text-gray-300" />
              <span className="text-white font-semibold text-sm">Tabela Nutricional</span>
            </div>
            <div className="px-4 py-6 flex flex-col items-center justify-center gap-2 text-gray-300">
              <FileText size={28} className="opacity-20" />
              <p className="text-xs text-center text-gray-400">Em breve</p>
            </div>
          </div>
        </div>

        {/* RIGHT — assembly + quality + ingredients */}
        <div className="space-y-5">
          <h2 className="font-black text-gray-900 text-xl md:hidden">{product.name}</h2>

          {/* Assembly */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b-2 border-blue-500 pb-2">
              <LayoutDashboard size={17} className="text-blue-600" />
              <h3 className="font-black text-gray-900 text-base">Passo a Passo de Montagem</h3>
            </div>
            {product.assemblyInstructions.length === 0 ? (
              <div className="py-10 border-2 border-dashed border-gray-100 rounded-2xl text-center text-gray-400">
                <Layers size={28} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">Sem instruções cadastradas</p>
              </div>
            ) : (
              product.assemblyInstructions.map((phase) => (
                <div key={phase.id} className="space-y-2">
                  <div className="bg-blue-50 px-3 py-1.5 rounded-lg inline-block">
                    <p className="font-black text-blue-700 text-xs uppercase tracking-widest">{phase.name}</p>
                  </div>
                  <div className="space-y-2">
                    {phase.etapas.map((step, si) => (
                      <div key={step.id} className="flex gap-3 items-start bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                        <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-white font-black text-base shadow-md"
                          style={{ background: '#2563EB' }}>
                          {si + 1}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <p className="text-gray-800 font-semibold text-sm leading-snug">{step.text}</p>
                          {step.quantity && step.unit && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-bold text-xs">
                              <UtensilsCrossed size={9} /> {step.quantity} {step.unit}
                            </span>
                          )}
                        </div>
                        {step.imageUrl && (
                          <div className="flex-shrink-0 relative rounded-xl overflow-hidden border-2 border-white shadow-md" style={{ width: 68, height: 68 }}>
                            <Image src={step.imageUrl} alt={`Etapa ${si + 1}`} fill className="object-cover" sizes="68px" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quality */}
          {product.qualityStandard.length > 0 && (
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
              <div className="px-4 py-3 flex items-center gap-2" style={{ background: '#1a1a2e' }}>
                <CheckCircle2 size={14} className="text-green-400" />
                <span className="text-white font-semibold text-sm">Padrão de Qualidade</span>
              </div>
              <div className="divide-y divide-gray-50">
                {product.qualityStandard.map(item => (
                  <div key={item.id} className="flex gap-3 p-3 items-start">
                    <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                    <p className="text-gray-800 text-sm">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ingredients */}
          {product.ingredients.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: '#F9FAFB' }}>
              <div className="px-4 py-3 flex items-center gap-2">
                <FileText size={13} className="text-gray-400" />
                <span className="font-black text-gray-700 text-xs uppercase tracking-widest">Checklist de Ingredientes</span>
              </div>
              <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {product.ingredients.map(ing => (
                  <div key={ing.name} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-700 text-sm truncate">{ing.name}</span>
                    <span className="flex-shrink-0 text-xs font-black text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                      {ing.quantity} {ing.unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Video */}
          {product.assemblyVideoUrl && (() => {
            const embed = getEmbedUrl(product.assemblyVideoUrl);
            if (!embed) return (
              <a href={product.assemblyVideoUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: '#EFF6FF', border: '2px solid #BFDBFE', textDecoration: 'none' }}>
                <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white flex-shrink-0">
                  <Video size={16} />
                </div>
                <div>
                  <p className="font-black text-blue-900 text-xs">Vídeo de Montagem</p>
                  <p className="text-[10px] text-blue-600 font-medium">Abrir link externo</p>
                </div>
              </a>
            );
            return (
              <div className="space-y-1.5">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                  <Video size={10} /> Vídeo de Montagem
                </p>
                <div className="rounded-2xl overflow-hidden shadow-md w-full" style={{ aspectRatio: '16/9' }}>
                  {embed.type === 'iframe' ? (
                    <iframe
                      src={embed.src}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <video src={embed.src} controls className="w-full h-full bg-black" />
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── LineCard ─────────────────────────────────────────────────────────────────

function LineCard({ line, count, index, onClick }: { line: Line; count: number; index: number; onClick: () => void }) {
  const color = colorFor(index);
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow active:scale-[0.98] transition-transform"
    >
      {/* Colored bar */}
      <div className="h-2" style={{ background: color.dot }} />
      <div className="p-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm" style={{ color: '#1a1a2e' }}>{line.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{count} mercadoria{count !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold rounded-full px-2.5 py-1" style={{ background: color.bg, color: color.dot }}>
            {count}
          </span>
          <ChevronRight size={16} className="text-gray-300" />
        </div>
      </div>
    </button>
  );
}

// ─── CatalogoView ─────────────────────────────────────────────────────────────

export function CatalogoView() {
  const [lines, setLines] = useState<Line[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLine, setSelectedLine] = useState<Line | null>(null);
  const [expanded, setExpanded] = useState<{ product: Product; origin: DOMRect } | null>(null);

  useEffect(() => {
    fetch('/api/catalogo')
      .then(r => r.json())
      .then((data) => {
        if (data?.products && Array.isArray(data.products)) {
          setProducts(data.products);
          setLines(data.lines ?? []);
        } else {
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const handleExpand = useCallback((product: Product, origin: DOMRect) => {
    setExpanded({ product, origin });
  }, []);

  // Compute visible products
  const isSearching = search.trim().length > 0;

  const visibleProducts = (() => {
    if (isSearching) {
      return products.filter(p => matchesSearch(p.name, search));
    }
    if (selectedLine) {
      return products.filter(p => p.lineId === selectedLine.id);
    }
    return [];
  })();

  const countByLine = (lineId: string) => products.filter(p => p.lineId === lineId).length;
  const noLineCount = products.filter(p => !p.lineId).length;

  const showLines = !isSearching && !selectedLine;
  const showProducts = isSearching || !!selectedLine;

  const headerTitle = isSearching
    ? `${visibleProducts.length} resultado${visibleProducts.length !== 1 ? 's' : ''}`
    : selectedLine
    ? selectedLine.name
    : 'Fichas Técnicas';

  return (
    <>
      <div className="min-h-screen flex flex-col">
        {/* Sticky header */}
        <div
          className="sticky top-0 z-40 flex-shrink-0"
          style={{
            background: 'rgba(248,249,250,0.9)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <div className="px-4 pt-4 pb-3 max-w-7xl mx-auto">
            {/* Title row */}
            <div className="flex items-center gap-2 mb-3">
              {selectedLine && !isSearching && (
                <button onClick={() => setSelectedLine(null)} className="p-1 -ml-1 text-gray-500 hover:text-gray-800">
                  <ChevronLeft size={20} />
                </button>
              )}
              <h1 className="font-bold text-gray-900 flex-1" style={{ fontSize: 19 }}>
                {headerTitle}
              </h1>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar em todas as mercadorias..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border-none outline-none"
                style={{ background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', color: '#1a1a2e' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 py-4 max-w-7xl mx-auto w-full pb-8">
          {/* Loading */}
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-2xl animate-pulse h-16" style={{ background: '#e5e7eb' }} />
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex flex-col items-center py-20 text-gray-400">
              <AlertCircle size={36} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">Erro ao carregar produtos</p>
              <button className="mt-4 text-xs text-purple-600 font-semibold" onClick={() => window.location.reload()}>
                Tentar novamente
              </button>
            </div>
          )}

          {/* Lines home */}
          {!loading && !error && showLines && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {lines.map((line, i) => (
                <LineCard
                  key={line.id}
                  line={line}
                  count={countByLine(line.id)}
                  index={i}
                  onClick={() => setSelectedLine(line)}
                />
              ))}
              {noLineCount > 0 && (
                <LineCard
                  line={{ id: '__none__', name: 'Sem linha' }}
                  count={noLineCount}
                  index={lines.length}
                  onClick={() => setSelectedLine({ id: '__none__', name: 'Sem linha' })}
                />
              )}
              {lines.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-10">Nenhuma linha cadastrada</p>
              )}
            </div>
          )}

          {/* Products grid */}
          {!loading && !error && showProducts && (
            <>
              {visibleProducts.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-gray-400">
                  <Search size={32} className="mb-3 opacity-30" />
                  <p className="text-sm">Nenhum produto encontrado</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {visibleProducts.map((product, i) => (
                    <ProductCard key={product.id} product={product} colorIdx={i} onExpand={handleExpand} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Expanded overlay */}
      {expanded && (
        <ExpandedPanel
          product={expanded.product}
          origin={expanded.origin}
          onClose={() => setExpanded(null)}
        />
      )}
    </>
  );
}
