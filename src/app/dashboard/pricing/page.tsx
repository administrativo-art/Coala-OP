"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, DollarSign, LineChart } from 'lucide-react';

export default function PricingPage() {

  return (
    <div className="space-y-6">
        <div className="text-center mb-10">
            <h1 className="text-4xl font-bold tracking-tight">Gestão de preços e margens</h1>
            <p className="text-lg text-muted-foreground mt-2">Analise a lucratividade das suas mercadorias e compare seus preços com os da concorrência.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 justify-center">
            <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                <CardHeader className="p-0 items-center">
                    <div className="p-4 bg-primary/10 rounded-full mb-4">
                        <DollarSign className="h-10 w-10 text-primary" />
                    </div>
                    <CardTitle className="text-2xl mb-2">Ficha de custo e margem</CardTitle>
                    <CardDescription>Crie composições, analise o CMV e simule preços de venda para entender a lucratividade.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                    <Link href="/dashboard/pricing/cost-analysis" className="w-full">
                        <Button className="w-full text-lg py-6">
                            Acessar análise <ArrowRight className="ml-2" />
                        </Button>
                    </Link>
                </CardContent>
            </Card>

            <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                <CardHeader className="p-0 items-center">
                    <div className="p-4 bg-primary/10 rounded-full mb-4">
                        <LineChart className="h-10 w-10 text-primary" />
                    </div>
                    <CardTitle className="text-2xl mb-2">Estudo de preço</CardTitle>
                    <CardDescription>Cadastre concorrentes, correlacione suas mercadorias e compare os preços de venda.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                    <Link href="/dashboard/pricing/price-comparison" className="w-full">
                        <Button className="w-full text-lg py-6">
                            Acessar estudo <ArrowRight className="ml-2" />
                        </Button>
                    </Link>
                </CardContent>
            </Card>
        </div>
    </div>
  );
}
