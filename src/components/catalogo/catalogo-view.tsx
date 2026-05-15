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
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = {
  id: string;
  text: string;
  quantity?: number;
  unit?: string;
  imageUrl?: string;
};

type Phase = {
  id: string;
  name: string;
  etapas: Step[];
};

type Product = {
  id: string;
  name: string;
  imageUrl: string | null;
  preparationTime: number | null;
  portionWeight: number | null;
  assemblyInstructions: Phase[];
  qualityStandard: { id: string; text: string }[];
  allergens: { id: string; text: string }[];
  assemblyVideoUrl: string | null;
};

// ─── Palette ──────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m} min`;
}

function fmtWeight(grams: number) {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1).replace('.0', '')} kg`;
  return `${grams} g`;
}

function colorFor(idx: number) {
  return PALETTE[idx % PALETTE.length];
}

// ─── ProductCard ──────────────────────────────────────────────────────────────

function ProductCard({
  product,
  index,
  onExpand,
}: {
  product: Product;
  index: number;
  onExpand: (product: Product, origin: DOMRect) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const color = colorFor(index);
  const hasInstructions = product.assemblyInstructions.length > 0;
  const firstPhase = product.assemblyInstructions[0];
  const previewSteps = firstPhase?.etapas.slice(0, 3) ?? [];

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (cardRef.current) {
        onExpand(product, cardRef.current.getBoundingClientRect());
      }
    },
    [onExpand, product],
  );

  return (
    <div
      ref={cardRef}
      className="relative"
      style={{ perspective: '1200px', height: '280px' }}
    >
      {/* Inner — rotates on flip */}
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
        {/* ── FRONT ─────────────────────────────────── */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow select-none"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {/* Colored top section */}
          <div
            className="relative flex items-center justify-center"
            style={{ background: color.bg, height: '46%' }}
          >
            {/* Decorative blobs */}
            <div
              className="absolute top-2 right-3 rounded-full opacity-30"
              style={{ width: 40, height: 40, background: color.dot }}
            />
            <div
              className="absolute bottom-1 left-4 rounded-full opacity-20"
              style={{ width: 26, height: 26, background: color.dot }}
            />

            {/* Product image or placeholder */}
            <div
              className="relative z-10 rounded-xl overflow-hidden flex items-center justify-center"
              style={{
                width: 72,
                height: 72,
                background: 'white',
                boxShadow: `0 8px 24px ${color.dot}40`,
              }}
            >
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  className="object-cover"
                  sizes="72px"
                />
              ) : (
                <UtensilsCrossed size={32} style={{ color: color.dot }} />
              )}
            </div>
          </div>

          {/* White bottom section */}
          <div className="flex flex-col items-center justify-between px-3 py-3 h-[54%]">
            <p
              className="font-semibold text-center leading-tight text-sm"
              style={{ color: '#1a1a2e' }}
            >
              {product.name}
            </p>

            {/* Meta badges */}
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {product.preparationTime != null && (
                <span
                  className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ background: color.bg, color: color.text }}
                >
                  <Clock size={10} />
                  {fmtTime(product.preparationTime)}
                </span>
              )}
              {product.portionWeight != null && (
                <span
                  className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ background: color.bg, color: color.text }}
                >
                  <Weight size={10} />
                  {fmtWeight(product.portionWeight)}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-400 text-center">
              {hasInstructions ? 'Toque para ver montagem' : 'Sem montagem cadastrada'}
            </p>
          </div>
        </div>

        {/* ── BACK ──────────────────────────────────── */}
        <div
          className="absolute inset-0 rounded-2xl overflow-hidden flex flex-col select-none"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: '#1a1a2e',
          }}
        >
          {/* Header strip */}
          <div
            className="px-3 py-2.5 flex items-center justify-between flex-shrink-0"
            style={{ background: color.dot }}
          >
            <span className="text-white text-xs font-bold uppercase tracking-wider truncate">
              {product.name}
            </span>
            <Layers size={14} className="text-white opacity-80 flex-shrink-0 ml-1" />
          </div>

          {/* Steps preview */}
          <div className="flex-1 overflow-hidden px-3 py-2 space-y-2">
            {!hasInstructions ? (
              <p className="text-gray-400 text-xs text-center mt-6">
                Sem instruções cadastradas
              </p>
            ) : (
              <>
                {firstPhase && (
                  <p className="text-gray-400 text-[10px] uppercase tracking-wide font-medium mb-1">
                    {firstPhase.name}
                  </p>
                )}
                {previewSteps.map((step, i) => (
                  <div key={step.id} className="flex gap-2 items-start">
                    <span
                      className="flex-shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                      style={{
                        width: 18,
                        height: 18,
                        background: color.dot,
                        color: 'white',
                      }}
                    >
                      {i + 1}
                    </span>
                    <p className="text-white text-[11px] leading-snug line-clamp-2">
                      {step.text}
                      {step.quantity && step.unit ? (
                        <span style={{ color: color.bg }}>
                          {' '}
                          ({step.quantity} {step.unit})
                        </span>
                      ) : null}
                    </p>
                  </div>
                ))}
                {firstPhase && firstPhase.etapas.length > 3 && (
                  <p className="text-gray-500 text-[10px] pl-5">
                    +{firstPhase.etapas.length - 3} etapas...
                  </p>
                )}
              </>
            )}
          </div>

          {/* Expand button */}
          <div className="px-3 pb-3 flex-shrink-0">
            <button
              className="w-full py-2 rounded-xl text-xs font-semibold transition-opacity active:opacity-70"
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

function ExpandedPanel({
  product,
  origin,
  onClose,
}: {
  product: Product;
  origin: DOMRect;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'assembly' | 'quality' | 'allergens'>('assembly');
  const [closing, setClosing] = useState(false);
  const color = colorFor(0); // use first color for expanded panel — doesn't need to match

  // Run genie-expand on mount
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const cl = `${((origin.left / vw) * 100).toFixed(1)}%`;
    const ct = `${((origin.top / vh) * 100).toFixed(1)}%`;
    const cr = `${(((vw - origin.right) / vw) * 100).toFixed(1)}%`;
    const cb = `${(((vh - origin.bottom) / vh) * 100).toFixed(1)}%`;

    el.animate(
      [
        {
          clipPath: `inset(${ct} ${cr} ${cb} ${cl} round 16px)`,
          opacity: 0,
        },
        {
          clipPath: `inset(${parseFloat(ct) * 0.3}% ${parseFloat(cr) * 0.3}% 0% ${parseFloat(cl) * 0.3}% round 24px)`,
          opacity: 1,
          offset: 0.35,
        },
        {
          clipPath: 'inset(0% 0% 0% 0% round 0px)',
          opacity: 1,
        },
      ],
      {
        duration: 480,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    );
  }, [origin]);

  const handleClose = useCallback(() => {
    const el = panelRef.current;
    if (!el || closing) return;
    setClosing(true);

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const cl = `${((origin.left / vw) * 100).toFixed(1)}%`;
    const ct = `${((origin.top / vh) * 100).toFixed(1)}%`;
    const cr = `${(((vw - origin.right) / vw) * 100).toFixed(1)}%`;
    const cb = `${(((vh - origin.bottom) / vh) * 100).toFixed(1)}%`;

    el
      .animate(
        [
          { clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 },
          {
            clipPath: `inset(${parseFloat(ct) * 0.3}% ${parseFloat(cr) * 0.3}% 0% ${parseFloat(cl) * 0.3}% round 24px)`,
            opacity: 1,
            offset: 0.65,
          },
          {
            clipPath: `inset(${ct} ${cr} ${cb} ${cl} round 16px)`,
            opacity: 0,
          },
        ],
        {
          duration: 380,
          easing: 'cubic-bezier(0.64, 0, 0.78, 0)',
          fill: 'forwards',
        },
      )
      .finished.then(onClose);
  }, [closing, onClose, origin]);

  const hasAssembly = product.assemblyInstructions.length > 0;
  const hasQuality = product.qualityStandard.length > 0;
  const hasAllergens = product.allergens.length > 0;

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-50 flex flex-col bg-white overflow-hidden"
      style={{ opacity: 0 }} // JS animation takes over
    >
      {/* ── Header ── */}
      <div
        className="relative flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}
      >
        {/* Back button */}
        <button
          onClick={handleClose}
          className="absolute top-4 left-4 z-10 flex items-center gap-1.5 text-white/80 hover:text-white transition-colors"
        >
          <ChevronLeft size={20} />
          <span className="text-sm">Voltar</span>
        </button>

        <div className="pt-14 pb-6 px-6 flex items-end gap-4">
          {/* Product image */}
          <div
            className="relative rounded-2xl overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{
              width: 80,
              height: 80,
              background: 'rgba(255,255,255,0.1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            {product.imageUrl ? (
              <Image
                src={product.imageUrl}
                alt={product.name}
                fill
                className="object-cover"
                sizes="80px"
              />
            ) : (
              <UtensilsCrossed size={36} className="text-white/60" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-xl leading-tight">{product.name}</h2>
            <div className="flex flex-wrap gap-2 mt-2">
              {product.preparationTime != null && (
                <span className="flex items-center gap-1 bg-white/15 text-white text-xs px-2.5 py-1 rounded-full font-medium">
                  <Clock size={11} />
                  {fmtTime(product.preparationTime)}
                </span>
              )}
              {product.portionWeight != null && (
                <span className="flex items-center gap-1 bg-white/15 text-white text-xs px-2.5 py-1 rounded-full font-medium">
                  <Weight size={11} />
                  {fmtWeight(product.portionWeight)}
                </span>
              )}
              {product.assemblyVideoUrl && (
                <a
                  href={product.assemblyVideoUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 bg-red-500 text-white text-xs px-2.5 py-1 rounded-full font-medium"
                >
                  <Play size={10} fill="white" />
                  Vídeo
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-white/10">
          {[
            { key: 'assembly', label: 'Montagem', show: true },
            { key: 'quality', label: 'Qualidade', show: hasQuality },
            { key: 'allergens', label: 'Alérgenos', show: hasAllergens },
          ]
            .filter(t => t.show)
            .map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key as typeof tab)}
                className="flex-1 py-3 text-sm font-medium transition-colors relative"
                style={{ color: tab === t.key ? 'white' : 'rgba(255,255,255,0.45)' }}
              >
                {t.label}
                {tab === t.key && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full"
                    style={{ width: 32, height: 3, background: '#7C3AED' }}
                  />
                )}
              </button>
            ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto" style={{ background: 'hsl(220 20% 97%)' }}>
        {/* Assembly tab */}
        {tab === 'assembly' && (
          <div className="p-4 space-y-4">
            {!hasAssembly ? (
              <div className="flex flex-col items-center py-16 text-gray-400">
                <Layers size={40} className="mb-3 opacity-30" />
                <p className="text-sm">Sem instruções de montagem cadastradas</p>
              </div>
            ) : (
              product.assemblyInstructions.map((phase, pi) => (
                <div key={phase.id} className="bg-white rounded-2xl overflow-hidden shadow-sm">
                  {/* Phase header */}
                  <div
                    className="px-4 py-3 flex items-center gap-2"
                    style={{ background: '#1a1a2e' }}
                  >
                    <span
                      className="text-xs font-bold rounded-full px-2 py-0.5"
                      style={{ background: '#7C3AED', color: 'white' }}
                    >
                      FASE {pi + 1}
                    </span>
                    <span className="text-white font-semibold text-sm">{phase.name}</span>
                  </div>

                  {/* Steps */}
                  <div className="divide-y divide-gray-50">
                    {phase.etapas.map((step, si) => (
                      <div key={step.id} className="flex gap-3 p-4 items-start">
                        {/* Step number */}
                        <div
                          className="flex-shrink-0 rounded-full text-xs font-bold flex items-center justify-center text-white mt-0.5"
                          style={{
                            width: 24,
                            height: 24,
                            background: '#7C3AED',
                            minWidth: 24,
                          }}
                        >
                          {si + 1}
                        </div>

                        {/* Step content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 text-sm leading-relaxed">{step.text}</p>
                          {step.quantity != null && step.unit && (
                            <p className="text-xs text-purple-600 font-medium mt-0.5">
                              {step.quantity} {step.unit}
                            </p>
                          )}
                        </div>

                        {/* Step image */}
                        {step.imageUrl && (
                          <div
                            className="flex-shrink-0 relative rounded-xl overflow-hidden"
                            style={{ width: 64, height: 64 }}
                          >
                            <Image
                              src={step.imageUrl}
                              alt={`Etapa ${si + 1}`}
                              fill
                              className="object-cover"
                              sizes="64px"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Quality tab */}
        {tab === 'quality' && (
          <div className="p-4">
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3" style={{ background: '#1a1a2e' }}>
                <span className="text-white font-semibold text-sm flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-400" />
                  Padrão de Qualidade
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {product.qualityStandard.map((item, i) => (
                  <div key={item.id} className="flex gap-3 p-4 items-start">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">
                      <CheckCircle2 size={16} />
                    </span>
                    <p className="text-gray-800 text-sm">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Allergens tab */}
        {tab === 'allergens' && (
          <div className="p-4">
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3" style={{ background: '#1a1a2e' }}>
                <span className="text-white font-semibold text-sm flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-400" />
                  Alérgenos
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {product.allergens.map(item => (
                  <div key={item.id} className="flex gap-3 p-4 items-start">
                    <span className="text-amber-500 mt-0.5 flex-shrink-0">
                      <AlertCircle size={16} />
                    </span>
                    <p className="text-gray-800 text-sm">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CatalogoView (root) ──────────────────────────────────────────────────────

export function CatalogoView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<{ product: Product; origin: DOMRect } | null>(null);

  useEffect(() => {
    fetch('/api/catalogo')
      .then(r => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data as Product[]);
        } else {
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleExpand = useCallback((product: Product, origin: DOMRect) => {
    setExpanded({ product, origin });
  }, []);

  return (
    <>
      {/* ── Main page ── */}
      <div className="min-h-screen flex flex-col">
        {/* Sticky header */}
        <div
          className="sticky top-0 z-40 flex-shrink-0"
          style={{
            background: 'rgba(248,249,250,0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
          }}
        >
          <div className="px-4 py-4 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h1 className="font-bold text-gray-900" style={{ fontSize: 20 }}>
                Cardápio
              </h1>
              {!loading && !error && (
                <span className="text-xs text-gray-400 font-medium">
                  {filtered.length} produto{filtered.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Search */}
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                placeholder="Buscar produto..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border-none outline-none"
                style={{
                  background: 'white',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  color: '#1a1a2e',
                }}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full">
          {loading && (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl animate-pulse"
                  style={{ height: 280, background: '#e5e7eb' }}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center py-20 text-gray-400">
              <AlertCircle size={40} className="mb-3 opacity-40" />
              <p className="text-sm font-medium">Erro ao carregar produtos</p>
              <button
                className="mt-4 text-xs text-purple-600 font-semibold"
                onClick={() => window.location.reload()}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center py-20 text-gray-400">
              <Search size={36} className="mb-3 opacity-30" />
              <p className="text-sm">Nenhum produto encontrado</p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.map((product, i) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  index={i}
                  onExpand={handleExpand}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Genie expanded overlay ── */}
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
