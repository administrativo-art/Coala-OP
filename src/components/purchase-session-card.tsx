
"use client";

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useEntities } from "@/hooks/use-entities";
import { usePurchase } from "@/hooks/use-purchase";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useProducts } from "@/hooks/use-products";
import { type PurchaseSession, type PurchaseItem } from "@/types";
import { PriceComparisonTable } from "./price-comparison-table";
import { Building, Calendar, ShoppingCart, User, Trash2, Download } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { convertValue } from '@/lib/conversion';

interface PurchaseSessionCardProps {
    session: PurchaseSession;
}

export function PurchaseSessionCard({ session }: PurchaseSessionCardProps) {
    const { users } = useAuth();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { items: purchaseItems, closeSession, deleteSession, confirmPurchase } = usePurchase();
    const { products, getProductFullName } = useProducts();
    const { toast } = useToast();
    
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    const entity = useMemo(() => entities.find(e => e.id === session.entityId), [session.entityId, entities]);
    const user = useMemo(() => users.find(u => u.id === session.userId), [session.userId, users]);
    const sessionItems = useMemo(() => purchaseItems.filter(i => i.sessionId === session.id), [session.id, purchaseItems]);

    const sessionBaseProducts = useMemo(() => {
        return baseProducts
            .filter(bp => session.baseProductIds.includes(bp.id))
            .sort((a,b) => a.name.localeCompare(b.name));
    }, [session.baseProductIds, baseProducts]);
    
    const isSessionClosed = session.status === 'closed';

    const handleDeleteSession = async () => {
        await deleteSession(session.id);
        setIsDeleteConfirmOpen(false);
    };

    const handleSelectionChange = (itemId: string, isSelected: boolean) => {
        setSelectedItems(prev => {
            const newSet = new Set(prev);
            if (isSelected) {
                newSet.add(itemId);
            } else {
                newSet.delete(itemId);
            }
            return newSet;
        });
    };

    const findPricePerUnit = (item: PurchaseItem): number | null => {
        const product = products.find(p => p.id === item.productId);
        const baseProduct = baseProducts.find(bp => bp.id === product?.baseProductId);

        if (product && baseProduct && item.price > 0) {
            try {
                const convertedQty = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                if (convertedQty > 0) {
                    return item.price / convertedQty;
                }
            } catch (e) { console.error("Conversion error", e); }
        }
        return null;
    }
    
    const handleExportPdf = () => {
        const doc = new jsPDF();
        const title = `Ordem de Compra: ${session.description}`;
        const confirmedItems = sessionItems.filter(item => selectedItems.has(item.id));

        doc.setFontSize(18);
        doc.text(title, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy', { locale: ptBR })}`, 14, 29);
        if (user) doc.text(`Gerado por: ${user.username}`, 14, 35);

        const tableHead = [['Insumo', 'Fornecedor', 'Preço Unitário (R$)', 'Custo Efetivo/unid.']];
        const tableBody = confirmedItems.map(item => {
            const product = products.find(p => p.id === item.productId);
            const entity = entities.find(e => e.id === item.entityId);
            const pricePerUnit = findPricePerUnit(item);
            return [
                product ? getProductFullName(product) : 'N/A',
                entity?.name || 'N/A',
                item.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                pricePerUnit ? pricePerUnit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'N/A'
            ];
        });

        autoTable(doc, {
            startY: 45,
            head: tableHead,
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: '#3F51B5' },
        });

        doc.save(`ordem_de_compra_${session.id.slice(0, 8)}.pdf`);
    };

    const finalizePurchase = async (downloadPdf: boolean) => {
        let confirmedCount = 0;
        if (selectedItems.size > 0) {
            for (const itemId of selectedItems) {
                const item = purchaseItems.find(i => i.id === itemId);
                if (!item) continue;
                
                const product = products.find(p => p.id === item.productId);
                if (!product?.baseProductId) continue;
                
                const pricePerUnit = findPricePerUnit(item);
                if (pricePerUnit !== null) {
                    await confirmPurchase(itemId, product.baseProductId, pricePerUnit);
                    confirmedCount++;
                }
            }
        }
        
        await closeSession(session.id, Array.from(selectedItems));

        toast({
            title: "Sessão de compra finalizada!",
            description: selectedItems.size > 0 
                ? `${confirmedCount} item(s) tiveram seus preços efetivados.`
                : 'A pesquisa de preços foi salva no histórico.'
        });

        if (downloadPdf) {
            handleExportPdf();
        }

        setSelectedItems(new Set());
        setIsConfirmModalOpen(false);
    };

    const handleSaveAndFinalize = () => {
        if (selectedItems.size > 0) {
            setIsConfirmModalOpen(true);
        } else {
            finalizePurchase(false);
        }
    };

    return (
        <>
            <Accordion type="single" collapsible className="w-full">
            <AccordionItem value={session.id} className="border rounded-lg">
                <Card className={isSessionClosed ? 'bg-muted/50' : ''}>
                    <CardHeader>
                        <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                             <AccordionTrigger className="p-0 hover:no-underline flex-1 text-left">
                                <div>
                                    <CardTitle className="flex items-center gap-2"><ShoppingCart /> {session.description}</CardTitle>
                                    <CardDescription className="mt-2 space-y-1 text-xs">
                                        {entity && <p className="flex items-center gap-1.5"><Building className="h-3 w-3" /> Fornecedor: <strong>{entity?.name}</strong></p>}
                                        <p className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Criado em: {format(new Date(session.createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                                        <p className="flex items-center gap-1.5"><User className="h-3 w-3" /> Por: {user?.username || 'Desconhecido'}</p>
                                        {isSessionClosed && session.closedAt && (
                                            <p className="flex items-center gap-1.5 text-primary">Concluído em: {format(new Date(session.closedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                                        )}
                                    </CardDescription>
                                </div>
                             </AccordionTrigger>
                            <div className="flex items-center">
                                {isSessionClosed && session.confirmedItemIds && session.confirmedItemIds.length > 0 && (
                                    <Button variant="outline" size="icon" onClick={handleExportPdf}>
                                        <Download className="h-5 w-5"/>
                                    </Button>
                                )}
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-destructive hover:text-destructive shrink-0"
                                    onClick={() => setIsDeleteConfirmOpen(true)}
                                >
                                    <Trash2 className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent>
                            <div className="w-full space-y-3">
                                {sessionBaseProducts.map(bp => (
                                    <div key={bp.id}>
                                        <h3 className="text-lg font-semibold my-2">{bp.name}</h3>
                                        <PriceComparisonTable
                                            baseProduct={bp}
                                            items={sessionItems.filter(i => {
                                                const product = products.find(p => p.id === i.productId);
                                                return product?.baseProductId === bp.id;
                                            })}
                                            sessionId={session.id}
                                            isSessionClosed={isSessionClosed}
                                            selectedItems={selectedItems}
                                            onSelectionChange={handleSelectionChange}
                                        />
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                        {!isSessionClosed && (
                            <CardFooter className="border-t pt-4 justify-end">
                                <Button onClick={handleSaveAndFinalize}>
                                    <ShoppingCart className="mr-2 h-4 w-4" />
                                    Salvar e Efetivar Compra ({selectedItems.size})
                                </Button>
                            </CardFooter>
                        )}
                    </AccordionContent>
                </Card>
            </AccordionItem>
            </Accordion>
            <DeleteConfirmationDialog 
                open={isDeleteConfirmOpen}
                onOpenChange={setIsDeleteConfirmOpen}
                onConfirm={handleDeleteSession}
                itemName={`a pesquisa "${session.description}"`}
                description="Esta ação não pode ser desfeita. Todos os preços inseridos nesta pesquisa serão perdidos."
            />
            <DeleteConfirmationDialog
                open={isConfirmModalOpen}
                onOpenChange={setIsConfirmModalOpen}
                onConfirm={() => finalizePurchase(true)}
                onCancel={() => finalizePurchase(false)}
                title="Emitir Ordem de Compra?"
                description="Você efetivou a compra de um ou mais itens. Deseja baixar o PDF da ordem de compra agora?"
                confirmButtonText="Sim, baixar PDF"
                cancelButtonText="Não, apenas finalizar"
                confirmButtonVariant="default"
            />
        </>
    );
}
