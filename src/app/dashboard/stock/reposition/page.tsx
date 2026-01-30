
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dynamic from 'next/dynamic';

import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { type RepositionActivity, type RepositionItem, type RepositionSuggestedLot, type Product } from '@/types';
import { cn } from '@/lib/utils';
import { useProducts } from '@/hooks/use-products';

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Inbox, Truck, AlertTriangle, Trash2, CheckSquare, Undo2, BadgeCheck, Download, Ban, History, ArrowLeft, Package, FileText, MoreHorizontal, ArrowRight, UserCheck } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DispatchModal } from "@/components/dispatch-modal";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { AuditReceiptModal } from "@/components/audit-receipt-modal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SeparationListDocument } from '@/components/pdf/SeparationListDocument';
import { ResolveDivergenceModal } from '@/components/resolve-divergence-modal';
import { type BlobProviderParams } from '@react-pdf/renderer';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="outline" size="sm" className="relative" disabled>Carregando...</Button> }
);


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
            toast({
                title: "Erro no download",
                description: "Não foi possível baixar o arquivo. Tente abrir em uma nova aba.",
                variant: "destructive",
            });
        }
    };

    const currentStep = useMemo(() => {
        switch (activity.status) {
            case 'Aguardando despacho':
                return isSeparated ? 2 : 1; // 1: Separação, 2: Despacho
            case 'Aguardando recebimento':
                return 3; // Recebimento
            case 'Recebido com divergência':
            case 'Recebido sem divergência':
                return 4; // Efetivação
            default:
                return 5; // Concluído/Cancelada (won't be shown)
        }
    }, [activity.status, isSeparated]);

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
                         {hasDivergence && (
                            <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-500 text-white">
                                Recebimento com divergência
                            </Badge>
                        )}
                    </CardTitle>
                    <CardDescription>
                        Criado em: {activity.createdAt ? format(parseISO(activity.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : ''}
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <PDFDownloadLink
                        document={<SeparationListDocument activity={activity} products={products} />}
                        fileName={`separacao_reposicao_${activity.id.slice(-6)}.pdf`}
                    >
                        {(({ loading }: any) => (
                            <Button variant="outline" size="sm" className="relative" disabled={loading}>
                                <FileText className="mr-2 h-4 w-4" />
                                {loading ? 'Gerando...' : 'Doc. de separação'}
                            </Button>
                        )) as any}
                    </PDFDownloadLink>
                     {activity.transportSignature?.physicalCopyUrl && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            const url = activity.transportSignature!.physicalCopyUrl!;
                            let extension = 'jpg';
                            try {
                                const path = new URL(url).pathname;
                                const decodedPath = decodeURIComponent(path);
                                const filename = decodedPath.substring(decodedPath.lastIndexOf('/') + 1);
                                extension = filename.substring(filename.lastIndexOf('.') + 1) || 'jpg';
                            } catch(e) {
                                console.error("Could not parse file extension from URL", e);
                            }
                            handleDownloadFile(url, `despacho_${activity.id.slice(-6)}.${extension}`)
                          }}
                        >
                            <BadgeCheck className="mr-2 h-4 w-4 text-green-600" />
                            Doc. assinado
                        </Button>
                    )}
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onCancel(activity)}>
                                <Ban className="mr-2 h-4 w-4" />
                                <span>Cancelar Atividade</span>
                            </DropdownMenuItem>
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
                            if (step.step === 1) {
                                stepAction = () => onToggleSeparated(activity);
                                actionLabel = 'Desfazer Separação';
                            } else if (step.step === 2) {
                                stepAction = () => onReopenDispatch(activity);
                                actionLabel = 'Reabrir Despacho';
                            } else if (step.step === 3) {
                                stepAction = () => onReopenAudit(activity);
                                actionLabel = 'Reabrir Auditoria';
                            }
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

                        const textColorClass = cn(
                            "text-xs",
                            isActive ? 'font-bold' : 'font-medium',
                            isActive && hasDivergence && 'text-destructive',
                            isActive && !hasDivergence && 'text-blue-600 dark:text-blue-400',
                            isCompleted && isRecebimentoStepCompletedWithDivergence && 'text-yellow-600 font-bold',
                            isCompleted && !isRecebimentoStepCompletedWithDivergence && 'text-foreground',
                            !isCompleted && !isActive && 'text-muted-foreground'
                        );

                        const isClickable = isActive || canGoBack;

                        return (
                            <React.Fragment key={step.name}>
                                 <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="flex flex-col items-center gap-2 text-center">
                                                <Button
                                                    size="icon"
                                                    className={cn(
                                                        "rounded-full w-12 h-12 transition-all duration-300",
                                                        iconColorClass,
                                                        !isClickable && 'pointer-events-none opacity-80',
                                                        isClickable && 'hover:scale-105'
                                                    )}
                                                    onClick={stepAction}
                                                    disabled={!isClickable}
                                                    aria-label={actionLabel}
                                                >
                                                    {canGoBack ? <Undo2 className="h-6 w-6"/> : <step.icon className="h-6 w-6" />}
                                                </Button>
                                                <span className={textColorClass}>{step.name}</span>
                                            </div>
                                        </TooltipTrigger>
                                         {actionLabel && <TooltipContent><p>{actionLabel}</p></TooltipContent>}
                                    </Tooltip>
                                </TooltipProvider>
                                {index < steps.length - 1 && (
                                    <div className={cn("flex-1 h-1 rounded-full", isCompleted ? 'bg-green-500' : 'bg-muted')} />
                                )}
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
  const { products } = useProducts();
  const [activityToDispatch, setActivityToDispatch] = useState<RepositionActivity | null>(null);
  const [activityToAudit, setActivityToAudit] = useState<RepositionActivity | null>(null);
  const [activityToCancel, setActivityToCancel] = useState<RepositionActivity | null>(null);
  const [activityToFinalize, setActivityToFinalize] = useState<RepositionActivity | null>(null);
  const [activityToResolve, setActivityToResolve] = useState<RepositionActivity | null>(null);
  const [activityToReopenDispatch, setActivityToReopenDispatch] = useState<RepositionActivity | null>(null);
  const [activityToReopenAudit, setActivityToReopenAudit] = useState<RepositionActivity | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  
  const canRevertSteps = permissions.reposition.cancel;

  const handleToggleSeparated = async (activity: RepositionActivity) => {
    await updateRepositionActivity(activity.id, {
        isSeparated: !activity.isSeparated
    });
  };

  if (loading) {
    return (
        <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
        </div>
    )
  }

  const activeActivities = activities.filter((activity: RepositionActivity) => activity.status !== 'Concluído' && activity.status !== 'Cancelada');

  if (activeActivities.length === 0) {
    return (
        <Card className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground border-2 border-dashed">
            <Inbox className="h-12 w-12 mb-4" />
            <h3 className="text-xl font-semibold text-foreground">Nenhuma atividade de reposição</h3>
            <p className="max-w-md mt-2">
                Quando uma atividade de reposição for iniciada, ela aparecerá aqui para ser gerenciada.
            </p>
        </Card>
    )
  }
  
  const handleFinalizeClick = (activity: RepositionActivity) => {
    if (activity.status === 'Recebido com divergência') {
      setActivityToResolve(activity);
    } else {
      setActivityToFinalize(activity);
    }
  };

  const handleCancelConfirm = async () => {
    if (activityToCancel) {
        await cancelRepositionActivity(activityToCancel.id);
        setActivityToCancel(null);
    }
  };

  const handleFinalizeConfirm = async () => {
    if (!activityToFinalize) return;
    setIsFinalizing(true);
    await finalizeRepositionActivity(activityToFinalize, 'trust_receipt');
    setIsFinalizing(false);
    setActivityToFinalize(null);
  };
  
  const handleResolveConfirm = async (resolution: 'trust_receipt' | 'trust_dispatch') => {
    if (!activityToResolve) return;
    setIsFinalizing(true);
    await finalizeRepositionActivity(activityToResolve, resolution);
    setIsFinalizing(false);
    setActivityToResolve(null);
  };
  
  const handleReopenDispatchConfirm = async () => {
    if (!activityToReopenDispatch) return;
    await updateRepositionActivity(activityToReopenDispatch.id, {
        status: 'Aguardando despacho',
        transportSignature: undefined,
    });
    setActivityToReopenDispatch(null);
  };

  const handleReopenAuditConfirm = async () => {
    if (!activityToReopenAudit) return;
    await updateRepositionActivity(activityToReopenAudit.id, {
        status: 'Aguardando recebimento',
        receiptNotes: '',
        receiptSignature: undefined,
        items: activityToReopenAudit.items.map(item => ({
            ...item,
            receivedLots: [],
        }))
    });
    setActivityToReopenAudit(null);
  };


  return (
    <>
      <div className="space-y-4">
          {activeActivities.map((activity: RepositionActivity) => (
              <RepositionActivityCard
                  key={activity.id}
                  activity={activity}
                  isSeparated={!!activity.isSeparated}
                  onToggleSeparated={handleToggleSeparated}
                  onDispatch={setActivityToDispatch}
                  onAudit={setActivityToAudit}
                  onFinalize={handleFinalizeClick}
                  onCancel={setActivityToCancel}
                  onReopenDispatch={setActivityToReopenDispatch}
                  onReopenAudit={setActivityToReopenAudit}
                  canRevert={canRevertSteps}
                  products={products}
              />
          ))}
      </div>
      
      {activityToDispatch && (
          <DispatchModal 
              activity={activityToDispatch}
              onOpenChange={() => setActivityToDispatch(null)}
          />
      )}
      
      {activityToAudit && (
          <AuditReceiptModal
              activity={activityToAudit}
              onOpenChange={() => setActivityToAudit(null)}
          />
      )}
      
      {activityToCancel && (
          <DeleteConfirmationDialog
              open={!!activityToCancel}
              onOpenChange={() => setActivityToCancel(null)}
              onConfirm={handleCancelConfirm}
              itemName={`a atividade de reposição`}
              description="Esta ação não pode ser desfeita. O estoque reservado será liberado e a atividade será movida para o histórico como cancelada."
              confirmButtonText="Sim, cancelar atividade"
          />
      )}

      {activityToFinalize && (
          <DeleteConfirmationDialog 
              open={!!activityToFinalize}
              onOpenChange={() => setActivityToFinalize(null)}
              onConfirm={handleFinalizeConfirm}
              isDeleting={isFinalizing}
              title="Efetivar movimentação de estoque?"
              description="Esta ação é irreversível. O estoque será debitado da origem e creditado no destino conforme a auditoria. Deseja continuar?"
              confirmButtonText="Sim, efetivar"
              confirmButtonVariant="default"
          />
      )}

      {activityToResolve && (
        <ResolveDivergenceModal
          open={!!activityToResolve}
          onOpenChange={(open) => !open && setActivityToResolve(null)}
          activity={activityToResolve}
          onConfirm={handleResolveConfirm}
          isLoading={isFinalizing}
        />
      )}

      <DeleteConfirmationDialog
          open={!!activityToReopenDispatch}
          onOpenChange={() => setActivityToReopenDispatch(null)}
          onConfirm={handleReopenDispatchConfirm}
          title="Reabrir Despacho?"
          description="Esta ação irá retornar a atividade para a etapa de despacho, permitindo que a assinatura seja coletada novamente. Deseja continuar?"
          confirmButtonText="Sim, reabrir"
      />
      <DeleteConfirmationDialog
          open={!!activityToReopenAudit}
          onOpenChange={() => setActivityToReopenAudit(null)}
          onConfirm={handleReopenAuditConfirm}
          title="Reabrir Auditoria?"
          description="Esta ação irá apagar a auditoria de recebimento atual e retornar a atividade para a etapa de recebimento. Deseja continuar?"
          confirmButtonText="Sim, reabrir"
      />
      </>
  );
}

