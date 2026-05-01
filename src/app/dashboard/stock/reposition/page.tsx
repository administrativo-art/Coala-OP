
"use client";

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dynamic from 'next/dynamic';

import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { type RepositionActivity, type RepositionItem, type Product } from '@/types';
import { cn } from '@/lib/utils';
import { useProducts } from '@/hooks/use-products';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Inbox, Truck, CheckSquare, Undo2, BadgeCheck, Ban, History, ArrowLeft, Package, FileText, MoreHorizontal, ArrowRight } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DispatchModal } from "@/components/dispatch-modal";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { AuditReceiptModal } from "@/components/audit-receipt-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SeparationListDocument } from '@/components/pdf/SeparationListDocument';
import { ResolveDivergenceModal } from '@/components/resolve-divergence-modal';
import { ScrollArea } from '@/components/ui/scroll-area';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="outline" size="sm" disabled>Carregando...</Button> }
);

function SafePDFDownloadLink({ activity, products }: { activity: RepositionActivity; products: Product[] }) {
    const safeActivity = useMemo(() => {
        if (!activity || !activity.id || !activity.items) return null;
        return {
            ...activity,
            items: Array.isArray(activity.items) 
                ? activity.items.filter(item => item != null && typeof item === 'object')
                : [],
        };
    }, [activity]);

    const safeProducts = useMemo(() => {
        if (!Array.isArray(products)) return [];
        return products.filter(p => p != null && typeof p === 'object');
    }, [products]);

    if (!safeActivity) return null;

    return (
        <PDFDownloadLink
            document={<SeparationListDocument activity={safeActivity as RepositionActivity} products={safeProducts} />}
            fileName={`separacao_reposicao_${safeActivity.id.slice(-6)}.pdf`}
        >
            {((props: any) => (
                <Button variant="outline" size="sm" disabled={props.loading}>
                    <FileText className="mr-2 h-4 w-4" /> {props.loading ? 'Gerando...' : 'Doc. de separação'}
                </Button>
            )) as any}
        </PDFDownloadLink>
    );
}

