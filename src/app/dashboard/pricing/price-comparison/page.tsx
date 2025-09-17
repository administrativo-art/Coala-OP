"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';
import { CompetitorManagementModal } from '@/components/competitor-management-modal';
import { CompetitorProductManagementModal } from '@/components/competitor-product-management-modal';
import { ArrowLeft, LineChart, PlusCircle, Users } from 'lucide-react';
import Link from 'next/link';

export default function PriceComparisonPage() {
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

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
                <LineChart />
                Estudo de preço
            </CardTitle>
            <CardDescription>
                Compare os preços das suas mercadorias com os da concorrência para se manter competitivo.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsProductModalOpen(true)}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Mercadorias dos concorrentes
                </Button>
                <Button onClick={() => setIsCompetitorModalOpen(true)}>
                    <Users className="mr-2 h-4 w-4" /> Gerenciar Concorrentes
                </Button>
            </div>
            <PriceComparisonTable />
        </CardContent>
      </Card>
        
        <CompetitorManagementModal
            isOpen={isCompetitorModalOpen}
            onClose={() => setIsCompetitorModalOpen(false)}
        />
         <CompetitorProductManagementModal
            isOpen={isProductModalOpen}
            onClose={() => setIsProductModalOpen(false)}
        />
    </div>
  );
}
