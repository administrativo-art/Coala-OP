"use client";

import Image from 'next/image';
import { AlertCircle, Award, CheckCircle2, Clock, FileText, Layers, UtensilsCrossed, Video, Weight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SheetStep = { id: string; text: string; quantity?: number; unit?: string; imageUrl?: string };
export type SheetPhase = { id: string; name: string; etapas: SheetStep[] };
export type SheetData = {
  name: string;
  imageUrl: string | null;
  preparationTime: number | null;
  portionWeight: number | null;
  portionTolerance: number | null;
  assemblyInstructions: SheetPhase[];
  qualityStandard: { id: string; text: string }[];
  allergens: { id: string; text: string }[];
  assemblyVideoUrl: string | null;
  ingredients: { name: string; quantity: number; unit: string }[];
};

export const sheetKicker = 'text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint';

export function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

export function fmtWeight(g: number) {
  return g >= 1000 ? `${(g / 1000).toFixed(1).replace('.0', '')} kg` : `${g} g`;
}

export function getEmbedUrl(url: string): { type: 'iframe' | 'video'; src: string } | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return { type: 'video', src: url };
  return null;
}

export function SheetThumb({ imageUrl, name, className, sizes }: { imageUrl: string | null; name: string; className?: string; sizes: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-ds-muted', className)}>
      {imageUrl ? (
        <Image src={imageUrl} alt={name} fill className="object-contain p-2" sizes={sizes} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ds-ink-faint">
          <UtensilsCrossed aria-hidden="true" size={32} />
        </div>
      )}
    </div>
  );
}

export function SectionCard({ title, icon: Icon, children }: { title: string; icon: typeof FileText; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
      <header className="flex items-center gap-2 bg-ds-dark px-4 py-3 text-ds-on-dark">
        <Icon aria-hidden="true" size={14} className="text-ds-accent-kicker" />
        <h3 className="text-[13px] font-extrabold">{title}</h3>
      </header>
      {children}
    </section>
  );
}

/** Conteúdo da ficha de instrução: lateral com foto e métricas, principal com montagem, qualidade, ingredientes e vídeo. */
export function SheetContent({ product, className }: { product: SheetData; className?: string }) {
  const allergenText = product.allergens.length > 0 ? product.allergens.map(a => a.text).join(', ') : 'Nenhum';
  const embed = product.assemblyVideoUrl ? getEmbedUrl(product.assemblyVideoUrl) : null;
  const metrics = [
    { icon: Clock, label: 'Tempo', value: product.preparationTime ? fmtTime(product.preparationTime) : '—' },
    { icon: Weight, label: 'Peso', value: product.portionWeight ? fmtWeight(product.portionWeight) : '—' },
    { icon: Award, label: 'Tolerância', value: product.portionTolerance ? `±${product.portionTolerance} g` : '—' },
  ];
  return (
    <div className={cn('md:grid md:items-start md:gap-6', className)} style={{ gridTemplateColumns: '320px 1fr' }}>
        <aside className="mb-6 space-y-3 md:sticky md:top-20 md:mb-0">
          <SheetThumb imageUrl={product.imageUrl} name={product.name} className="aspect-[4/3] w-full rounded-ds-card border border-ds-border" sizes="320px" />
          <div className="grid grid-cols-3 gap-2">
            {metrics.map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-ds-md border border-ds-border bg-ds-surface p-3">
                <Icon aria-hidden="true" size={14} className="text-ds-accent-ink" />
                <p className={cn(sheetKicker, 'mt-1.5')}>{label}</p>
                <p className="text-[15px] font-extrabold text-ds-ink">{value}</p>
              </div>
            ))}
          </div>
          <div className="rounded-ds-md border border-ds-alert-border bg-ds-alert-bg p-3 text-ds-alert-ink">
            <p className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em]"><AlertCircle aria-hidden="true" size={12} />Alergênicos</p>
            <p className="mt-1 text-[13px] font-bold">{allergenText}</p>
          </div>
          <SectionCard title="Tabela nutricional" icon={FileText}>
            <p className="px-4 py-5 text-center text-[13px] font-semibold text-ds-ink-faint">Em breve</p>
          </SectionCard>
        </aside>

        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="border-b-2 border-ds-accent pb-2 text-[16px] font-extrabold text-ds-ink">Passo a passo de montagem</h3>
            {product.assemblyInstructions.length === 0 ? (
              <div className="rounded-ds-card border border-dashed border-ds-border-input px-4 py-10 text-center text-ds-ink-faint">
                <Layers aria-hidden="true" size={26} className="mx-auto mb-2" />
                <p className="text-[13px] font-semibold">Sem instruções cadastradas</p>
              </div>
            ) : (
              product.assemblyInstructions.map(phase => (
                <div key={phase.id} className="space-y-2">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">{phase.name}</p>
                  {phase.etapas.map((step, si) => (
                    <div key={step.id} className="flex items-start gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-sm bg-ds-dark text-[14px] font-extrabold text-white">{si + 1}</div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-[14px] font-semibold leading-snug text-ds-ink">{step.text}</p>
                        {step.quantity && step.unit && (
                          <span className="inline-flex h-[21px] items-center rounded-ds-pill bg-ds-neutral-bg px-[9px] text-[11.5px] font-bold text-ds-neutral">{step.quantity} {step.unit}</span>
                        )}
                      </div>
                      {step.imageUrl && (
                        <div className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-ds-md border border-ds-border">
                          <Image src={step.imageUrl} alt={`Etapa ${si + 1}`} fill className="object-cover" sizes="68px" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>

          {product.qualityStandard.length > 0 && (
            <SectionCard title="Padrão de qualidade" icon={CheckCircle2}>
              <ul className="divide-y divide-ds-divider">
                {product.qualityStandard.map(item => (
                  <li key={item.id} className="flex items-start gap-3 p-3">
                    <CheckCircle2 aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-ds-ok" />
                    <p className="text-[13.5px] font-semibold text-ds-ink">{item.text}</p>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {product.ingredients.length > 0 && (
            <SectionCard title="Checklist de ingredientes" icon={FileText}>
              <ul className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
                {product.ingredients.map(ing => (
                  <li key={ing.name} className="flex items-center justify-between gap-2 rounded-ds-md bg-ds-muted px-3 py-2">
                    <span className="truncate text-[13px] font-bold text-ds-ink">{ing.name}</span>
                    <span className="shrink-0 font-ds-mono text-[12px] font-bold text-ds-accent-ink">{ing.quantity} {ing.unit}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {product.assemblyVideoUrl && (embed ? (
            <section className="space-y-1.5">
              <p className={cn(sheetKicker, 'flex items-center gap-1.5')}><Video aria-hidden="true" size={11} />Vídeo de montagem</p>
              <div className="aspect-video w-full overflow-hidden rounded-ds-card border border-ds-border bg-ds-dark">
                {embed.type === 'iframe' ? (
                  <iframe title="Vídeo de montagem" src={embed.src} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                ) : (
                  <video src={embed.src} controls className="h-full w-full bg-black" />
                )}
              </div>
            </section>
          ) : (
            <a href={product.assemblyVideoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-3 hover:bg-ds-muted">
              <span className="flex h-9 w-9 items-center justify-center rounded-ds-sm bg-ds-dark text-white"><Video aria-hidden="true" size={16} /></span>
              <span>
                <span className="block text-[13px] font-extrabold text-ds-ink">Vídeo de montagem</span>
                <span className="block text-[12px] font-semibold text-ds-accent-ink">Abrir link externo</span>
              </span>
            </a>
          ))}
        </div>
    </div>
  );
}