function RepositionHistory() {
  const { activities, loading } = useReposition();
  const { products, loading: productsLoading } = useProducts();
  const [statusFilter, setStatusFilter] = useState<'all' | 'Concluído' | 'Cancelada'>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
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
        toast({
            title: "Erro no download",
            description: "Não foi possível baixar o arquivo. Tente abrir em uma nova aba.",
            variant: "destructive",
        });
    }
  };

  const availableYears = useMemo(() => {
    if (activities.length === 0) return [new Date().getFullYear().toString()];
    const years = new Set(activities.map(a => a.updatedAt ? parseISO(a.updatedAt).getFullYear().toString() : parseISO(a.createdAt).getFullYear().toString()));
    return Array.from(years).sort((a,b) => parseInt(b) - parseInt(a));
  }, [activities]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    value: (i + 1).toString(),
    label: format(new Date(2000, i), 'MMMM', { locale: ptBR }),
  })), []);

  const historicalActivities = useMemo(() => {
    return activities.filter((activity: RepositionActivity) => {
        if (!activity.createdAt) return false;
        const activityDate = activity.updatedAt ? parseISO(activity.updatedAt) : parseISO(activity.createdAt);
        
        if (selectedYear !== 'all' && activityDate.getFullYear().toString() !== selectedYear) {
            return false;
        }
        if (selectedMonth !== 'all' && (activityDate.getMonth() + 1).toString() !== selectedMonth) {
            return false;
        }
        
        if (statusFilter === 'all') {
            return activity.status === 'Concluído' || activity.status === 'Cancelada';
        }
        return activity.status === statusFilter;
    }).sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return dateB - dateA;
    });
  }, [activities, statusFilter, selectedMonth, selectedYear]);

  if (loading || productsLoading) return <Skeleton className="h-64 w-full" />;
  
  const hasAnyHistory = activities.some((a) => a.status === 'Concluído' || a.status === 'Cancelada');

  if (!hasAnyHistory) {
         return (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                <History className="mx-auto h-12 w-12" />
                <p className="mt-4 font-semibold">Nenhum histórico encontrado.</p>
            </div>
        );
  }
  
  return (
    <>
        <Card>
            <CardHeader>
                <CardTitle>Histórico de reposições</CardTitle>
                <CardDescription>Consulte todas as atividades de reposição que já foram concluídas ou canceladas.</CardDescription>
                <div className="pt-2 flex flex-wrap gap-2 items-center">
                    <Tabs defaultValue="all" value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)} className="w-full sm:w-auto">
                        <TabsList>
                            <TabsTrigger value="all">Todos</TabsTrigger>
                            <TabsTrigger value="Concluído">Concluídos</TabsTrigger>
                            <TabsTrigger value="Cancelada">Cancelados</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                        <SelectTrigger className="w-full sm:w-auto md:w-[150px]">
                            <SelectValue placeholder="Mês" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os Meses</SelectItem>
                            {months.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={selectedYear} onValueChange={setSelectedYear}>
                        <SelectTrigger className="w-full sm:w-auto md:w-[120px]">
                            <SelectValue placeholder="Ano" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os Anos</SelectItem>
                            {availableYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </CardHeader>
            <CardContent>
                {historicalActivities.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                        <Inbox className="mx-auto h-12 w-12" />
                        <p className="mt-4 font-semibold">Nenhum registro para este filtro.</p>
                    </div>
                ) : (
                    <Accordion type="multiple" className="w-full space-y-3">
                        {historicalActivities.map((activity) => {
                            const finalizer = activity.updatedBy?.username || activity.requestedBy.username;
                            const completionDate = activity.updatedAt || activity.createdAt;

                            const wasDivergent = activity.status === 'Concluído' && activity.items.some(item =>
                                (item.receivedLots && item.receivedLots.length > 0) && (
                                    item.suggestedLots.some(sl => {
                                        const received = item.receivedLots!.find(rl => (rl as any).lotId === sl.lotId);
                                        return !received || (received as any).receivedQuantity !== sl.quantityToMove;
                                    })
                                )
                            );

                            const events: { etapa: string; responsavel: any; data: string }[] = [];
                            if(activity.createdAt) events.push({ etapa: 'Criação', responsavel: activity.requestedBy.username, data: activity.createdAt });
                            if (activity.transportSignature?.signedAt) {
                                events.push({
                                    etapa: 'Despacho',
                                    responsavel: { manager: activity.requestedBy.username, transporter: activity.transportSignature.signedBy },
                                    data: activity.transportSignature.signedAt,
                                });
                            }
                            if (activity.receiptSignature?.signedAt) {
                                events.push({ etapa: 'Recebimento', responsavel: activity.receiptSignature.signedBy, data: activity.receiptSignature.signedAt });
                            }
                            if (activity.status === 'Concluído' && activity.updatedBy && activity.updatedAt) {
                                events.push({ etapa: 'Efetivação', responsavel: activity.updatedBy.username, data: activity.updatedAt });
                            }
                            
                            return (
                            <AccordionItem key={activity.id} value={activity.id} className="border rounded-lg">
                                <AccordionTrigger className="p-4 hover:no-underline text-left">
                                    <div className="flex justify-between items-center w-full">
                                        <div>
                                            <p className="font-semibold text-base flex items-center gap-2">
                                                <span className="font-mono text-sm text-muted-foreground">#{activity.id.slice(-6)}</span> | {activity.kioskOriginName} <ArrowRight className="h-4 w-4" /> {activity.kioskDestinationName}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                {activity.status} em {completionDate ? format(parseISO(completionDate), 'dd/MM/yyyy') : ''} por @{finalizer}
                                            </p>
                                        </div>
                                         <div className="flex flex-col items-end gap-1 text-right">
                                            <Badge variant={activity.status === 'Cancelada' ? 'destructive' : 'default'}>
                                                {activity.status}
                                            </Badge>
                                            {wasDivergent && (
                                                <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-500 text-white">
                                                    Recebimento com divergência
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-4 pt-0 space-y-4">
                                
                                    <div className="flex gap-4 p-4 bg-muted/50 rounded-lg">
                                        <div className="flex flex-col gap-2">
                                            <span className="text-xs font-bold uppercase text-muted-foreground">Documentos da atividade</span>
                                            <div className="flex gap-2">
                                                <PDFDownloadLink
                                                    document={<SeparationListDocument activity={activity} products={products} />}
                                                    fileName={`separacao_reposicao_${activity.id.slice(-6)}.pdf`}
                                                >
                                                    {(({ loading }: { loading: boolean }): React.ReactNode => (
                                                        <Button variant="outline" size="sm" disabled={loading}>
                                                            <FileText className="mr-2 h-4 w-4" /> {loading ? 'Gerando...' : 'PDF de separação'}
                                                        </Button>
                                                    )) as any}
                                                </PDFDownloadLink>
                                                {activity.transportSignature?.physicalCopyUrl && (
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm"
                                                        onClick={() => {
                                                            const url = activity.transportSignature!.physicalCopyUrl!;
                                                            let extension = 'jpg';
                                                            try {
                                                                const path = new URL(url).pathname;
                                                                const decodedPath = decodeURIComponent(path);
                                                                const filename = decodedPath.substring(decodedPath.lastIndexOf('/') + 1);
                                                                extension = filename.substring(filename.lastIndexOf('.') + 1) || 'jpg';
                                                            } catch(e) {}
                                                            handleDownloadFile(url, `despacho_reposicao_${activity.id.slice(-6)}.${extension}`)
                                                        }}
                                                    >
                                                        <Download className="mr-2 h-4 w-4" /> Comprovante de despacho
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {activity.receiptNotes && (
                                        <blockquote className="mt-2 border-l-2 pl-4 italic text-sm text-muted-foreground">
                                            <strong>Notas do recebimento:</strong> "{activity.receiptNotes}"
                                        </blockquote>
                                    )}

                                    <div className="rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Insumo</TableHead>
                                                    <TableHead>Lote</TableHead>
                                                    <TableHead className="text-center">Qtd. enviada</TableHead>
                                                    <TableHead className="text-center">Qtd. recebida</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {activity.items.flatMap((item: RepositionItem) => 
                                                    item.suggestedLots.map((lot: RepositionSuggestedLot) => {
                                                        const receivedLot = activity.items.flatMap((i: RepositionItem) => i.receivedLots || []).find((rl: RepositionSuggestedLot) => rl.lotId === lot.lotId);
                                                        const receivedQty = (receivedLot as any)?.receivedQuantity;
                                                        const sentQty = lot.quantityToMove;
                                                        const isDivergent = receivedQty !== undefined && sentQty !== receivedQty;

                                                        return (
                                                            <TableRow key={lot.lotId} className={cn(isDivergent && "bg-destructive/10")}>
                                                                <TableCell className="font-medium">{lot.productName}</TableCell>
                                                                <TableCell>{lot.lotNumber}</TableCell>
                                                                <TableCell className="text-center">{sentQty}</TableCell>
                                                                <TableCell className={cn("text-center font-bold", isDivergent && "text-destructive")}>
                                                                    {receivedQty ?? '-'}
                                                                </TableCell>
                                                            </TableRow>
                                                        )
                                                    })
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    <div>
                                        <h4 className="font-semibold text-md mb-2">Histórico de eventos</h4>
                                        <div className="rounded-md border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Etapa</TableHead>
                                                        <TableHead>Responsável</TableHead>
                                                        <TableHead>Data e Hora</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {events.map(event => (
                                                        <TableRow key={event.etapa}>
                                                            <TableCell className="font-medium">{event.etapa}</TableCell>
                                                            <TableCell>
                                                                {typeof event.responsavel === 'object' && event.responsavel !== null ? (
                                                                    <div>
                                                                        <div className="flex items-center gap-1">
                                                                            <UserCheck className="h-3 w-3 text-muted-foreground" />
                                                                            {event.responsavel.manager} (Resp.)
                                                                        </div>
                                                                        <div className="flex items-center gap-1">
                                                                            <Truck className="h-3 w-3 text-muted-foreground" />
                                                                            {event.responsavel.transporter} (Transp.)
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-1">
                                                                        <UserCheck className="h-3 w-3 text-muted-foreground" />
                                                                        {event.responsavel}
                                                                    </div>
                                                                )}
                                                            </TableCell>
                                                            <TableCell>{event.data ? format(parseISO(event.data), 'dd/MM/yyyy HH:mm') : ''}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>

                                </AccordionContent>
                            </AccordionItem>
                        )})}
                    </Accordion>
                )}
            </CardContent>
        </Card>
    </>
  );
}

export default function RepositionPage() {
    const router = useRouter();

    return (
        <div className="space-y-4">
             <div className="mb-4">
                <Button 
                    onClick={() => router.push('/dashboard/stock/analysis')}
                    variant="outline"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para reposição
                </Button>
            </div>
            <div className="mb-4">
                <h1 className="text-3xl font-bold">Gerenciamento da reposição</h1>
            </div>
             <Tabs defaultValue="management" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="management"><Truck className="mr-2 h-4 w-4" /> Gerenciar reposição</TabsTrigger>
                    <TabsTrigger value="history"><History className="mr-2 h-4 w-4" /> Histórico</TabsTrigger>
                </TabsList>
                <TabsContent value="management" className="mt-4">
                    <RepositionManagement />
                </TabsContent>
                <TabsContent value="history" className="mt-4">
                    <RepositionHistory />
                </TabsContent>
            </Tabs>
        </div>
    );
}
