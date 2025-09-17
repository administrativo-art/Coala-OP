

"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, BarChart, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';

export default function PricingPage() {
  return (
    <div className="space-y-6">
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

      <PriceComparisonTable />

      <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
          <CardHeader className="p-0 items-center">
              <div className="p-4 bg-primary/10 rounded-full mb-4">
                  <BarChart className="h-10 w-10 text-primary" />
              </div>
              <CardTitle className="text-2xl mb-2">Análise de Concorrência</CardTitle>
              <CardDescription>Cadastre concorrentes, seus produtos e preços para comparar com suas mercadorias.</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
              <Link href="/dashboard/pricing/competitors" className="w-full">
                  <Button className="w-full text-lg py-6">
                      Acessar concorrência <ArrowRight className="ml-2" />
                  </Button>
              </Link>
          </CardContent>
      </Card>
    </div>
  );
}

