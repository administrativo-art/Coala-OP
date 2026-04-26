"use client";

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { type ProductSimulation } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';
import { Video, Info, Utensils, Award, Clock, Download, FileText, Check, LayoutDashboard } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FichaTecnicaDocument } from './pdf/FichaTecnicaDocument';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="secondary" disabled><Download className="mr-2 h-4 w-4 animate-spin"/>Carregando...</Button> }
);

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFViewer),
  { ssr: false, loading: () => <div className="h-[400px] flex items-center justify-center bg-muted/20 rounded-lg border-2 border-dashed"><p className="text-muted-foreground">Preparando visualização...</p></div> }
);

interface TechnicalSheetViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  simulation: ProductSimulation | null;
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return isNegative ? `- ${formatted}` : formatted;
};

export function TechnicalSheetViewerModal({ open, onOpenChange, simulation }: TechnicalSheetViewerModalProps) {
    const { simulationItems } = useProductSimulation();
    const { baseProducts } = useBaseProducts();

    const ingredients = useMemo(() => {
        if (!simulation) return [];
        return simulationItems
            .filter(item => item.simulationId === simulation.id)
            .map(item => {
                const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                return {
                    name: baseProduct?.name || 'Insumo não encontrado',
                    quantity: item.quantity,
                    unit: item.overrideUnit || baseProduct?.unit || 'un'
                };
            });
    }, [simulation, simulationItems, baseProducts]);

    const pdfData = useMemo(() => {
        if (!simulation) return null;
        return {
            ...simulation,
            totalCmv: simulation.totalCmv,
            ingredients: ingredients
        };
    }, [simulation, ingredients]);

    if (!simulation || !pdfData) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[1000px] sm:max-w-[1000px] w-[95vw] h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl">
                <div className="px-8 pt-6 pb-2 flex-shrink-0">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-gray-900 tracking-tight">{simulation.name}</DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground">Ficha Técnica de Instrução</DialogDescription>
                    </DialogHeader>
                </div>
                <ScrollArea className="flex-1 px-8">
                    <div className="space-y-8 py-6">
                        {simulation.ppo?.referenceImageUrl ? (
                            <div className="rounded-2xl overflow-hidden border shadow-sm bg-white aspect-video relative">
                                <img 
                                    src={simulation.ppo.referenceImageUrl} 
                                    alt={simulation.name}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
                                    <div className="text-white">
                                        <p className="text-xs font-bold uppercase tracking-wider opacity-80">Foto de Referência</p>
                                        <h2 className="text-xl font-black">{simulation.name}</h2>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-2xl border-2 border-dashed border-gray-200 h-48 flex flex-col items-center justify-center bg-gray-50 text-gray-400">
                                <Utensils className="h-8 w-8 mb-2 opacity-20" />
                                <p className="text-sm font-medium">Sem foto de referência</p>
                            </div>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-4 border rounded-xl bg-white shadow-sm flex flex-col items-center justify-center gap-1">
                                <Clock className="h-5 w-5 text-blue-500" />
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Tempo de Montagem</p>
                                <p className="text-sm font-black text-gray-900">{simulation.ppo?.preparationTime || 0}s</p>
                            </div>
                            <div className="p-4 border rounded-xl bg-white shadow-sm flex flex-col items-center justify-center gap-1">
                                <Utensils className="h-5 w-5 text-pink-500" />
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Peso</p>
                                <p className="text-sm font-black text-gray-900">{simulation.ppo?.portionWeight || 0}g</p>
                            </div>
                            <div className="p-4 border rounded-xl bg-white shadow-sm flex flex-col items-center justify-center gap-1">
                                <Award className="h-5 w-5 text-orange-500" />
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Tolerância</p>
                                <p className="text-sm font-black text-gray-900">±{simulation.ppo?.portionTolerance || 0}g</p>
                            </div>
                            <div className="p-4 border rounded-xl bg-orange-50/50 border-orange-100 flex flex-col items-center justify-center gap-1">
                                <Info className="h-5 w-5 text-orange-600" />
                                <p className="text-[10px] font-bold text-orange-700 uppercase">Alergênicos</p>
                                <p className="text-[10px] font-bold text-orange-900 text-center leading-tight">
                                    {simulation.ppo?.allergens && simulation.ppo.allergens.length > 0 
                                        ? simulation.ppo.allergens.map((a: any) => typeof a === 'string' ? a : a.text).join(', ')
                                        : 'Nenhum'}
                                </p>
                            </div>
                        </div>

                        {/* MODO DE MONTAGEM - ELEMENTO CENTRAL */}
                        {simulation.ppo?.assemblyInstructions && simulation.ppo.assemblyInstructions.length > 0 ? (
                            <div className="space-y-6">
                                <div className="flex items-center justify-between border-b-2 border-blue-500 pb-2">
                                    <h3 className="font-black text-gray-900 text-xl flex items-center gap-2">
                                        <LayoutDashboard className="h-6 w-6 text-blue-600" />
                                        PASSO A PASSO DE MONTAGEM
                                    </h3>
                                    <Badge className="bg-blue-600 text-white font-bold px-3 py-1">OPERACIONAL</Badge>
                                </div>
                                
                                <div className="space-y-8">
                                    {simulation.ppo.assemblyInstructions.map(phase => (
                                        <div key={phase.id} className="space-y-6">
                                            <div className="bg-blue-50 px-4 py-2 rounded-lg inline-block">
                                                <h4 className="font-black text-blue-700 text-sm uppercase tracking-widest">{phase.name}</h4>
                                            </div>
                                            
                                            <div className="grid gap-6">
                                                {phase.etapas.map((etapa, index) => (
                                                    <div key={etapa.id} className="flex gap-8 items-start bg-white p-6 rounded-3xl border-2 border-gray-50 shadow-sm hover:border-blue-100 transition-colors">
                                                        <div className="flex-shrink-0 w-14 h-14 flex items-center justify-center rounded-2xl bg-blue-600 text-white font-black text-2xl shadow-lg shadow-blue-200">
                                                            {index + 1}
                                                        </div>
                                                        <div className="flex-1 space-y-4">
                                                            <div className="flex justify-between items-start gap-6">
                                                                <p className="text-lg text-gray-800 font-bold leading-tight">{etapa.text}</p>
                                                                {etapa.imageUrl && (
                                                                    <div className="flex-shrink-0 border-4 border-white rounded-2xl overflow-hidden shadow-xl rotate-1">
                                                                        <img src={etapa.imageUrl} alt={`Etapa ${index + 1}`} className="w-32 h-32 object-cover" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {etapa.quantity && etapa.unit && (
                                                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-black text-xs uppercase">
                                                                    <Utensils className="h-3 w-3" />
                                                                    Usar: {etapa.quantity} {etapa.unit}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="p-12 border-4 border-dashed border-gray-100 rounded-3xl text-center space-y-4">
                                <LayoutDashboard className="h-12 w-12 text-gray-200 mx-auto" />
                                <p className="text-gray-400 font-bold">Nenhuma instrução de montagem cadastrada para esta mercadoria.</p>
                            </div>
                        )}

                        {/* VÍDEO TUTORIAL */}
                        {simulation.ppo?.assemblyVideoUrl && (
                            <div className="p-6 border-4 border-blue-50 rounded-3xl bg-blue-50/30 flex items-center justify-between">
                                <div className="flex items-center gap-5">
                                    <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl">
                                        <Video className="h-7 w-7" />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-blue-900 text-lg">VÍDEO DE MONTAGEM</h4>
                                        <p className="text-sm text-blue-600 font-bold">Assista ao processo real em vídeo</p>
                                    </div>
                                </div>
                                <Button className="bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl px-8 h-12 shadow-lg shadow-blue-200" asChild>
                                    <a href={simulation.ppo.assemblyVideoUrl} target="_blank" rel="noopener noreferrer">
                                        ABRIR VÍDEO
                                    </a>
                                </Button>
                            </div>
                        )}

                        {/* INGREDIENTES - ABAIXO DA MONTAGEM */}
                        <div className="bg-gray-50 p-8 rounded-3xl space-y-6">
                            <h3 className="font-black text-gray-800 text-sm uppercase tracking-widest flex items-center gap-2">
                                <FileText className="h-4 w-4 text-gray-400" /> 
                                Checklist de Ingredientes
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {ingredients.map(ing => (
                                    <div key={ing.name} className="bg-white p-4 rounded-2xl border flex justify-between items-center shadow-sm">
                                        <span className="font-bold text-gray-700">{ing.name}</span>
                                        <Badge variant="outline" className="font-black text-blue-600 border-blue-100 bg-blue-50">
                                            {ing.quantity} {ing.unit}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
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
                                <Download className="mr-2 h-4 w-4"/>
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