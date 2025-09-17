"use client";

import { useState } from 'react';
import { PricingSimulator } from '@/components/pricing-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, LineChart, Users, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompetitorManagementModal } from '@/components/competitor-management-modal';
import { CompetitorProductModal } from '@/components/competitor-product-modal';

export default function PricingPage() {
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

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
                 <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsProductModalOpen(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Mercadoria do Concorrente
                    </Button>
                    <Button onClick={() => setIsCompetitorModalOpen(true)}>
                        <Users className="mr-2 h-4 w-4" /> Gerenciar Concorrentes
                    </Button>
                </div>
                <PriceComparisonTable />
            </TabsContent>
        </Tabs>
        
        <CompetitorManagementModal
            isOpen={isCompetitorModalOpen}
            onClose={() => setIsCompetitorModalOpen(false)}
        />
         <CompetitorProductModal
            isOpen={isProductModalOpen}
            onClose={() => setIsProductModalOpen(false)}
            productToEdit={null}
        />
    </div>
  );
}
