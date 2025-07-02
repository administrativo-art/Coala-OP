"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart3, ClipboardCheck } from 'lucide-react';

export function StockManagement() {
    return (
        <div className="w-full">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Gestão de Estoque</h1>
                <p className="text-muted-foreground">Gerencie lotes, vencimentos, reposição e consumo do seu estoque em um só lugar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><ClipboardCheck /> Controle de Insumos</CardTitle>
                        <CardDescription>Acompanhe a validade dos lotes, adicione novos insumos e faça transferências entre quiosques.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/inventory-control" className="w-full">
                            <Button className="w-full">
                                Acessar Controle <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><BarChart3 /> Análise de Estoque</CardTitle>
                        <CardDescription>Analise relatórios de reposição de estoque e visualize o consumo médio dos produtos.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/analysis" className="w-full">
                             <Button className="w-full">
                                Acessar Análises <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
