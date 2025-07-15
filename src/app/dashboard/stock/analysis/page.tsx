
"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, TrendingUp, DollarSign } from 'lucide-react';

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
                <p className="text-muted-foreground">Visualize o consumo e o valor financeiro do seu estoque.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><TrendingUp /> Consumo médio</CardTitle>
                        <CardDescription>Visualize o consumo médio mensal dos seus produtos para planejar compras futuras.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/analysis/consumption" className="w-full">
                            <Button className="w-full">
                                Ver consumo <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><DollarSign /> Avaliação financeira do estoque</CardTitle>
                        <CardDescription>Calcule o valor financeiro do seu estoque com base nos preços médios de compra.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end">
                        <Link href="/dashboard/stock/analysis/valuation" className="w-full">
                            <Button className="w-full">
                                Acessar avaliação <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
