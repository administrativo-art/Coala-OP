"use client";

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShoppingCart, History, ArrowRight, Loader2, List } from 'lucide-react';
import { usePurchase } from '@/hooks/use-purchase';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function PurchasingHubPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const { sessions, addSession, loading: purchaseLoading } = usePurchase();
  const [isOpen, setIsOpen] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      router.push('/dashboard/stock');
    }
  }, [isOpen, router]);
  
  const openSessions = useMemo(() => sessions.filter(s => s.status === 'open'), [sessions]);

  const handleCreateSession = async () => {
    setIsCreating(true);
    const description = `Cotação de ${format(new Date(), 'dd/MM/yyyy')}`;
    try {
      const newSessionId = await addSession({ description, baseProductIds: [], type: 'manual' });
      if (newSessionId) {
        router.push(`/dashboard/stock/purchasing/sessions/${newSessionId}`);
      } else {
        throw new Error("Falha ao criar a sessão.");
      }
    } catch (error) {
      setIsCreating(false);
    }
  };

  return (
    <PermissionGuard allowed={permissions.stock.purchasing.view}>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-3xl gap-0 p-0">
            <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-2xl">Gestão de compras</DialogTitle>
            <DialogDescription>
                Crie uma nova cotação, continue uma pesquisa em andamento ou consulte o histórico de compras.
            </DialogDescription>
            </DialogHeader>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card 
                className={cn(
                    "flex flex-col text-center items-center p-6 border-2 border-primary shadow-lg transition-all duration-300",
                    !isCreating && "cursor-pointer hover:bg-primary/5"
                )}
                onClick={!isCreating ? handleCreateSession : undefined}
                >
                    <CardHeader className="p-0 items-center">
                        <div className="p-3 bg-primary/10 rounded-full mb-4">
                            <ShoppingCart className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-xl mb-2">Registrar Nova Compra</CardTitle>
                        <CardDescription className="text-sm">Crie uma nova pesquisa de preços em branco.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <div className="text-primary font-semibold flex items-center h-10">
                            {isCreating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin"/> Criando sessão...
                                </>
                            ) : (
                                <>
                                    Iniciar <ArrowRight className="ml-2 h-4 w-4" />
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="flex flex-col border-2">
                    <CardHeader className="p-4 border-b">
                        <CardTitle className="text-base flex items-center gap-2">
                            <List className="h-5 w-5"/>
                            Pesquisas em Andamento ({openSessions.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 flex-grow">
                        <ScrollArea className="h-48">
                            <div className="p-4 space-y-2">
                            {purchaseLoading ? <Skeleton className="h-24 w-full" /> : 
                            openSessions.length > 0 ? (
                                openSessions.map(session => (
                                <Link key={session.id} href={`/dashboard/stock/purchasing/sessions/${session.id}`} className="block">
                                    <div className="p-3 rounded-md border bg-background hover:bg-muted transition-colors">
                                        <p className="font-semibold">{session.description}</p>
                                        <p className="text-xs text-muted-foreground">Criada em: {format(new Date(session.createdAt), 'dd/MM/yyyy')}</p>
                                    </div>
                                </Link>
                                ))
                            ) : (
                                <div className="text-center text-sm text-muted-foreground pt-12">
                                    Nenhuma pesquisa em andamento.
                                </div>
                            )}
                            </div>
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
            <DialogFooter className="p-6 pt-4 border-t">
            <Link href="/dashboard/stock/purchasing/history">
                <Button variant="outline">
                    <History className="mr-2 h-4 w-4" />
                    Consultar Histórico de Compras
                </Button>
            </Link>
            </DialogFooter>
        </DialogContent>
        </Dialog>
    </PermissionGuard>
  );
}