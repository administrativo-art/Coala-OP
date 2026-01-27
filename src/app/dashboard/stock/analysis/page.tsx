"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, RefreshCw, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';

export default function RepositionHubPage() {
    const router = useRouter();
    const { kiosks } = useKiosks();
    const { permissions } = useAuth();
    const [isKioskModalOpen, setIsKioskModalOpen] = useState(false);

    const handleKioskSelect = (kioskId: string) => {
        router.push(`/dashboard/stock/analysis/restock?kioskId=${kioskId}`);
        setIsKioskModalOpen(false);
    };
    
    return (
        <div className="w-full space-y-8">
            <div className="flex items-center gap-4 mb-4">
                <Button 
                    onClick={() => router.push('/dashboard/stock')}
                    variant="ghost"
                    className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Voltar para gestão de estoque"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Reposição de Estoque</h1>
                    <p className="text-sm text-muted-foreground">Inicie uma nova reposição ou gerencie atividades em andamento.</p>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {permissions.stock.analysis.restock && (
                    <Card className="flex flex-col">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><RefreshCw /> Atividade de reposição</CardTitle>
                            <CardDescription>Compare o estoque atual com as metas e crie uma atividade de reposição.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-grow flex items-end">
                            <Button className="w-full" onClick={() => setIsKioskModalOpen(true)}>
                                Iniciar Análise <ArrowRight className="ml-2" />
                            </Button>
                        </CardContent>
                    </Card>
                )}
                {permissions.stock.analysis.restock && (
                    <Card className="flex flex-col">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><Truck /> Gerenciamento da reposição</CardTitle>
                            <CardDescription>Gerencie o fluxo de envio e recebimento de insumos para as atividades de reposição.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-grow flex items-end">
                            <Link href="/dashboard/stock/reposition" className="w-full">
                                <Button className="w-full">
                                    Gerenciar Atividades <ArrowRight className="ml-2" />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                )}
            </div>

            <Dialog open={isKioskModalOpen} onOpenChange={setIsKioskModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Iniciar Análise de Reposição</DialogTitle>
                        <DialogDescription>Selecione o quiosque ou a matriz para analisar a necessidade de reposição.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                        {kiosks.map(kiosk => (
                            <Button key={kiosk.id} variant="outline" className="w-full justify-start text-base py-6" onClick={() => handleKioskSelect(kiosk.id)}>
                                {kiosk.name}
                            </Button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
