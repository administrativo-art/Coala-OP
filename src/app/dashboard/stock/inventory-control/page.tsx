
"use client";

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft, History, Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ZeroedLotsAuditModal } from '@/components/zeroed-lots-audit-modal';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

function InventoryControlContent() {
    const [isStockModalOpen, setIsStockModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

    return (
        <div>
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para gestão de estoque
                </Button>
            </Link>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <Card className="hover:bg-muted/50 transition-colors">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Package />Estoque Atual</CardTitle>
                        <CardDescription>Consulte os lotes, adicione novos itens e realize movimentações.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full" onClick={() => setIsStockModalOpen(true)}>Consultar Estoque</Button>
                    </CardContent>
                </Card>

                <Card className="hover:bg-muted/50 transition-colors">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><History />Histórico de Movimentações</CardTitle>
                        <CardDescription>Visualize o histórico completo de entradas, saídas e transferências.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full" onClick={() => setIsHistoryModalOpen(true)}>Consultar Histórico</Button>
                    </CardContent>
                </Card>
            </div>
            
            <Dialog open={isStockModalOpen} onOpenChange={setIsStockModalOpen}>
                <DialogContent className="max-w-7xl h-[95vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Consulta de Estoque</DialogTitle>
                         <DialogDescription>
                           Visualize, adicione e gerencie todos os lotes do seu estoque.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-auto -mx-6 px-6">
                        <ExpiryControl />
                    </div>
                </DialogContent>
            </Dialog>

            <ZeroedLotsAuditModal open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen} />
        </div>
    );
}

export default function InventoryControlPage() {
    return (
        <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
            <InventoryControlContent />
        </Suspense>
    );
}
