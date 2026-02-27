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
import { Video, Info, Utensils, Award, Clock, Download, FileText } from 'lucide-react';
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
            grossCost: simulation.totalCmv,
            ingredients: ingredients
        };
    }, [simulation, ingredients]);

    if (!simulation || !pdfData) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{simulation.name}</DialogTitle>
                    <DialogDescription>Ficha Técnica de Produção</DialogDescription>
                </DialogHeader>
                <ScrollArea className="flex-1 pr-6 -mr-6">
                    <div className="space-y-6 py-4">
                        <div className="rounded-lg overflow-hidden border-2 border-primary/10 shadow-sm">
                            <PDFViewer style={{ width: '100%', height: '400px' }} showToolbar={false}>
                                <FichaTecnicaDocument data={pdfData} />
                            </PDFViewer>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="p-3 border rounded-lg bg-card">
                                <p className="text-xs text-muted-foreground">Preço Venda</p>
                                <p className="text-lg font-bold">{formatCurrency(simulation.salePrice)}</p>
                            </div>
                            <div className="p-3 border rounded-lg bg-card">
                                <p className="text-xs text-muted-foreground">Custo Bruto</p>
                                <p className="text-lg font-bold">{formatCurrency(simulation.totalCmv)}</p>
                            </div>
                            <div className="p-3 border rounded-lg bg-card">
                                <p className="text-xs text-muted-foreground">Lucro %</p>
                                <p className="text-lg font-bold">{simulation.profitPercentage.toFixed(2)}%</p>
                            </div>
                            <div className="p-3 border rounded-lg bg-card">
                                <p className="text-xs text-muted-foreground">Markup</p>
                                <p className="text-lg font-bold">{simulation.markup.toFixed(1)}x</p>
                            </div>
                        </div>
                        
                        <div>
                            <h3 className="font-semibold text-lg mb-2 flex items-center gap-2"><FileText className="h-5 w-5" /> Composição detalhada</h3>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Ingrediente</TableHead>
                                        <TableHead className="text-right">Quantidade</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ingredients.map(ing => (
                                        <TableRow key={ing.name}>
                                            <TableCell className="font-medium">{ing.name}</TableCell>
                                            <TableCell className="text-right">{ing.quantity} {ing.unit}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        
                        {simulation.ppo?.assemblyInstructions && simulation.ppo.assemblyInstructions.length > 0 && (
                            <div className="p-4 border rounded-lg bg-muted/30">
                                <h3 className="font-semibold text-lg mb-4">Modo de Montagem</h3>
                                <div className="space-y-6">
                                {simulation.ppo.assemblyInstructions.map(phase => (
                                    <div key={phase.id} className="space-y-3">
                                        <h4 className="font-bold text-primary border-b pb-1">{phase.name}</h4>
                                        <ol className="space-y-4">
                                            {phase.etapas.map((etapa, index) => (
                                                <li key={etapa.id} className="grid grid-cols-[auto_1fr_auto] gap-4 items-start">
                                                    <span className="font-bold text-primary pt-1">{index + 1}.</span>
                                                    <div>
                                                        <p className="font-medium">{etapa.text}</p>
                                                        {etapa.quantity && etapa.unit && <span className="text-muted-foreground text-sm"> ({etapa.quantity} {etapa.unit})</span>}
                                                    </div>
                                                    {etapa.imageUrl && <Image src={etapa.imageUrl} alt={`Etapa: ${etapa.text}`} width={80} height={80} className="rounded-md object-cover shadow-sm" />}
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                ))}
                                </div>
                            </div>
                        )}
                        
                         {simulation.ppo?.assemblyVideoUrl && (
                            <div className="p-4 border rounded-lg bg-blue-500/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <Video className="text-primary h-6 w-6" />
                                    <div>
                                        <h4 className="font-semibold">Vídeo de Montagem</h4>
                                        <p className="text-sm text-muted-foreground">Assista ao tutorial passo a passo.</p>
                                    </div>
                                </div>
                                <Button variant="link" asChild>
                                    <a href={simulation.ppo.assemblyVideoUrl} target="_blank" rel="noopener noreferrer">
                                        Abrir vídeo
                                    </a>
                                </Button>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {simulation.ppo?.preparationTime && (
                                <div className="p-4 border rounded-lg bg-card flex items-center gap-3">
                                    <Clock className="h-6 w-6 text-primary" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Tempo de Preparo</p>
                                        <p className="font-bold">{simulation.ppo.preparationTime} segundos</p>
                                    </div>
                                </div>
                            )}
                            {simulation.ppo?.portionWeight && (
                                <div className="p-4 border rounded-lg bg-card flex items-center gap-3">
                                    <Utensils className="h-6 w-6 text-primary" />
                                    <div>
                                        <p className="text-xs text-muted-foreground">Peso da Porção</p>
                                        <p className="font-bold">{simulation.ppo.portionWeight}g <span className="font-normal text-muted-foreground">(±{simulation.ppo.portionTolerance || 0}g)</span></p>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {(simulation.ppo?.qualityStandard?.length || (simulation.ppo?.allergens && simulation.ppo?.allergens.length > 0)) && (
                            <div className="p-4 border rounded-lg space-y-4 bg-muted/30">
                                {simulation.ppo.qualityStandard && simulation.ppo.qualityStandard.length > 0 && (
                                    <div>
                                        <h4 className="font-semibold flex items-center gap-2 mb-2"><Award className="h-4 w-4 text-primary" />Padrão de Qualidade</h4>
                                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                            {simulation.ppo.qualityStandard.map(item => (
                                                <li key={item.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Check className="h-3 w-3 text-green-600" /> {item.text}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                 {simulation.ppo.allergens && simulation.ppo.allergens.length > 0 && (
                                    <div className="pt-2 border-t border-muted">
                                        <h4 className="font-semibold flex items-center gap-2 mb-1"><Info className="h-4 w-4 text-primary" /> Alergênicos</h4>
                                        <p className="text-sm text-muted-foreground">{simulation.ppo.allergens.map(a => a.text).join(', ')}</p>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>
                </ScrollArea>
                <DialogFooter className="pt-4 border-t flex justify-between w-full">
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