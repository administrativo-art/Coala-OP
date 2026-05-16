"use client";

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { type ProductSimulation } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import {
  Clock, Weight, AlertCircle, CheckCircle2, UtensilsCrossed,
  Layers, FileText, Award, Video, LayoutDashboard, Download,
} from 'lucide-react';
import { FichaTecnicaDocument } from './pdf/FichaTecnicaDocument';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="secondary" disabled><Download className="mr-2 h-4 w-4 animate-spin" />Carregando...</Button> }
);

interface TechnicalSheetViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

function fmtWeight(g: number) {
  return g >= 1000 ? `${(g / 1000).toFixed(1)}kg` : `${g}g`;
}

function getEmbedUrl(url: string): { type: 'iframe' | 'video'; src: string } | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { type: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return { type: 'video', src: url };
  return null;
}

export function TechnicalSheetViewerModal({ open, onOpenChange, simulation }: TechnicalSheetViewerModalProps) {
  const { simulationItems } = useProductSimulation();
  const { baseProducts } = useBaseProducts();

  const ingredients = useMemo(() => {
    if (!simulation) return [];
    return simulationItems
      .filter(item => item.simulationId === simulation.id)
      .map(item => {
        const bp = baseProducts.find(b => b.id === item.baseProductId);
        return {
          name: bp?.name || 'Insumo não encontrado',
          quantity: item.quantity,
          unit: item.overrideUnit || bp?.unit || 'un',
        };
      });
  }, [simulation, simulationItems, baseProducts]);

  const pdfData = useMemo(() => {
    if (!simulation) return null;
    return { ...simulation, totalCmv: simulation.totalCmv, ingredients };
  }, [simulation, ingredients]);

  if (!simulation || !pdfData) return null;

  const allergens: { id: string; text: string }[] = Array.isArray(simulation.ppo?.allergens)
    ? simulation.ppo.allergens.map((a: any) => typeof a === 'string' ? { id: a, text: a } : a)
    : [];
  const allergenText = allergens.length > 0 ? allergens.map(a => a.text).join(', ') : 'Nenhum';

  const qualityStandard: { id: string; text: string }[] = Array.isArray(simulation.ppo?.qualityStandard)
    ? simulation.ppo.qualityStandard.filter((q: any) => typeof q === 'object' && q.text)
    : [];

  const assemblyInstructions: any[] = simulation.ppo?.assemblyInstructions ?? [];
  const videoUrl: string | null = simulation.ppo?.assemblyVideoUrl || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1000px] sm:max-w-[1000px] w-[95vw] h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl">
        <div className="px-8 pt-6 pb-2 flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-gray-900 tracking-tight">{simulation.name}</DialogTitle>
            <DialogDescription>Ficha Técnica de Instrução</DialogDescription>
          </DialogHeader>
        </div>

        <ScrollArea className="flex-1">
          <div
            className="px-8 pb-8 md:grid md:gap-8 md:items-start"
            style={{ gridTemplateColumns: '280px 1fr' }}
          >
            {/* LEFT — photo + metrics + nutritional */}
            <div className="space-y-3 mb-6 md:mb-0 pt-2">
              {simulation.ppo?.referenceImageUrl ? (
                <div className="rounded-2xl overflow-hidden relative shadow-md" style={{ aspectRatio: '3/4' }}>
                  <Image
                    src={simulation.ppo.referenceImageUrl}
                    alt={simulation.name}
                    fill
                    className="object-cover"
                    sizes="280px"
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 p-4"
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 70%)' }}
                  >
                    <p className="text-white/70 text-[9px] font-bold uppercase tracking-widest">Foto de Referência</p>
                    <h2 className="text-white font-black text-lg leading-tight">{simulation.name}</h2>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center bg-gray-50 text-gray-400"
                  style={{ aspectRatio: '3/4' }}
                >
                  <UtensilsCrossed size={36} className="mb-2 opacity-20" />
                  <p className="text-sm font-medium text-center px-4">{simulation.name}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100">
                  <Clock size={16} className="text-blue-500" />
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide text-center">Tempo</p>
                  <p className="text-sm font-black text-gray-900">
                    {simulation.ppo?.preparationTime ? fmtTime(simulation.ppo.preparationTime) : '—'}
                  </p>
                </div>
                <div className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100">
                  <Weight size={16} className="text-pink-500" />
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide text-center">Peso</p>
                  <p className="text-sm font-black text-gray-900">
                    {simulation.ppo?.portionWeight ? fmtWeight(simulation.ppo.portionWeight) : '—'}
                  </p>
                </div>
                <div className="bg-white rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-gray-100">
                  <Award size={16} className="text-orange-500" />
                  <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wide text-center">Tolerância</p>
                  <p className="text-sm font-black text-gray-900">
                    {simulation.ppo?.portionTolerance ? `±${simulation.ppo.portionTolerance}g` : '—'}
                  </p>
                </div>
                <div className="bg-orange-50 rounded-xl p-3 flex flex-col items-center gap-1 shadow-sm border border-orange-100">
                  <AlertCircle size={16} className="text-orange-500" />
                  <p className="text-[8px] font-bold text-orange-700 uppercase tracking-wide text-center">Alergênicos</p>
                  <p className="text-[10px] font-bold text-orange-900 text-center leading-tight">{allergenText}</p>
                </div>
              </div>

              {/* Nutritional placeholder */}
              <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
                <div className="px-4 py-3 flex items-center gap-2" style={{ background: '#1a1a2e' }}>
                  <FileText size={13} className="text-gray-300" />
                  <span className="text-white font-semibold text-sm">Tabela Nutricional</span>
                </div>
                <div className="px-4 py-6 flex flex-col items-center justify-center gap-2">
                  <FileText size={28} className="opacity-20 text-gray-300" />
                  <p className="text-xs text-center text-gray-400">Em breve</p>
                </div>
              </div>
            </div>

            {/* RIGHT — assembly + quality + ingredients + video */}
            <div className="space-y-5 pt-2">

              {/* Assembly */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b-2 border-blue-500 pb-2">
                  <LayoutDashboard size={17} className="text-blue-600" />
                  <h3 className="font-black text-gray-900 text-base">Passo a Passo de Montagem</h3>
                </div>
                {assemblyInstructions.length === 0 ? (
                  <div className="py-10 border-2 border-dashed border-gray-100 rounded-2xl text-center text-gray-400">
                    <Layers size={28} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm">Sem instruções cadastradas</p>
                  </div>
                ) : (
                  assemblyInstructions.map((phase: any) => (
                    <div key={phase.id} className="space-y-2">
                      <div className="bg-blue-50 px-3 py-1.5 rounded-lg inline-block">
                        <p className="font-black text-blue-700 text-xs uppercase tracking-widest">{phase.name}</p>
                      </div>
                      <div className="space-y-2">
                        {phase.etapas.map((step: any, si: number) => (
                          <div key={step.id} className="flex gap-3 items-start bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                            <div
                              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-white font-black text-base shadow-md"
                              style={{ background: '#2563EB' }}
                            >
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
                              <div
                                className="flex-shrink-0 relative rounded-xl overflow-hidden border-2 border-white shadow-md"
                                style={{ width: 68, height: 68 }}
                              >
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
              {qualityStandard.length > 0 && (
                <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                  <div className="px-4 py-3 flex items-center gap-2" style={{ background: '#1a1a2e' }}>
                    <CheckCircle2 size={14} className="text-green-400" />
                    <span className="text-white font-semibold text-sm">Padrão de Qualidade</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {qualityStandard.map(item => (
                      <div key={item.id} className="flex gap-3 p-3 items-start">
                        <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                        <p className="text-gray-800 text-sm">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ingredients */}
              {ingredients.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={{ background: '#F9FAFB' }}>
                  <div className="px-4 py-3 flex items-center gap-2">
                    <FileText size={13} className="text-gray-400" />
                    <span className="font-black text-gray-700 text-xs uppercase tracking-widest">Checklist de Ingredientes</span>
                  </div>
                  <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ingredients.map(ing => (
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
              {videoUrl && (() => {
                const embed = getEmbedUrl(videoUrl);
                if (!embed) return (
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background: '#EFF6FF', border: '2px solid #BFDBFE', textDecoration: 'none' }}
                  >
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
        </ScrollArea>

        <DialogFooter className="px-8 py-4 border-t flex justify-between w-full bg-gray-50 flex-shrink-0">
          <PDFDownloadLink
            document={<FichaTecnicaDocument data={pdfData} />}
            fileName={`ficha_tecnica_${simulation.name.replace(/ /g, '_')}.pdf`}
          >
            {((props: any) => (
              <Button variant="secondary" disabled={props.loading}>
                <Download className="mr-2 h-4 w-4" />
                {props.loading ? 'Gerando...' : 'Baixar PDF'}
              </Button>
            )) as any}
          </PDFDownloadLink>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
