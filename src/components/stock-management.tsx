
"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart3, ClipboardCheck, Truck, ShoppingCart } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export function StockManagement() {
    const { permissions } = useAuth();
    const canPurchase = permissions.purchasing.suggest || permissions.purchasing.approve;

    return (
        <div className="w-full max-w-7xl mx-auto">
            <div className="text-center mb-10">
                <h1 className="text-4xl font-bold tracking-tight">Gestão de estoque</h1>
                <p className="text-lg text-muted-foreground mt-2">Gerencie lotes, vencimentos, reposição e consumo do seu estoque em um só lugar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <ClipboardCheck className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Controle de insumos</CardTitle>
                        <CardDescription>Acompanhe a validade dos lotes, adicione novos insumos e faça transferências entre quiosques.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/inventory-control" className="w-full">
                            <Button className="w-full text-lg py-6">
                                Acessar controle <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <BarChart3 className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Análise de estoque</CardTitle>
                        <CardDescription>Analise relatórios de reposição de estoque e visualize o consumo médio dos produtos.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/analysis" className="w-full">
                             <Button className="w-full text-lg py-6">
                                Acessar análises <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                 {canPurchase && (
                    <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                        <CardHeader className="p-0 items-center">
                            <div className="p-4 bg-primary/10 rounded-full mb-4">
                                <ShoppingCart className="h-10 w-10 text-primary" />
                            </div>
                            <CardTitle className="text-2xl mb-2">Gestão de compras</CardTitle>
                            <CardDescription>Pesquise preços, compare custos e efetive suas compras de insumos.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                            <Link href="/dashboard/stock/purchasing" className="w-full">
                                <Button className="w-full text-lg py-6">
                                    Acessar compras <ArrowRight className="ml-2" />
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                )}
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <Truck className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Gestão de avarias</CardTitle>
                        <CardDescription>Gerencie o processo de devolução, bonificação e outras avarias de insumos com fornecedores.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/returns" className="w-full">
                            <Button className="w-full text-lg py-6">
                                Acessar módulo <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
