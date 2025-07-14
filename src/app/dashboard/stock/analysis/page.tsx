
"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, BarChart3, TrendingUp } from 'lucide-react';

export default function AnalysisPage() {
    return (
        <div className="w-full">
            <Link href="/dashboard/stock" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    voltar para gestão de estoque
                </Button>
            </Link>
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Análise de estoque</h1>
                <p className="text-muted-foreground">escolha o tipo de análise que deseja realizar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><BarChart3 /> Análise de reposição</CardTitle>
                        <CardDescription>importe sua planilha de estoque para calcular as necessidades e gerar sugestões de distribuição.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/analysis/restock" className="w-full">
                            <Button className="w-full">
                                analisar reposição <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><TrendingUp /> Consumo médio</CardTitle>
                        <CardDescription>visualize o consumo médio mensal dos seus produtos para planejar compras futuras.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/analysis/consumption" className="w-full">
                            <Button className="w-full">
                                ver consumo <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
