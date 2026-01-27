"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, TrendingUp, DollarSign, RefreshCw, LineChart, Truck, BarChart3, PackageCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useKiosks } from '@/hooks/use-kiosks';
import { Separator } from '@/components/ui/separator';

export default function AnalysisPage() {
    const router = useRouter();
    const { permissions } = useAuth();
    const { kiosks } = useKiosks();
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
                    <h1 className="text-3xl font-bold">Análise & Reposição</h1>
                    <p className="text-sm text-muted-foreground">Ferramentas operacionais e estratégicas para seu estoque.</p>
                </div>
            </div>
            
            {/* Seção Operacional */}
            <div className="space-y-4">
                <div className='flex items-center gap-4'>
                    <PackageCheck className='h-6 w-6 text-primary' />
                    <h2 className="text-2xl font-bold tracking-tight">Operacional: Reposição</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {permissions.stock.analysis.restock && (
                        <Card className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><RefreshCw /> Análise de reposição</CardTitle>
                                <CardDescription>Compare o estoque atual com as metas e veja o que precisa ser reposto.</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow flex items-end">
                                <Button className="w-full" onClick={() => setIsKioskModalOpen(true)}>
                                    Iniciar Reposição <ArrowRight className="ml-2" />
                                </Button>
                            </CardContent>
                        </Card>
                    )}
                    {permissions.stock.analysis.restock && (
                        <Card className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Truck /> Atividades de Reposição</CardTitle>
                                <CardDescription>Gerencie despachos e recebimentos de transferências entre quiosques.</CardDescription>
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
            </div>

            <Separator />

             {/* Seção Estratégica */}
            <div className="space-y-4">
                <div className='flex items-center gap-4'>
                    <BarChart3 className='h-6 w-6 text-primary' />
                    <h2 className="text-2xl font-bold tracking-tight">Estratégico: Análise de Estoque</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {permissions.stock.analysis.consumption && (
                        <Card className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><TrendingUp /> Consumo médio</CardTitle>
                                <CardDescription>Visualize o consumo médio mensal dos seus insumos para planejar compras futuras.</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow flex items-end">
                                <Link href="/dashboard/stock/analysis/consumption" className="w-full">
                                    <Button className="w-full">
                                        Ver consumo <ArrowRight className="ml-2" />
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                    {permissions.stock.analysis.projection && (
                        <Card className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><LineChart /> Projeção de Consumo</CardTitle>
                                <CardDescription>Preveja se o estoque será consumido antes do vencimento com base na média.</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow flex items-end">
                                <Link href="/dashboard/stock/analysis/projection" className="w-full">
                                    <Button className="w-full">
                                        Acessar projeção <ArrowRight className="ml-2" />
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                    {permissions.stock.analysis.valuation && (
                        <Card className="flex flex-col">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><DollarSign /> Avaliação financeira</CardTitle>
                                <CardDescription>Calcule o valor financeiro do seu estoque com base nos preços de compra.</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow flex items-end">
                                <Link href="/dashboard/stock/analysis/valuation" className="w-full">
                                    <Button className="w-full">
                                        Acessar avaliação <ArrowRight className="ml-2" />
                                    </Button>
                                </Link>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            <Dialog open={isKioskModalOpen} onOpenChange={setIsKioskModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Iniciar Reposição</DialogTitle>
                        <DialogDescription>Selecione o quiosque de destino para analisar a necessidade de reposição.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                        {kiosks.filter(k => k.id !== 'matriz').map(kiosk => (
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
