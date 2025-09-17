

"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, BarChart, ArrowRight, LineChart, Users } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function PricingPage() {
  return (
    <div className="space-y-6">
        <div className="mb-6">
            <h1 className="text-3xl font-bold">Custo e Preço</h1>
            <p className="text-muted-foreground">Analise a lucratividade das suas mercadorias e compare seus preços com os da concorrência.</p>
        </div>

        <Tabs defaultValue="cost-analysis" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cost-analysis"><DollarSign className="mr-2 h-4 w-4" /> Análise de Custo</TabsTrigger>
                <TabsTrigger value="comparison"><LineChart className="mr-2 h-4 w-4" /> Comparação de Preços</TabsTrigger>
            </TabsList>
            <TabsContent value="cost-analysis" className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DollarSign />
                            Análise de custo
                        </CardTitle>
                        <CardDescription>
                            Crie composições, analise o CMV e simule preços de venda para entender a lucratividade. Use a tabela abaixo para uma visão detalhada e ações.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <PricingSimulator />
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="comparison" className="mt-6 space-y-6">
                 <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                           <Users /> Gerenciar Concorrentes
                        </CardTitle>
                        <CardDescription>
                            Cadastre concorrentes, seus produtos e preços para comparar com suas mercadorias na tabela abaixo.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/dashboard/pricing/competitors">
                            <Button className="w-full">Acessar gerenciamento de concorrência <ArrowRight className="ml-2" /></Button>
                        </Link>
                    </CardContent>
                </Card>
                <PriceComparisonTable />
            </TabsContent>
        </Tabs>
    </div>
  );
}