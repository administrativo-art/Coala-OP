
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
import { type PurchaseSession } from "@/types";
import { PriceComparisonTable } from "./price-comparison-table";
import { Building, Calendar, ShoppingCart, User, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

interface PurchaseSessionCardProps {
    session: PurchaseSession;
}

export function PurchaseSessionCard({ session }: PurchaseSessionCardProps) {
    const { users } = useAuth();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const { items, closeSession, deleteSession } = usePurchase();
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

    const entity = useMemo(() => entities.find(e => e.id === session.entityId), [session.entityId, entities]);
    const user = useMemo(() => users.find(u => u.id === session.userId), [session.userId, users]);
    const sessionItems = useMemo(() => items.filter(i => i.sessionId === session.id), [session.id, items]);

    const sessionBaseProducts = useMemo(() => {
        return baseProducts
            .filter(bp => session.baseProductIds.includes(bp.id))
            .sort((a,b) => a.name.localeCompare(b.name));
    }, [session.baseProductIds, baseProducts]);
    
    const handleCloseSession = () => {
        closeSession(session.id);
    };

    const handleDeleteSession = async () => {
        await deleteSession(session.id);
        setIsDeleteConfirmOpen(false);
    };

    const isSessionClosed = session.status === 'closed';

    return (
        <>
            <Card className={isSessionClosed ? 'bg-muted/50' : ''}>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                        <div>
                            <CardTitle className="flex items-center gap-2"><ShoppingCart /> {session.description}</CardTitle>
                            <CardDescription className="mt-2 space-y-1 text-xs">
                                <p className="flex items-center gap-1.5"><Building className="h-3 w-3" /> Fornecedor: <strong>{entity?.name || 'Não encontrado'}</strong></p>
                                <p className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Criado em: {format(new Date(session.createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                                <p className="flex items-center gap-1.5"><User className="h-3 w-3" /> Por: {user?.username || 'Desconhecido'}</p>
                                 {isSessionClosed && session.closedAt && (
                                    <p className="flex items-center gap-1.5 text-primary">Concluído em: {format(new Date(session.closedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p>
                                 )}
                            </CardDescription>
                        </div>
                         <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive hover:text-destructive"
                            onClick={() => setIsDeleteConfirmOpen(true)}
                        >
                            <Trash2 className="h-5 w-5" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <Accordion type="multiple" className="w-full space-y-3">
                        {sessionBaseProducts.map(bp => (
                            <AccordionItem value={bp.id} key={bp.id} className="border-none">
                                <Card className="bg-card/40">
                                    <AccordionTrigger className="p-4 text-lg font-semibold hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none">
                                        {bp.name}
                                    </AccordionTrigger>
                                    <AccordionContent className="p-4">
                                        <PriceComparisonTable
                                            baseProductId={bp.id}
                                            items={sessionItems}
                                            sessionId={session.id}
                                            isSessionClosed={isSessionClosed}
                                        />
                                    </AccordionContent>
                                </Card>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </CardContent>
                {!isSessionClosed && (
                    <CardFooter className="border-t pt-4">
                        <Button onClick={handleCloseSession}>Concluir e salvar pesquisa</Button>
                    </CardFooter>
                )}
            </Card>

            <DeleteConfirmationDialog 
                open={isDeleteConfirmOpen}
                onOpenChange={setIsDeleteConfirmOpen}
                onConfirm={handleDeleteSession}
                itemName={`a pesquisa "${session.description}"`}
                description="Esta ação não pode ser desfeita. Todos os preços inseridos nesta pesquisa serão perdidos."
            />
        </>
    );
}
