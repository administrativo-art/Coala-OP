

"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign } from 'lucide-react';

export default function PricingPage() {
  return (
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
  );
}
