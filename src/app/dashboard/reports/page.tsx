"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, TrendingUp, DollarSign, LineChart } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export default function ReportsPage() {
    const { permissions } = useAuth();
    
    return (
        <div className="w-full space-y-8">
            <div>
                <h1 className="text-3xl font-bold">Análise estratégica</h1>
                <p className="text-sm text-muted-foreground">Ferramentas estratégicas para seu estoque.</p>
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
    );
}
