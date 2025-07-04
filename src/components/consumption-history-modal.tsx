"use client"

import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from 'date-fns/locale';

import { type ConsumptionReport } from "@/types";
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { FileClock, Trash2, Warehouse } from "lucide-react";


interface ConsumptionHistoryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    history: ConsumptionReport[];
    loading: boolean;
    deleteReport: (reportId: string) => Promise<void>;
}

export function ConsumptionHistoryModal({ open, onOpenChange, history, loading, deleteReport }: ConsumptionHistoryModalProps) {
    const { products: activeProducts, loading: productsLoading } = useStockAnalysisProducts()
    const [reportToDelete, setReportToDelete] = useState<ConsumptionReport | null>(null);

    const handleDeleteClick = (report: ConsumptionReport) => setReportToDelete(report);
    const handleDeleteConfirm = async () => {
        if (reportToDelete) {
            await deleteReport(reportToDelete.id);
            setReportToDelete(null);
        }
    };

    const groupedHistory = useMemo(() => {
        if (loading || history.length === 0) return {};
        return history.reduce((acc, report) => {
            const key = report.kioskName;
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(report);
            return acc;
        }, {} as { [key: string]: ConsumptionReport[] });
    }, [history, loading]);
    
    const renderContent = () => {
        if (loading || productsLoading) return (
            <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
            </div>
        )

        if (Object.keys(groupedHistory).length === 0) return (
            <div className="text-center py-8 text-muted-foreground flex flex-col items-center justify-center h-full">
                <FileClock className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhuma análise no histórico</h3>
                <p className="mt-1 text-sm">Faça o upload de um relatório para começar.</p>
            </div>
        )
        
        return (
             <div className="w-full space-y-6">
                {Object.entries(groupedHistory).map(([kioskName, reports]) => (
                    <Accordion type="single" collapsible className="w-full" key={kioskName}>
                        <AccordionItem value={kioskName} className="border-none">
                            <Card className="bg-muted/30">
                                <AccordionTrigger className="p-4 hover:no-underline rounded-t-lg text-lg font-semibold [&[data-state=open]]:border-b">
                                    <div className="flex items-center gap-2">
                                        <Warehouse className="h-5 w-5 text-primary"/>
                                        {kioskName}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-4 pt-2">
                                    <Accordion type="multiple" className="w-full space-y-3">
                                        {reports.map(report => (
                                            <AccordionItem value={report.id} key={report.id} className="border-none">
                                                <Card>
                                                    <AccordionTrigger className="p-4 hover:no-underline rounded-lg w-full">
                                                        <div className="flex items-center justify-between gap-4 w-full">
                                                            <div className="grid gap-1 flex-grow text-left">
                                                                <p className="font-semibold">Relatório de {report.month}/{report.year}</p>
                                                                <p className="text-sm text-muted-foreground">Analisado em: {format(new Date(report.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteClick(report); }}><span><Trash2 className="h-4 w-4" /></span></Button>
                                                            </div>
                                                        </div>
                                                    </AccordionTrigger>
                                                    <AccordionContent className="p-4 pt-0">
                                                        {report.results && report.results.length > 0 ? (
                                                        <div className="rounded-md border">
                                                                <Table>
                                                                    <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead className="text-right">Qtd. Consumida (Unidade Base)</TableHead></TableRow></TableHeader>
                                                                    <TableBody>
                                                                        {report.results.map((item, index) => {
                                                                            const productConfig = activeProducts.find(p => p.id === item.productId);
                                                                            return (
                                                                                <TableRow key={index}>
                                                                                    <TableCell>{item.productName}</TableCell>
                                                                                    <TableCell className="text-right font-semibold">{item.consumedQuantity.toLocaleString()} {productConfig?.unit || ''}</TableCell>
                                                                                </TableRow>
                                                                            )
                                                                        })}
                                                                    </TableBody>
                                                                </Table>
                                                            </div>
                                                        ) : (<p className="text-center text-muted-foreground text-sm pt-4">Nenhum resultado para este relatório.</p>)}
                                                    </AccordionContent>
                                                </Card>
                                            </AccordionItem>
                                        ))}
                                    </Accordion>
                                </AccordionContent>
                            </Card>
                        </AccordionItem>
                    </Accordion>
                ))}
            </div>
        )
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Histórico de Análises de Consumo</DialogTitle>
                        <DialogDescription>
                            Consulte, expanda e exclua análises de consumo de meses anteriores.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-grow overflow-hidden">
                        <ScrollArea className="h-full pr-4">
                           {renderContent()}
                        </ScrollArea>
                    </div>
                    <DialogFooter className="pt-4 border-t mt-auto">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {reportToDelete && (
                <DeleteConfirmationDialog
                    open={!!reportToDelete}
                    onOpenChange={() => setReportToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`o relatório de consumo de ${reportToDelete.kioskName} (${reportToDelete.month}/${reportToDelete.year})`}
                />
            )}
        </>
    )
}
