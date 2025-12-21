"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, DollarSign } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function CostAnalysisPage() {
  const router = useRouter();

  return (
    <div className="space-y-6">
       <div className="flex items-center gap-4 mb-2">
          <Button 
            onClick={() => router.push('/dashboard/pricing')}
            variant="ghost"
            className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Voltar para custo e preço"
          >
            <ArrowLeft className="w-6 h-6" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Análise de mercadoria</h1>
            <p className="text-sm text-muted-foreground">Voltar para custo e preço</p>
          </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign />
            Análise de mercadoria
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
