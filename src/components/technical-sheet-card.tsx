
"use client";

import { useMemo } from 'react';
import { type ProductSimulation, type SimulationCategory, type ProductSimulationItem } from '@/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Card, CardHeader } from './ui/card';
import { Badge } from './ui/badge';
import Image from 'next/image';
import { Button } from './ui/button';
import { Edit, Download, FileText, Video, Camera, Info } from 'lucide-react';
import { useProductSimulation } from '@/hooks/use-product-simulation';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProductSimulationCategories } from '@/hooks/use-product-simulation-categories';
import { Separator } from './ui/separator';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from './ui/table';

interface TechnicalSheetCardProps {
    simulation: ProductSimulation;
}

export function TechnicalSheetCard({ simulation }: TechnicalSheetCardProps) {
    const { simulationItems } = useProductSimulation();
    const { baseProducts } = useBaseProducts();
    const { categories } = useProductSimulationCategories();

    const simCategories = useMemo(() => 
        (simulation.categoryIds || []).map(id => categories.find(c => c.id === id)).filter((c): c is SimulationCategory => !!c),
    [simulation.categoryIds, categories]);

    const simLine = useMemo(() => 
        simulation.lineId ? categories.find(c => c.id === simulation.lineId) : null,
    [simulation.lineId, categories]);

    const ingredients = useMemo(() => 
        simulationItems
            .filter(item => item.simulationId === simulation.id)
            .map(item => {
                const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
                return {
                    name: baseProduct?.name || 'Insumo não encontrado',
                    quantity: item.quantity,
                    unit: item.overrideUnit || baseProduct?.unit || 'un'
                };
            }),
    [simulation.id, simulationItems, baseProducts]);

    const handleExportPdf = () => {
        const doc = new jsPDF();
        let yPos = 15;
    
        const addTitle = (title: string) => {
            if (yPos > 260) { doc.addPage(); yPos = 15; }
            doc.setFontSize(18);
            doc.text(title, 14, yPos);
            yPos += 8;
        };

        addTitle(simulation.name);
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`SKU: ${simulation.ppo?.sku || 'N/A'}`, 14, yPos);
        yPos += 10;
        
        const imageSize = 40;
        const hasImage = simulation.ppo?.referenceImageUrl;
        if (hasImage) {
            try {
                doc.addImage(simulation.ppo!.referenceImageUrl!, 'JPEG', 14, yPos, imageSize, imageSize);
                yPos += imageSize + 5;
            } catch (e) {
                console.error("Failed to add image to PDF", e);
            }
        }
    
        const addSection = (title: string) => {
             if (yPos > 260) { doc.addPage(); yPos = 15; }
             doc.setFontSize(12);
             doc.setFont(undefined, 'bold');
             doc.text(title, 14, yPos);
             yPos += 6;
             doc.setFont(undefined, 'normal');
        };

        addSection('Composição (Ingredientes)');
        autoTable(doc, {
            startY: yPos,
            head: [['Ingrediente', 'Quantidade']],
            body: ingredients.map(i => [i.name, `${i.quantity} ${i.unit}`]),
            theme: 'striped',
        });
        yPos = (doc as any).lastAutoTable.finalY + 10;

        if (simulation.ppo?.assemblyInstructions && simulation.ppo.assemblyInstructions.length > 0) {
            addSection('Modo de Montagem');
            simulation.ppo.assemblyInstructions.forEach((step, index) => {
                 if (yPos > 270) { doc.addPage(); yPos = 15; }
                doc.text(`${index + 1}. ${step.text}`, 14, yPos, { maxWidth: 180 });
                yPos += doc.getTextDimensions(`${index + 1}. ${step.text}`, { maxWidth: 180 }).h + 4;
            });
            yPos += 5;
        }
        
        const details = [
            { label: 'Padrão de Qualidade', value: simulation.ppo?.qualityStandard },
            { label: 'Tempo de Preparo', value: simulation.ppo?.preparationTime ? `${simulation.ppo.preparationTime} segundos` : null },
            { label: 'Peso da Porção', value: simulation.ppo?.portionWeight ? `${simulation.ppo.portionWeight}g (±${simulation.ppo.portionTolerance || 0}g)` : null },
            { label: 'Alergênicos', value: simulation.ppo?.allergens?.map(a => a.text).join(', ') },
            { label: 'Link do Vídeo', value: simulation.ppo?.assemblyVideoUrl },
            { label: 'NCM', value: simulation.ppo?.ncm },
            { label: 'CEST', value: simulation.ppo?.cest },
            { label: 'CFOP', value: simulation.ppo?.cfop },
        ].filter(d => d.value);

        if (details.length > 0) {
            addSection('Detalhes Adicionais');
            autoTable(doc, {
                startY: yPos,
                body: details.map(d => [d.label, d.value!]),
                theme: 'plain',
                styles: { cellPadding: 2 },
                columnStyles: { 0: { fontStyle: 'bold' } },
            });
        }
    
        doc.save(`ficha_tecnica_${simulation.name.replace(/ /g, '_')}.pdf`);
    };

    return (
        <Accordion type="single" collapsible>
            <AccordionItem value={simulation.id} className="border-b-0">
                <Card>
                    <AccordionTrigger className="p-4 hover:no-underline [&[data-state=open]]:border-b">
                        <div className="flex items-center gap-4 text-left">
                            {simulation.ppo?.referenceImageUrl ? (
                                <Image src={simulation.ppo.referenceImageUrl} alt={simulation.name} width={64} height={64} className="rounded-md object-cover" />
                            ) : (
                                <div className="h-16 w-16 rounded-md bg-muted flex items-center justify-center shrink-0">
                                    <FileText className="h-8 w-8 text-muted-foreground" />
                                </div>
                            )}
                            <div>
                                <h3 className="font-semibold text-lg">{simulation.name}</h3>
                                <p className="text-sm text-muted-foreground">SKU: {simulation.ppo?.sku || 'N/A'}</p>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                    {simCategories.map(cat => (
                                        <Badge key={cat.id} style={{ backgroundColor: cat.color, color: 'white' }}>{cat.name}</Badge>
                                    ))}
                                    {simLine && <Badge variant="outline">{simLine.name}</Badge>}
                                </div>
                            </div>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 pt-0">
                        <div className="space-y-4">
                            <Separator />
                            <div className="flex justify-end">
                                <Button size="sm" variant="outline" onClick={handleExportPdf}><Download className="mr-2 h-4 w-4" /> Exportar PDF</Button>
                            </div>
                            
                            <h4 className="font-semibold">Composição</h4>
                            <Table>
                                <TableHeader><TableRow><TableHead>Ingrediente</TableHead><TableHead className="text-right">Quantidade</TableHead></TableRow></TableHeader>
                                <TableBody>
                                    {ingredients.map(ing => (
                                        <TableRow key={ing.name}><TableCell>{ing.name}</TableCell><TableCell className="text-right">{ing.quantity} {ing.unit}</TableCell></TableRow>
                                    ))}
                                </TableBody>
                            </Table>

                            {simulation.ppo?.assemblyInstructions && simulation.ppo.assemblyInstructions.length > 0 && (
                                <>
                                 <Separator />
                                 <h4 className="font-semibold">Modo de Montagem</h4>
                                 <ol className="list-decimal list-inside space-y-1 text-sm">
                                    {simulation.ppo.assemblyInstructions.map(step => <li key={step.id}>{step.text}</li>)}
                                 </ol>
                                </>
                            )}
                            
                            <Separator />
                            <h4 className="font-semibold">Parâmetros e Informações</h4>
                            <div className="text-sm space-y-1 text-muted-foreground">
                                {simulation.ppo?.preparationTime && <p><strong>Tempo de Preparo:</strong> {simulation.ppo.preparationTime} segundos</p>}
                                {simulation.ppo?.portionWeight && <p><strong>Peso da Porção:</strong> {simulation.ppo.portionWeight}g (±{simulation.ppo.portionTolerance || 0}g)</p>}
                                {simulation.ppo?.qualityStandard && <p><strong>Padrão de Qualidade:</strong> {simulation.ppo.qualityStandard}</p>}
                                {simulation.ppo?.allergens && simulation.ppo.allergens.length > 0 && <p><strong>Alergênicos:</strong> {simulation.ppo.allergens.map(a => a.text).join(', ')}</p>}
                                {simulation.ppo?.ncm && <p><strong>NCM:</strong> {simulation.ppo.ncm}</p>}
                                {simulation.ppo?.cest && <p><strong>CEST:</strong> {simulation.ppo.cest}</p>}
                                {simulation.ppo?.cfop && <p><strong>CFOP:</strong> {simulation.ppo.cfop}</p>}
                                {simulation.ppo?.assemblyVideoUrl && <p><strong>Vídeo:</strong> <a href={simulation.ppo.assemblyVideoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Assistir</a></p>}
                            </div>
                        </div>
                    </AccordionContent>
                </Card>
            </AccordionItem>
        </Accordion>
    );
}
