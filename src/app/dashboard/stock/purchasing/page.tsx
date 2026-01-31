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
import { ShoppingCart, History, ArrowRight } from 'lucide-react';

export default function PurchasingHubPage() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    // This effect ensures that when the modal is closed (e.g., by pressing Esc),
    // the user is navigated back to the stock management page.
    if (!isOpen) {
      router.push('/dashboard/stock');
    }
  }, [isOpen, router]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[650px] gap-0 p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-2xl">Gestão de compras</DialogTitle>
          <DialogDescription>
            Escolha uma das opções abaixo para continuar.
          </DialogDescription>
        </DialogHeader>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-lg transition-all duration-300">
                <CardHeader className="p-0 items-center">
                    <div className="p-3 bg-primary/10 rounded-full mb-4">
                        <ShoppingCart className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-xl mb-2">Registrar nova compra</CardTitle>
                    <CardDescription className="text-sm">Crie pesquisas manuais ou veja as compras em andamento.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                    <Link href="/dashboard/stock/purchasing/sessions" className="w-full">
                        <Button className="w-full">
                            Acessar <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                </CardContent>
            </Card>

            <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-lg transition-all duration-300">
                <CardHeader className="p-0 items-center">
                    <div className="p-4 bg-primary/10 rounded-full mb-4">
                        <History className="h-8 w-8 text-primary" />
                    </div>
                    <CardTitle className="text-xl mb-2">Consultar histórico</CardTitle>
                    <CardDescription className="text-sm">Consulte ordens de compra e o histórico de preços efetivados.</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                     <Link href="/dashboard/stock/purchasing/history" className="w-full">
                        <Button className="w-full">
                            Acessar <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                </CardContent>
            </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
