
"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, LineChart, DollarSign, ArrowRight, Truck, ShoppingBag } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export default function ReportsPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      router.push('/dashboard/stock');
    }
  }, [isOpen, router]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[850px] gap-0 p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-2xl">Análise estratégica</DialogTitle>
          <DialogDescription>
            Ferramentas estratégicas para seu estoque. Escolha uma opção para continuar.
          </DialogDescription>
        </DialogHeader>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {permissions.stock.analysis.projection && (
                <Card className="flex flex-col text-center items-center p-4 border-2 border-transparent hover:border-primary hover:shadow-lg transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-3 bg-primary/10 rounded-full mb-4">
                            <LineChart className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-xl mb-2">Projeção de consumo</CardTitle>
                        <CardDescription className="text-sm">Preveja se o estoque será consumido antes do vencimento.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/analysis/projection" className="w-full">
                            <Button className="w-full">
                                Acessar <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}
            {permissions.stock.analysis.consumption && (
                <Card className="flex flex-col text-center items-center p-4 border-2 border-transparent hover:border-primary hover:shadow-lg transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-3 bg-primary/10 rounded-full mb-4">
                            <TrendingUp className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-xl mb-2">Consumo médio</CardTitle>
                        <CardDescription className="text-sm">Visualize o consumo médio dos seus insumos.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/analysis/consumption" className="w-full">
                            <Button className="w-full">
                                Acessar <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}
            {permissions.stock.analysis.consumption && (
                <Card className="flex flex-col text-center items-center p-4 border-2 border-transparent hover:border-primary hover:shadow-lg transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-3 bg-primary/10 rounded-full mb-4">
                            <ShoppingBag className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-xl mb-2">Análise de vendas</CardTitle>
                        <CardDescription className="text-sm">Visualize o ranking e a evolução das vendas de produtos.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/analysis/sales" className="w-full">
                            <Button className="w-full">
                                Acessar <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}
             {permissions.stock.inventoryControl.viewHistory && (
                <Card className="flex flex-col text-center items-center p-4 border-2 border-transparent hover:border-primary hover:shadow-lg transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-3 bg-primary/10 rounded-full mb-4">
                            <Truck className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-xl mb-2">Análise de movimentações</CardTitle>
                        <CardDescription className="text-sm">Analise o fluxo de transferências entre quiosques.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/stock/analysis/movement-analysis" className="w-full">
                            <Button className="w-full">
                                Acessar <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
