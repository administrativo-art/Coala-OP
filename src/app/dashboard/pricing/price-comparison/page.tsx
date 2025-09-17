
"use client";

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PriceComparisonTable } from '@/components/price-comparison-table';
import { CompetitorManagementModal } from '@/components/competitor-management-modal';
import { CompetitorProductManagementModal } from '@/components/competitor-product-management-modal';
import { ArrowLeft, LineChart, SlidersHorizontal, Group, Users, History, Menu, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCompetitors } from '@/hooks/use-competitors';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import { Skeleton } from '@/components/ui/skeleton';
import { CompetitorSelectionModal } from '@/components/competitor-selection-modal';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';


export default function PriceComparisonPage() {
  const [isCompetitorModalOpen, setIsCompetitorModalOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const { competitors, loading: loadingCompetitors } = useCompetitors();
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([]);
  
  const selectedCompetitors = useMemo(() => {
    return competitors.filter(c => selectedCompetitorIds.includes(c.id));
  }, [selectedCompetitorIds, competitors]);

  const handleRemoveCompetitor = (competitorId: string) => {
      setSelectedCompetitorIds(prev => prev.filter(id => id !== competitorId));
  };

  return (
    <div className="space-y-6">
       <Link href="/dashboard/pricing" className="inline-block">
        <Button variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para custo e preço
        </Button>
      </Link>
      <Card>
        <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="flex items-center gap-2">
                    <LineChart />
                    Estudo de preço
                </CardTitle>
                <CardDescription>
                    Compare os preços das suas mercadorias com os da concorrência para se manter competitivo.
                </CardDescription>
              </div>
               <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <Menu className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsSelectionModalOpen(true)}>
                    <SlidersHorizontal className="mr-2 h-4 w-4" />
                    Selecionar concorrentes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsProductModalOpen(true)}>
                    <Group className="mr-2 h-4 w-4" />
                    Mercadorias dos Concorrentes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsCompetitorModalOpen(true)}>
                    <Users className="mr-2 h-4 w-4" />
                    Gerenciar Concorrentes
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <PriceComparisonTable 
              selectedCompetitorIds={selectedCompetitorIds} 
            />
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
        <CompetitorSelectionModal
            isOpen={isSelectionModalOpen}
            onClose={() => setIsSelectionModalOpen(false)}
            selectedCompetitorIds={selectedCompetitorIds}
            setSelectedCompetitorIds={setSelectedCompetitorIds}
        />
    </div>
  );
}
