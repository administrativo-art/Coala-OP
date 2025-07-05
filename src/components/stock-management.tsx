
"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, BarChart3, ClipboardCheck, PackageUp } from 'lucide-react';

export function StockManagement() {
    return (
        <div className="w-full max-w-7xl mx-auto">
            <div className="text-center mb-10">
                <h1 className="text-4xl font-bold tracking-tight">Gestão de Estoque</h1>
                <p className="text-lg text-muted-foreground mt-2">Gerencie lotes, vencimentos, reposição e consumo do seu estoque em um só lugar.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <ClipboardCheck className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Controle de Insumos</CardTitle>
                        <CardDescription>Acompanhe a validade dos lotes, adicione novos insumos e faça transferências entre quiosques.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/inventory-control" className="w-full">
                            <Button className="w-full text-lg py-6">
                                Acessar Controle <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <BarChart3 className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Análise de Estoque</CardTitle>
                        <CardDescription>Analise relatórios de reposição de estoque e visualize o consumo médio dos produtos.</CardDescription>
                    </CardHeader>
                     <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/analysis" className="w-full">
                             <Button className="w-full text-lg py-6">
                                Acessar Análises <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <PackageUp className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Devoluções e Bonificações</CardTitle>
                        <CardDescription>Gerencie o processo de devolução e bonificação de insumos com fornecedores.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/returns" className="w-full">
                            <Button className="w-full text-lg py-6">
                                Acessar Módulo <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
