
"use client";

import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dynamic from 'next/dynamic';

import { useReposition } from '@/hooks/use-reposition';
import { useAuth } from '@/hooks/use-auth';
import { type RepositionActivity, type RepositionItem, type RepositionSuggestedLot, type Product } from '@/types';
import { cn } from '@/lib/utils';
import { useProducts } from '@/hooks/use-products';
import SignatureCanvas from "react-signature-canvas";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Inbox, Truck, AlertTriangle, Trash2, CheckSquare, Undo2, BadgeCheck, Download, Ban, History, ArrowLeft, Package, FileText, MoreHorizontal, ArrowRight, UserCheck, Send, PenLine } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SeparationListDocument } from '@/components/pdf/SeparationListDocument';
import { ResolveDivergenceModal } from './resolve-divergence-modal';
import { type BlobProviderParams } from '@react-pdf/renderer';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="outline" size="sm" className="relative" disabled>Carregando...</Button> }
);


function RepositionActivityCard({ 
  activity, 
  isSeparated,
  onToggleSeparated,
  onToggleSeparationItem,
  onConfirmDispatch,
  onConfirmReceipt,
  onFinalize,
  onCancel,
  onReopenDispatch,
  onReopenAudit,
  canManagePreparation,
  canReceive,
  canFinalizeStep,
  canRevert,
  products
}: { 
  activity: RepositionActivity; 
  isSeparated: boolean;
  onToggleSeparated: (activity: RepositionActivity) => void;
  onToggleSeparationItem: (activity: RepositionActivity, checklistKey: string, checked: boolean) => void;
  onConfirmDispatch: (activity: RepositionActivity, transporterName: string, signatureDataUrl: string) => void;
  onConfirmReceipt: (
    activity: RepositionActivity,
    rows: Record<string, { receivedQuantity: number; receiptNotes?: string }>
  ) => void;
  onFinalize: (activity: RepositionActivity) => void;
  onCancel: (activity: RepositionActivity) => void;
  onReopenDispatch: (activity: RepositionActivity) => void;
  onReopenAudit: (activity: RepositionActivity) => void;
  canManagePreparation: boolean;
  canReceive: boolean;
  canFinalizeStep: boolean;
  canRevert: boolean;
  products: Product[];
}) {
    const { toast } = useToast();
    const signatureRef = useRef<SignatureCanvas | null>(null);
    const [transporterName, setTransporterName] = useState(activity.transportSignature?.signedBy ?? "");
    const [signatureDataUrl, setSignatureDataUrl] = useState(activity.transportSignature?.dataUrl ?? "");

    useEffect(() => {
        setTransporterName(activity.transportSignature?.signedBy ?? "");
        setSignatureDataUrl(activity.transportSignature?.dataUrl ?? "");
    }, [activity.id, activity.transportSignature?.signedBy, activity.transportSignature?.dataUrl]);

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

    const separationRows = activity.items.flatMap((item) =>
        item.suggestedLots.map((lot) => ({
            key: `${item.baseProductId}:${lot.lotId}`,
            item,
            lot,
        }))
    );
    const checkedRows = separationRows.filter((row) => !!activity.separationChecklist?.[row.key]).length;
    const allRowsChecked = separationRows.length > 0 && checkedRows === separationRows.length;
    const initialReceiptRows = useMemo(() => {
        return separationRows.reduce<Record<string, { receivedQuantity: number; receiptNotes?: string }>>((acc, { key, item, lot }) => {
            const receivedLot = item.receivedLots?.find((received) => received.lotId === lot.lotId);
            acc[key] = {
                receivedQuantity: receivedLot?.receivedQuantity ?? lot.quantityToMove,
                receiptNotes: receivedLot?.receiptNotes ?? "",
            };
            return acc;
        }, {});
    }, [activity.id, activity.items]);
    const [receiptRows, setReceiptRows] = useState<Record<string, { receivedQuantity: number; receiptNotes?: string }>>(initialReceiptRows);

    const currentStep = useMemo(() => {
        switch (activity.status) {
            case 'Aguardando despacho':
                return isSeparated && allRowsChecked ? 2 : 1; // 1: Separação, 2: Despacho
            case 'Aguardando recebimento':
                return 3; // Recebimento
            case 'Recebido com divergência':
            case 'Recebido sem divergência':
                return 4; // Efetivação
            default:
                return 5; // Concluído/Cancelada (won't be shown)
        }
    }, [activity.status, isSeparated, allRowsChecked]);

    const steps = [
        { name: 'Separação', icon: Package, step: 1 },
        { name: 'Despacho', icon: Truck, step: 2 },
        { name: 'Recebimento', icon: Inbox, step: 3 },
        { name: 'Efetivação', icon: CheckSquare, step: 4 },
    ];
    
    const hasDivergence = activity.status === 'Recebido com divergência';
    const [selectedStep, setSelectedStep] = useState(1);
    const [selectedByNumberNav, setSelectedByNumberNav] = useState(false);
    const isSelectedStepEditable = selectedStep === currentStep || !selectedByNumberNav;
    const canEditStep = (step: number) => {
        if (!isSelectedStepEditable) return false;
        if (step === 1 || step === 2) return canManagePreparation;
        if (step === 3) return canReceive;
        if (step === 4) return canFinalizeStep;
        return false;
    };
    const canNavigateProgressForEdit = (step: number) => {
        if (step > currentStep) return false;
        if (step === currentStep) return true;
        if (step === 1 || step === 2) return canManagePreparation;
        if (step === 3) return canReceive;
        if (step === 4) return canFinalizeStep;
        return false;
    };
    const receiptHasDivergence = separationRows.some(({ key, lot }) => (receiptRows[key]?.receivedQuantity ?? 0) !== lot.quantityToMove);
    const receiptHasMissingDivergenceNotes = separationRows.some(({ key, lot }) => {
        const row = receiptRows[key];
        if (!row || row.receivedQuantity === lot.quantityToMove) return false;
        return !row.receiptNotes?.trim();
    });
    const receiptSummary = separationRows.map(({ key, item, lot }) => {
        const receivedQuantity = receiptRows[key]?.receivedQuantity ?? 0;
        return {
            key,
            item,
            lot,
            receivedQuantity,
            difference: receivedQuantity - lot.quantityToMove,
            notes: receiptRows[key]?.receiptNotes ?? "",
        };
    });
    const productById = useMemo(() => {
        return new Map(products.map((product) => [product.id, product]));
    }, [products]);
    const getLotImage = (lot: RepositionSuggestedLot) => productById.get(lot.productId)?.imageUrl;

    useEffect(() => {
        setSelectedStep(Math.min(currentStep, 4));
        setSelectedByNumberNav(false);
    }, [activity.id, currentStep]);

    useEffect(() => {
        setReceiptRows(initialReceiptRows);
    }, [initialReceiptRows]);

    return (
        <Card className="w-full">
            <CardHeader className="flex flex-row items-start justify-between pb-4">
                <div>
                     <CardTitle className="text-lg flex items-center gap-2">
                        <span className="font-semibold">{activity.kioskOriginName} → {activity.kioskDestinationName}</span>
                         {hasDivergence && (
                            <Badge variant="secondary" className="bg-yellow-500 hover:bg-yellow-500 text-white">
                                Recebimento com divergência
                            </Badge>
                        )}
                    </CardTitle>
                    <CardDescription>
                        Criado em: {activity.createdAt ? format(parseISO(activity.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : ''} | <span className="font-mono">#{activity.id.slice(-6)}</span>
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <PDFDownloadLink
                        document={<SeparationListDocument activity={activity} products={products} />}
                        fileName={`${activity.kioskDestinationName || 'Reposição'} | Reposição | ${(activity.updatedAt || activity.createdAt) ? format(parseISO(activity.updatedAt || activity.createdAt), 'dd-MM-yyyy', { locale: ptBR }) : ''}.pdf`}
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
                        const isSelected = selectedStep === step.step;
                        const canProgressNavigate = canNavigateProgressForEdit(step.step);
                        const isRecebimentoStepCompletedWithDivergence = step.step === 3 && isCompleted && hasDivergence;
                        
                        const iconColorClass = cn({
                            'bg-green-500 text-white': isCompleted && !isRecebimentoStepCompletedWithDivergence,
                            'bg-yellow-500 text-white': isRecebimentoStepCompletedWithDivergence,
                            'bg-destructive text-white': isActive && hasDivergence,
                            'bg-blue-500 text-white': isActive && !hasDivergence,
                            'bg-muted text-muted-foreground': !isCompleted && !isActive,
                            'ring-4 ring-primary/20': isSelected && !selectedByNumberNav,
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

                        return (
                            <React.Fragment key={step.name}>
                                <div className="flex flex-col items-center gap-2 text-center">
                                    <Button
                                        type="button"
                                        size="icon"
                                        className={cn("rounded-full w-12 h-12 transition-all duration-300 hover:scale-105", iconColorClass)}
                                        onClick={() => {
                                            if (!canProgressNavigate) return;
                                            setSelectedStep(step.step);
                                            setSelectedByNumberNav(false);
                                        }}
                                        disabled={!canProgressNavigate}
                                        aria-label={`Ir para etapa ${step.name}`}
                                    >
                                        <step.icon className="h-6 w-6" />
                                    </Button>
                                    <span className={textColorClass}>{step.name}</span>
                                </div>
                                {index < steps.length - 1 && (
                                    <div className={cn("flex-1 h-1 rounded-full", isCompleted ? 'bg-green-500' : 'bg-muted')} />
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                <div className="mt-6 rounded-xl border bg-background p-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {steps.map((step) => {
                            const isSelected = selectedStep === step.step && selectedByNumberNav;
                            const canViewStep = step.step <= currentStep;
                            return (
                                <Button
                                    key={`number-nav-${step.step}`}
                                    type="button"
                                    variant={isSelected ? "default" : "ghost"}
                                    className={cn(
                                        "h-10 rounded-lg px-4 text-sm font-semibold",
                                        isSelected && "bg-primary text-primary-foreground"
                                    )}
                                    onClick={() => {
                                        if (!canViewStep) return;
                                        setSelectedStep(step.step);
                                        setSelectedByNumberNav(true);
                                    }}
                                    disabled={!canViewStep}
                                >
                                    {step.step}. {step.name}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                {selectedByNumberNav && selectedStep !== currentStep && (
                    <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                        Visualização congelada. Para editar, volte pela linha de progresso até esta etapa.
                    </div>
                )}

                {selectedStep === 1 && (
                <div className="mt-6 overflow-hidden rounded-2xl border bg-background">
                    <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-start gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">1</span>
                            <div>
                                <h4 className="font-semibold">Separação dos itens</h4>
                                <p className="text-xs text-muted-foreground">
                                    Confira fisicamente cada item e marque o que já foi separado.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="bg-red-50 text-red-600">Saída: {activity.kioskOriginName}</Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            <Badge variant="secondary" className="bg-green-50 text-green-700">Entrada: {activity.kioskDestinationName}</Badge>
                            <Badge variant={allRowsChecked ? "default" : "outline"} className="ml-0 md:ml-2">
                                {checkedRows}/{separationRows.length} separados
                            </Badge>
                        </div>
                    </div>
                    <div className="p-5">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {separationRows.map(({ key, item, lot }) => {
                                const checked = !!activity.separationChecklist?.[key];
                                const lotImage = getLotImage(lot);

                                return (
                                    <div
                                        key={key}
                                        className={cn(
                                            "flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors",
                                            checked && "border-green-200 bg-green-50"
                                        )}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(value) => onToggleSeparationItem(activity, key, value === true)}
                                            disabled={!canEditStep(1)}
                                            aria-label={`Separar ${item.productName}`}
                                        />
                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                                            {lotImage ? (
                                                <img src={lotImage} alt={lot.productName} className="h-full w-full object-cover" />
                                            ) : (
                                                <Package className="h-5 w-5 text-muted-foreground" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className={cn("truncate text-sm font-semibold", checked && "text-muted-foreground line-through")}>
                                                {item.productName}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">{lot.productName}</div>
                                            <div className="mt-0.5 text-xs text-muted-foreground">Lote {lot.lotNumber || "-"}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-base font-bold tabular-nums">{lot.quantityToMove}</div>
                                            {item.fulfillmentDivergence ? (
                                                <div className="mt-1 max-w-[140px] truncate text-[11px] text-amber-700" title={`${item.fulfillmentDivergence.reason}${item.fulfillmentDivergence.notes ? `: ${item.fulfillmentDivergence.notes}` : ""}`}>
                                                    {item.fulfillmentDivergence.reason}
                                                </div>
                                            ) : (
                                                <div className="mt-1 text-[11px] text-muted-foreground">sem divergência</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
                )}

                {selectedStep === 2 && (
                    <div className="mt-6 overflow-hidden rounded-2xl border bg-background">
                        <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex items-start gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">2</span>
                                <div>
                                    <h4 className="font-semibold">Gerenciar despacho</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Confira os itens transportados e registre os dados do transporte.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className="bg-red-50 text-red-600">Saída: {activity.kioskOriginName}</Badge>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="secondary" className="bg-green-50 text-green-700">Entrada: {activity.kioskDestinationName}</Badge>
                            </div>
                        </div>

                        <div className="space-y-4 p-5">
                            <div>
                                <div className="mb-2 text-sm font-semibold">Conferência dos itens</div>
                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                    {separationRows.map(({ key, item, lot }) => {
                                        const lotImage = getLotImage(lot);

                                        return (
                                            <div key={`dispatch-${key}`} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                                                    {lotImage ? (
                                                        <img src={lotImage} alt={lot.productName} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <Package className="h-5 w-5 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate text-sm font-semibold">{item.productName}</div>
                                                    <div className="truncate text-xs text-muted-foreground">{lot.productName}</div>
                                                    <div className="mt-0.5 text-xs text-muted-foreground">Lote {lot.lotNumber || "-"}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-base font-bold tabular-nums">{lot.quantityToMove}</div>
                                                    <div className="text-[11px] text-muted-foreground">a mover</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3 rounded-xl border bg-muted/10 p-4">
                                <div className="text-sm font-semibold">Dados do transporte</div>
                                <div>
                                    <Label htmlFor={`transporter-${activity.id}`}>Transportador</Label>
                                    <Input
                                        id={`transporter-${activity.id}`}
                                        value={transporterName}
                                        onChange={(event) => setTransporterName(event.target.value)}
                                        placeholder="Nome completo"
                                        disabled={!canEditStep(2)}
                                    />
                                </div>

                                <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
                                    <div>
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <Label>Assinatura do transportador</Label>
                                            {signatureDataUrl && <Badge variant="outline">Assinado</Badge>}
                                        </div>
                                        <div className="overflow-hidden rounded-xl border bg-white">
                                            {signatureDataUrl ? (
                                                <img src={signatureDataUrl} alt="Assinatura do transportador" className="h-36 w-full object-contain" />
                                            ) : (
                                                <SignatureCanvas
                                                    ref={signatureRef}
                                                    canvasProps={{ className: cn("h-36 w-full", !canEditStep(2) && "pointer-events-none opacity-60") }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 xl:min-w-[260px] xl:justify-end">
                                        {signatureDataUrl ? (
                                            <Button type="button" variant="outline" size="sm" onClick={() => {
                                                setSignatureDataUrl("");
                                                signatureRef.current?.clear();
                                            }} disabled={!canEditStep(2)}>
                                                Refazer assinatura
                                            </Button>
                                        ) : (
                                            <>
                                                <Button type="button" variant="outline" size="sm" onClick={() => signatureRef.current?.clear()} disabled={!canEditStep(2)}>
                                                    Limpar
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={!canEditStep(2)}
                                                    onClick={() => {
                                                        if (!signatureRef.current || signatureRef.current.isEmpty()) {
                                                            toast({
                                                                title: "Assinatura obrigatória",
                                                                description: "Peça para o transportador assinar antes de salvar.",
                                                                variant: "destructive",
                                                            });
                                                            return;
                                                        }
                                                        setSignatureDataUrl(signatureRef.current.toDataURL("image/png"));
                                                    }}
                                                >
                                                    <PenLine className="mr-2 h-4 w-4" />
                                                    Salvar assinatura
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <Button
                                    className="w-full"
                                    disabled={!canEditStep(2) || !transporterName.trim() || !signatureDataUrl}
                                    onClick={() => onConfirmDispatch(activity, transporterName.trim(), signatureDataUrl)}
                                >
                                    <Send className="mr-2 h-4 w-4" />
                                    Confirmar despacho
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {selectedStep === 3 && (
                    <div className="mt-6 overflow-hidden rounded-2xl border bg-background">
                        <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex items-start gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">3</span>
                                <div>
                                    <h4 className="font-semibold">Auditar recebimento</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Confirme a quantidade efetivamente recebida em cada lote.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className="bg-red-50 text-red-600">Saída: {activity.kioskOriginName}</Badge>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="secondary" className="bg-green-50 text-green-700">Entrada: {activity.kioskDestinationName}</Badge>
                                {receiptHasDivergence && <Badge variant="secondary" className="bg-red-50 text-red-600">Divergência</Badge>}
                            </div>
                        </div>
                        <div className="space-y-3 p-5">
                            {receiptSummary.map(({ key, item, lot, receivedQuantity, difference, notes }) => {
                                const lotImage = getLotImage(lot);

                                return (
                                    <div
                                        key={`receipt-${key}`}
                                        className={cn(
                                            "rounded-xl border bg-card p-3",
                                            difference !== 0 && "border-red-200 bg-red-50/50"
                                        )}
                                    >
                                        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_minmax(220px,320px)] lg:items-center">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                                                    {lotImage ? (
                                                        <img src={lotImage} alt={lot.productName} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <Package className="h-5 w-5 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold">{item.productName}</div>
                                                    <div className="truncate text-xs text-muted-foreground">{lot.productName}</div>
                                                    <div className="mt-0.5 text-xs text-muted-foreground">Lote {lot.lotNumber || "-"}</div>
                                                </div>
                                            </div>
                                            <div className="rounded-lg border bg-background px-3 py-2">
                                                <div className="text-[11px] font-semibold uppercase text-muted-foreground">Enviado</div>
                                                <div className="text-lg font-bold tabular-nums">{lot.quantityToMove}</div>
                                            </div>
                                            <div>
                                                <Label className="text-[11px] font-semibold uppercase text-muted-foreground">Recebido</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    value={Number.isFinite(receivedQuantity) ? receivedQuantity : 0}
                                                    disabled={!canEditStep(3)}
                                                    className="mt-1 h-10 text-right font-semibold"
                                                    onChange={(event) => {
                                                        const value = Number(event.target.value);
                                                        setReceiptRows((current) => ({
                                                            ...current,
                                                            [key]: {
                                                                ...(current[key] ?? {}),
                                                                receivedQuantity: Number.isFinite(value) ? value : 0,
                                                            },
                                                        }));
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        <Textarea
                                            value={notes}
                                            disabled={!canEditStep(3)}
                                            rows={1}
                                            className="mt-3"
                                            placeholder={difference === 0 ? "Observação opcional" : "Observação obrigatória para divergência"}
                                            onChange={(event) => {
                                                setReceiptRows((current) => ({
                                                    ...current,
                                                    [key]: {
                                                        ...(current[key] ?? { receivedQuantity }),
                                                        receiptNotes: event.target.value,
                                                    },
                                                }));
                                            }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-between border-t px-5 py-4">
                            <div className={cn("text-sm font-medium", receiptHasDivergence ? "text-red-600" : "text-muted-foreground")}>
                                {receiptHasDivergence ? "Recebimento com divergência" : "Recebimento sem divergência"}
                            </div>
                            <Button
                                disabled={!canEditStep(3) || receiptHasMissingDivergenceNotes}
                                onClick={() => {
                                    if (receiptHasMissingDivergenceNotes) {
                                        toast({
                                            title: "Justificativa obrigatória",
                                            description: "Informe a observação dos itens recebidos com quantidade diferente da enviada.",
                                            variant: "destructive",
                                        });
                                        return;
                                    }
                                    onConfirmReceipt(activity, receiptRows);
                                }}
                            >
                                <UserCheck className="mr-2 h-4 w-4" />
                                Confirmar recebimento
                            </Button>
                        </div>
                    </div>
                )}

                {selectedStep === 4 && (
                    <div className="mt-6 overflow-hidden rounded-2xl border bg-background">
                        <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex items-start gap-3">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">4</span>
                                <div>
                                    <h4 className="font-semibold">Efetivação</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Confira o histórico antes de debitar a origem e creditar o destino.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" className="bg-red-50 text-red-600">Saída: {activity.kioskOriginName}</Badge>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="secondary" className="bg-green-50 text-green-700">Entrada: {activity.kioskDestinationName}</Badge>
                            </div>
                        </div>

                        <div className="grid gap-4 p-5 xl:grid-cols-[360px_1fr]">
                            <div className="rounded-xl border bg-muted/10 p-4">
                                <h5 className="text-sm font-semibold">Histórico do processo</h5>
                                <div className="mt-4 space-y-3">
                                    {[
                                        {
                                            title: "1. Separação",
                                            detail: activity.separationSignature?.signedBy
                                                ? `${activity.separationSignature.signedBy} em ${activity.separationSignature.signedAt ? format(parseISO(activity.separationSignature.signedAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "-"}`
                                                : activity.isSeparated
                                                    ? `Responsável não registrado (${checkedRows}/${separationRows.length} itens marcados)`
                                                    : `${checkedRows}/${separationRows.length} itens marcados`,
                                        },
                                        {
                                            title: "2. Despacho",
                                            detail: activity.transportSignature?.signedBy
                                                ? `${activity.transportSignature.signedBy} em ${activity.transportSignature.signedAt ? format(parseISO(activity.transportSignature.signedAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "-"}`
                                                : "Não registrado",
                                        },
                                        {
                                            title: "3. Recebimento",
                                            detail: activity.receiptSignature?.signedBy
                                                ? `${activity.receiptSignature.signedBy} em ${activity.receiptSignature.signedAt ? format(parseISO(activity.receiptSignature.signedAt), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "-"}`
                                                : "Não registrado",
                                        },
                                    ].map((entry) => (
                                        <div key={entry.title} className="rounded-lg border bg-background p-3">
                                            <div className="text-sm font-semibold">{entry.title}</div>
                                            <div className="mt-1 text-sm text-muted-foreground">{entry.detail}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {activity.items.flatMap((item) =>
                                    item.suggestedLots.map((lot) => {
                                        const receivedLot = item.receivedLots?.find((received) => received.lotId === lot.lotId);
                                        const receivedQuantity = receivedLot?.receivedQuantity ?? 0;
                                        const difference = receivedQuantity - lot.quantityToMove;
                                        const lotImage = getLotImage(lot);

                                        return (
                                            <div
                                                key={`final-${item.baseProductId}-${lot.lotId}`}
                                                className={cn(
                                                    "grid gap-3 rounded-xl border bg-card p-3 md:grid-cols-[minmax(260px,1fr)_120px_120px_120px_minmax(180px,1fr)] md:items-center",
                                                    difference !== 0 && "border-amber-200 bg-amber-50/40"
                                                )}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                                                        {lotImage ? (
                                                            <img src={lotImage} alt={lot.productName} className="h-full w-full object-cover" />
                                                        ) : (
                                                            <Package className="h-5 w-5 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-semibold">{item.productName}</div>
                                                        <div className="truncate text-xs text-muted-foreground">{lot.productName}</div>
                                                        <div className="mt-0.5 text-xs text-muted-foreground">Lote {lot.lotNumber || "-"}</div>
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] uppercase text-muted-foreground">Enviado</div>
                                                    <div className="font-bold tabular-nums">{lot.quantityToMove}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] uppercase text-muted-foreground">Recebido</div>
                                                    <div className="font-bold tabular-nums">{receivedQuantity}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] uppercase text-muted-foreground">Dif.</div>
                                                    <div className={cn("font-bold tabular-nums", difference !== 0 && "text-amber-700")}>{difference > 0 ? `+${difference}` : difference}</div>
                                                </div>
                                                <div className="text-sm text-muted-foreground">{receivedLot?.receiptNotes || "Sem divergência"}</div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end border-t px-5 py-4">
                            <Button onClick={() => onFinalize(activity)} disabled={!canEditStep(4)}>
                                Efetivar movimentação
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}


export function RepositionManagement() {
  const { activities, loading, cancelRepositionActivity, updateRepositionActivity, finalizeRepositionActivity } = useReposition();
  const { permissions, user } = useAuth();
  const { toast } = useToast();
  const { products } = useProducts();
  const [activityToCancel, setActivityToCancel] = useState<RepositionActivity | null>(null);
  const [activityToFinalize, setActivityToFinalize] = useState<RepositionActivity | null>(null);
  const [activityToResolve, setActivityToResolve] = useState<RepositionActivity | null>(null);
  const [activityToReopenDispatch, setActivityToReopenDispatch] = useState<RepositionActivity | null>(null);
  const [activityToReopenAudit, setActivityToReopenAudit] = useState<RepositionActivity | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  
  const canManagePreparation = permissions.reposition.prepareDispatch || permissions.stock.analysis.restock || permissions.stock.inventoryControl.transfer;
  const canFinalizeStep = permissions.reposition.finalize || permissions.stock.stockCount.approve || permissions.stock.inventoryControl.transfer || permissions.reposition.cancel;
  const canRevertSteps = permissions.reposition.cancel;

  const handleToggleSeparated = async (activity: RepositionActivity) => {
    if (!activity.isSeparated) {
      const checklistKeys = activity.items.flatMap((item) =>
        item.suggestedLots.map((lot) => `${item.baseProductId}:${lot.lotId}`)
      );
      const allChecked = checklistKeys.length > 0 && checklistKeys.every((key) => activity.separationChecklist?.[key]);

      if (!allChecked) {
        toast({
          title: "Checklist incompleto",
          description: "Marque todos os itens separados antes de avançar para despacho.",
          variant: "destructive",
        });
        return;
      }
    }

    await updateRepositionActivity(activity.id, {
        isSeparated: !activity.isSeparated
    });
  };

  const handleToggleSeparationItem = async (
    activity: RepositionActivity,
    checklistKey: string,
    checked: boolean
  ) => {
    const nextChecklist = {
      ...(activity.separationChecklist ?? {}),
      [checklistKey]: checked,
    };
    const allChecklistKeys = activity.items.flatMap((item) =>
      item.suggestedLots.map((lot) => `${item.baseProductId}:${lot.lotId}`)
    );
    const isSeparated = allChecklistKeys.length > 0 && allChecklistKeys.every((key) => nextChecklist[key]);

    await updateRepositionActivity(activity.id, {
      separationChecklist: nextChecklist,
      isSeparated,
      separationSignature: isSeparated
        ? {
            signedBy: user?.username ?? user?.email ?? "Usuário",
            signedAt: new Date().toISOString(),
          }
        : null as any,
    });
  };

  const handleConfirmDispatch = async (
    activity: RepositionActivity,
    transporterName: string,
    signatureDataUrl: string
  ) => {
    await updateRepositionActivity(activity.id, {
      status: "Aguardando recebimento",
      separationSignature: activity.separationSignature ?? {
        signedBy: user?.username ?? user?.email ?? "Usuário",
        signedAt: new Date().toISOString(),
      },
      transportSignature: {
        signedBy: transporterName,
        signedAt: new Date().toISOString(),
        dataUrl: signatureDataUrl,
      },
    });
    toast({
      title: "Despacho confirmado",
      description: "A reposição avançou para a etapa de recebimento.",
    });
  };

  const handleConfirmReceipt = async (
    activity: RepositionActivity,
    rows: Record<string, { receivedQuantity: number; receiptNotes?: string }>
  ) => {
    const receivedItems = activity.items.map((item) => {
      const receivedLots = item.suggestedLots.map((lot) => {
        const key = `${item.baseProductId}:${lot.lotId}`;
        const row = rows[key];

        return {
          ...lot,
          receivedQuantity: Math.max(0, Number(row?.receivedQuantity ?? 0)),
          receiptNotes: row?.receiptNotes?.trim() || undefined,
        };
      });

      return {
        ...item,
        receivedLots,
      };
    });

    const hasReceiptDivergence = receivedItems.some((item) =>
      item.suggestedLots.some((lot) => {
        const receivedLot = item.receivedLots?.find((received) => received.lotId === lot.lotId);
        return (receivedLot?.receivedQuantity ?? 0) !== lot.quantityToMove;
      })
    );

    await updateRepositionActivity(activity.id, {
      status: hasReceiptDivergence ? "Recebido com divergência" : "Recebido sem divergência",
      items: receivedItems,
      receiptSignature: {
        signedBy: user?.username ?? user?.email ?? "Usuário",
        signedAt: new Date().toISOString(),
      },
    });

    toast({
      title: "Recebimento confirmado",
      description: hasReceiptDivergence
        ? "A reposição avançou para efetivação com divergência registrada."
        : "A reposição avançou para efetivação sem divergência.",
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
    }
  };

  const handleFinalizeConfirm = async () => {
    if (!activityToFinalize) return;
    setIsFinalizing(true);
    try {
      await finalizeRepositionActivity(activityToFinalize, 'trust_receipt');
      toast({
        title: "Movimentação efetivada",
        description: "O estoque foi debitado da origem e creditado no destino.",
      });
      setActivityToFinalize(null);
    } catch (error) {
      console.error("Erro ao efetivar reposição:", error);
      toast({
        title: "Erro ao efetivar",
        description: error instanceof Error ? error.message : "Não foi possível efetivar a reposição.",
        variant: "destructive",
      });
    } finally {
      setIsFinalizing(false);
    }
  };
  
  const handleResolveConfirm = async (resolution: 'trust_receipt' | 'trust_dispatch') => {
    if (!activityToResolve) return;
    setIsFinalizing(true);
    try {
      await finalizeRepositionActivity(activityToResolve, resolution);
      toast({
        title: "Movimentação efetivada",
        description: "A divergência foi resolvida e o estoque foi atualizado.",
      });
      setActivityToResolve(null);
    } catch (error) {
      console.error("Erro ao resolver divergência:", error);
      toast({
        title: "Erro ao efetivar",
        description: error instanceof Error ? error.message : "Não foi possível efetivar a reposição.",
        variant: "destructive",
      });
    } finally {
      setIsFinalizing(false);
    }
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
                  onToggleSeparationItem={handleToggleSeparationItem}
                  onConfirmDispatch={handleConfirmDispatch}
                  onConfirmReceipt={handleConfirmReceipt}
                  onFinalize={handleFinalizeClick}
                  onCancel={setActivityToCancel}
                  onReopenDispatch={setActivityToReopenDispatch}
                  onReopenAudit={setActivityToReopenAudit}
                  canManagePreparation={canManagePreparation}
                  canReceive={
                    canManagePreparation ||
                    (permissions.reposition.receive &&
                      (
                        !!user?.assignedKioskIds?.includes(activity.kioskDestinationId) ||
                        !!user?.unitIds?.includes(activity.kioskDestinationId)
                      ))
                  }
                  canFinalizeStep={canFinalizeStep}
                  canRevert={canRevertSteps}
                  products={products}
              />
          ))}
      </div>
      
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

export function RepositionHistory() {
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
                                                    fileName={`${activity.kioskDestinationName || 'Reposição'} | Reposição | ${(activity.updatedAt || activity.createdAt) ? format(parseISO(activity.updatedAt || activity.createdAt), 'dd-MM-yyyy', { locale: ptBR }) : ''}.pdf`}
                                                >
                                                    {(({ loading }: any) => (
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