function RepositionActivityCard({ 
  activity, 
  isSeparated,
  onToggleSeparated,
  onDispatch, 
  onAudit, 
  onFinalize,
  onCancel,
  onReopenDispatch,
  onReopenAudit,
  canRevert,
  products
}: { 
  activity: RepositionActivity; 
  isSeparated: boolean;
  onToggleSeparated: (activity: RepositionActivity) => void;
  onDispatch: (activity: RepositionActivity) => void;
  onAudit: (activity: RepositionActivity) => void;
  onFinalize: (activity: RepositionActivity) => void;
  onCancel: (activity: RepositionActivity) => void;
  onReopenDispatch: (activity: RepositionActivity) => void;
  onReopenAudit: (activity: RepositionActivity) => void;
  canRevert: boolean;
  products: Product[];
}) {
    const { toast } = useToast();

    const handleDownloadFile = async (url: string, fileName: string) => {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error("Erro ao baixar o arquivo:", error);
            toast({ title: "Erro no download", description: "Não foi possível baixar o arquivo.", variant: "destructive" });
        }
    };

    const currentStep = useMemo(() => {
        if (!activity?.status) return 1;
        switch (activity.status) {
            case 'Aguardando despacho': return isSeparated ? 2 : 1; 
            case 'Aguardando recebimento': return 3; 
            case 'Recebido com divergência':
            case 'Recebido sem divergência': return 4; 
            default: return 5; 
        }
    }, [activity?.status, isSeparated]);

    const steps = [
        { name: 'Separação', icon: Package, step: 1 },
        { name: 'Despacho', icon: Truck, step: 2 },
        { name: 'Recebimento', icon: Inbox, step: 3 },
        { name: 'Efetivação', icon: CheckSquare, step: 4 },
    ];
    
    const hasDivergence = activity.status === 'Recebido com divergência';

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-start justify-between pb-4">
                <div>
                     <CardTitle className="text-lg flex items-center gap-2">
                        <span className="font-mono text-sm text-muted-foreground">#{activity.id.slice(-6)}</span>
                        <span className="font-semibold">{activity.kioskOriginName} → {activity.kioskDestinationName}</span>
                         {hasDivergence && <Badge variant="secondary" className="bg-yellow-500 text-white">Recebido com divergência</Badge>}
                    </CardTitle>
                    <CardDescription>
                        Criado em: {activity.createdAt ? format(parseISO(activity.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : ''}
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <SafePDFDownloadLink activity={activity} products={products} />
                     {activity.transportSignature?.physicalCopyUrl && (
                        <Button variant="outline" size="sm" onClick={() => handleDownloadFile(activity.transportSignature!.physicalCopyUrl!, `despacho_${activity.id.slice(-6)}.jpg`)}>
                            <BadgeCheck className="mr-2 h-4 w-4 text-green-600" /> Doc. assinado
                        </Button>
                    )}
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem className="text-destructive" onClick={() => onCancel(activity)}><Ban className="mr-2 h-4 w-4" /> Cancelar Atividade</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-around w-full">
                    {steps.map((step, index) => {
                        const isCompleted = currentStep > step.step || activity.status === 'Concluído';
                        const isActive = currentStep === step.step;
                        const canGoBack = canRevert && isCompleted && step.step < currentStep && step.step < 4;
                        const isRecebimentoStepCompletedWithDivergence = step.step === 3 && isCompleted && hasDivergence;

                        let stepAction = () => {};
                        let actionLabel = '';

                        if (canGoBack) {
                            if (step.step === 1) { stepAction = () => onToggleSeparated(activity); actionLabel = 'Desfazer Separação'; }
                            else if (step.step === 2) { stepAction = () => onReopenDispatch(activity); actionLabel = 'Reabrir Despacho'; }
                            else if (step.step === 3) { stepAction = () => onReopenAudit(activity); actionLabel = 'Reabrir Auditoria'; }
                        } else if (isActive) {
                            if (step.step === 1) { stepAction = () => onToggleSeparated(activity); actionLabel = 'Marcar como Separado'; }
                            else if (step.step === 2) { stepAction = () => onDispatch(activity); actionLabel = 'Gerenciar Despacho'; }
                            else if (step.step === 3) { stepAction = () => onAudit(activity); actionLabel = 'Auditar Recebimento'; }
                            else if (step.step === 4) { stepAction = () => onFinalize(activity); actionLabel = 'Efetivar Movimentação'; }
                        }
                        
                        const iconColorClass = cn({
                            'bg-green-500 text-white': isCompleted && !isRecebimentoStepCompletedWithDivergence,
                            'bg-yellow-500 text-white': isRecebimentoStepCompletedWithDivergence,
                            'bg-destructive text-white animate-pulse': isActive && hasDivergence,
                            'bg-blue-500 text-white animate-pulse': isActive && !hasDivergence,
                            'bg-muted text-muted-foreground': !isCompleted && !isActive,
                        });

                        const isClickable = isActive || canGoBack;

                        return (
                            <React.Fragment key={step.name}>
                                 <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex flex-col items-center gap-2 text-center">
                                                <Button size="icon" className={cn("rounded-full w-12 h-12 transition-all", iconColorClass, !isClickable && 'pointer-events-none opacity-80')} onClick={stepAction} disabled={!isClickable}>
                                                    {canGoBack ? <Undo2 className="h-6 w-6"/> : <step.icon className="h-6 w-6" />}
                                                </Button>
                                                <span className="text-xs">{step.name}</span>
                                            </div>
                                        </TooltipTrigger>
                                         {actionLabel && <TooltipContent><p>{actionLabel}</p></TooltipContent>}
                                    </Tooltip>
                                </TooltipProvider>
                                {index < steps.length - 1 && <div className={cn("flex-1 h-1 rounded-full", isCompleted ? 'bg-green-500' : 'bg-muted')} />}
                            </React.Fragment>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}

function RepositionManagement() {
  const { activities, loading, cancelRepositionActivity, updateRepositionActivity, finalizeRepositionActivity } = useReposition();
  const { permissions } = useAuth();
  const { products, loading: productsLoading } = useProducts();
  const [activityToDispatch, setActivityToDispatch] = useState<RepositionActivity | null>(null);
  const [activityToAudit, setActivityToAudit] = useState<RepositionActivity | null>(null);
  const [activityToCancel, setActivityToCancel] = useState<RepositionActivity | null>(null);
  const [activityToFinalize, setActivityToFinalize] = useState<RepositionActivity | null>(null);
  const [activityToResolve, setActivityToResolve] = useState<RepositionActivity | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  
  const canRevertSteps = permissions?.reposition?.cancel || false;

  if (loading || productsLoading) return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;

  const activeActivities = activities.filter(a => a.status !== 'Concluído' && a.status !== 'Cancelada');

  if (activeActivities.length === 0) {
    return (
        <Card className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground border-2 border-dashed">
            <Inbox className="h-12 w-12 mb-4" />
            <h3 className="text-xl font-semibold text-foreground">Nenhuma atividade de reposição</h3>
        </Card>
    );
  }
  
  const handleCancelConfirm = async () => {
    if (!activityToCancel) return;
    try {
        await cancelRepositionActivity(activityToCancel.id);
        toast({
            title: "Atividade cancelada",
            description: "A reposição foi cancelada com sucesso.",
        });
        setActivityToCancel(null);
    } catch (error) {
        console.error("Erro ao cancelar atividade:", error);
        toast({
            title: "Erro ao cancelar",
            description: error instanceof Error ? error.message : "Não foi possível cancelar a atividade.",
            variant: "destructive",
        });
    }
  };

  return (
    <>
      <div className="space-y-4">
          {activeActivities.map(activity => (
              <RepositionActivityCard
                  key={activity.id}
                  activity={activity}
                  isSeparated={!!activity.isSeparated}
                  onToggleSeparated={(a) => updateRepositionActivity(a.id, { isSeparated: !a.isSeparated })}
                  onDispatch={setActivityToDispatch}
                  onAudit={setActivityToAudit}
                  onFinalize={(a) => a.status === 'Recebido com divergência' ? setActivityToResolve(a) : setActivityToFinalize(a)}
                  onCancel={setActivityToCancel}
                  onReopenDispatch={(a) => updateRepositionActivity(a.id, { status: 'Aguardando despacho' })}
                  onReopenAudit={(a) => updateRepositionActivity(a.id, { status: 'Aguardando recebimento' })}
                  canRevert={canRevertSteps}
                  products={products ?? []}
              />
          ))}
      </div>
      {activityToDispatch && <DispatchModal activity={activityToDispatch} onOpenChange={() => setActivityToDispatch(null)} />}
      {activityToAudit && <AuditReceiptModal activity={activityToAudit} onOpenChange={() => setActivityToAudit(null)} />}
      {activityToCancel && (
          <DeleteConfirmationDialog 
            open={!!activityToCancel} 
            onOpenChange={() => setActivityToCancel(null)} 
            onConfirm={handleCancelConfirm} 
            itemName="a atividade de reposição" 
          />
      )}
      {activityToFinalize && <DeleteConfirmationDialog open={!!activityToFinalize} onOpenChange={() => setActivityToFinalize(null)} onConfirm={handleFinalizeConfirm} isDeleting={isFinalizing} title="Efetivar movimentação?" confirmButtonText="Sim, efetivar" />}
      {activityToResolve && <ResolveDivergenceModal open={!!activityToResolve} onOpenChange={(open) => !open && setActivityToResolve(null)} activity={activityToResolve} onConfirm={(res) => finalizeRepositionActivity(activityToResolve, res)} isLoading={isFinalizing} />}
    </>
  );
}

function RepositionHistory() {
  const { activities, loading } = useReposition();
  const [statusFilter, setStatusFilter] = useState<'all' | 'Concluído' | 'Cancelada'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());

  const historicalActivities = useMemo(() => {
    return activities.filter(activity => {
        const activityDate = activity.updatedAt ? parseISO(activity.updatedAt) : parseISO(activity.createdAt);
        if (selectedYear !== 'all' && activityDate.getFullYear().toString() !== selectedYear) return false;
        if (selectedMonth !== 'all' && (activityDate.getMonth() + 1).toString() !== selectedMonth) return false;
        if (statusFilter === 'all') return activity.status === 'Concluído' || activity.status === 'Cancelada';
        return activity.status === statusFilter;
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [activities, statusFilter, selectedMonth, selectedYear]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  
  return (
    <Card>
        <CardHeader>
            <CardTitle>Histórico de reposições</CardTitle>
            <div className="pt-2 flex flex-wrap gap-2 items-center">
                <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)} className="w-full sm:w-auto">
                    <TabsList><TabsTrigger value="all">Todos</TabsTrigger><TabsTrigger value="Concluído">Concluídos</TabsTrigger><TabsTrigger value="Cancelada">Cancelados</TabsTrigger></TabsList>
                </Tabs>
            </div>
        </CardHeader>
        <CardContent>
            {historicalActivities.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground"><Inbox className="mx-auto h-12 w-12" /><p className="mt-4 font-semibold">Nenhum registro para este filtro.</p></div>
            ) : (
                <Accordion type="multiple" className="w-full space-y-3">
                    {historicalActivities.map(activity => (
                        <AccordionItem key={activity.id} value={activity.id} className="border rounded-lg">
                            <AccordionTrigger className="p-4 hover:no-underline text-left">
                                <div className="flex justify-between items-center w-full">
                                    <div>
                                        <p className="font-semibold">#{activity.id.slice(-6)} | {activity.kioskOriginName} → {activity.kioskDestinationName}</p>
                                        <p className="text-sm text-muted-foreground">{activity.status}</p>
                                    </div>
                                    <Badge variant={activity.status === 'Cancelada' ? 'destructive' : 'default'}>{activity.status}</Badge>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4 pt-0">
                                <ScrollArea className="h-40">
                                    {activity.items.map((item, idx) => (
                                        <div key={idx} className="text-sm py-1">{item.productName}</div>
                                    ))}
                                </ScrollArea>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            )}
        </CardContent>
    </Card>
  );
}

export default function RepositionPage() {
    const { permissions } = useAuth();
    const router = useRouter();

    if (!permissions?.stock?.analysis?.restock) {
        return <div className="flex items-center justify-center h-full"><div className="text-center py-16 text-muted-foreground"><Inbox className="h-12 w-12 mx-auto mb-4" /><h3 className="text-xl font-semibold">Acesso Negado</h3></div></div>;
    }

    return (
        <div className="space-y-4">
             <div className="mb-4">
                <Button onClick={() => router.push('/dashboard/stock/analysis')} variant="outline"><ArrowLeft className="w-4 h-4 mr-2" /> Voltar para reposição</Button>
            </div>
            <div className="mb-4"><h1 className="text-3xl font-bold">Gerenciamento da reposição</h1></div>
             <Tabs defaultValue="management" className="w-full">
                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="management"><Truck className="mr-2 h-4 w-4" /> Gerenciar reposição</TabsTrigger><TabsTrigger value="history"><History className="mr-2 h-4 w-4" /> Histórico</TabsTrigger></TabsList>
                <TabsContent value="management" className="mt-4"><RepositionManagement /></TabsContent>
                <TabsContent value="history" className="mt-4"><RepositionHistory /></TabsContent>
            </Tabs>
        </div>
    );
}
