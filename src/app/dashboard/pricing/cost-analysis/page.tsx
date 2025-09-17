"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, DollarSign } from 'lucide-react';
import Link from 'next/link';

export default function CostAnalysisPage() {
  return (
    <div className="space-y-6">
      <Link href="/dashboard/pricing" className="inline-block">
        <Button variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para Custo e Preço
        </Button>
      </Link>
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
    </div>
  );
}
