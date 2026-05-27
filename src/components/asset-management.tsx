"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Grid2X2, History, ImageIcon, List, PackageCheck, Plus, QrCode, Search, Tags, Truck, Upload } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useSearchParams } from 'next/navigation';

import { useAssets } from '@/hooks/use-assets';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { storage } from '@/lib/firebase';
import type { Asset, AssetMovement, AssetStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

const assetSchema = z.object({
  name: z.string().min(2, 'Informe o nome.'),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  assetTag: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  currentKioskId: z.string().min(1, 'Selecione a unidade.'),
  department: z.string().optional(),
  exactLocation: z.string().optional(),
  responsibleName: z.string().optional(),
  inUse: z.boolean().optional(),
  possessionStatus: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchaseValue: z.coerce.number().optional(),
  supplierName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  paymentMethod: z.string().optional(),
  costCenter: z.string().optional(),
  accountingAccount: z.string().optional(),
  documentUrl: z.string().optional(),
  usefulLifeYears: z.coerce.number().optional(),
  residualValue: z.coerce.number().optional(),
  depreciationMethod: z.string().optional(),
  accumulatedDepreciation: z.coerce.number().optional(),
  bookValue: z.coerce.number().optional(),
  marketValue: z.coerce.number().optional(),
  conservationState: z.string().optional(),
  operationalCondition: z.string().optional(),
  conditionNotes: z.string().optional(),
  lastInspectionDate: z.string().optional(),
  inspectedBy: z.string().optional(),
  nextInspectionDate: z.string().optional(),
  hasWarranty: z.boolean().optional(),
  warrantyEndsAt: z.string().optional(),
  serviceCompany: z.string().optional(),
  serviceContact: z.string().optional(),
  maintenanceFrequency: z.string().optional(),
  lastMaintenanceDate: z.string().optional(),
  nextMaintenanceDate: z.string().optional(),
  maintenanceCostTotal: z.coerce.number().optional(),
  retiredAt: z.string().optional(),
  retirementReason: z.string().optional(),
  saleValue: z.coerce.number().optional(),
  buyerOrDestination: z.string().optional(),
  retirementAuthorizedBy: z.string().optional(),
  retirementDocumentUrl: z.string().optional(),
  notes: z.string().optional(),
});

type AssetFormValues = z.infer<typeof assetSchema>;

const assetEditSchema = assetSchema.extend({
  status: z.enum(['ativo', 'em_manutencao', 'fora_de_uso', 'extraviado', 'vendido', 'descartado', 'baixado']),
});

type AssetEditFormValues = z.infer<typeof assetEditSchema>;
type AssetStep = 'identification' | 'location' | 'acquisition' | 'condition' | 'history';

const STATUS_LABEL: Record<AssetStatus, string> = {
  ativo: 'Ativo',
  em_manutencao: 'Em manutenção',
  fora_de_uso: 'Fora de uso',
  extraviado: 'Extraviado',
  vendido: 'Vendido',
  descartado: 'Descartado',
  baixado: 'Baixado',
};

const STATUS_STYLE: Record<AssetStatus, string> = {
  ativo: 'bg-emerald-500 text-white hover:bg-emerald-500',
  em_manutencao: 'bg-amber-500 text-white hover:bg-amber-500',
  fora_de_uso: 'bg-rose-500 text-white hover:bg-rose-500',
  extraviado: 'bg-red-600 text-white hover:bg-red-600',
  vendido: 'bg-blue-600 text-white hover:bg-blue-600',
  descartado: 'bg-zinc-600 text-white hover:bg-zinc-600',
  baixado: 'bg-slate-500 text-white hover:bg-slate-500',
};

const MOVEMENT_LABEL: Record<AssetMovement['type'], string> = {
  CRIACAO: 'Criação',
  EDICAO: 'Edição',
  TRANSFERENCIA: 'Transferência',
  ALTERACAO_STATUS: 'Alteração de status',
  BAIXA: 'Baixa',
  ETIQUETA_REIMPRESSA: 'Etiqueta reimpressa',
};

const ASSET_STEPS: { id: AssetStep; label: string }[] = [
  { id: 'identification', label: '1. Identificação' },
  { id: 'location', label: '2. Localização' },
  { id: 'acquisition', label: '3. Aquisição' },
  { id: 'condition', label: '4. Estado' },
  { id: 'history', label: '5. Histórico' },
];

function assetQrPayload(asset: Asset) {
  if (typeof window === 'undefined') return asset.code;
  return `${window.location.origin}/patrimonio/${encodeURIComponent(asset.code)}`;
}

async function uploadAssetImage(file: File, assetId: string) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const storageRef = ref(storage, `assets/${assetId}/${Date.now()}.${extension}`);
  const snapshot = await uploadBytes(storageRef, file);
  return getDownloadURL(snapshot.ref);
}

function AssetFormSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { addAsset, categories } = useAssets();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: { name: '', category: 'Patrimônio', subcategory: '', brand: '', model: '', serialNumber: '', imageUrl: '', currentKioskId: '', purchaseDate: '', notes: '' },
  });
  const imageUrl = form.watch('imageUrl');

  async function onSubmit(values: AssetFormValues) {
    const kiosk = kiosks.find((k) => k.id === values.currentKioskId);
    await addAsset({ ...values, currentKioskName: kiosk?.name, sourceType: 'manual' });
    toast({ title: 'Patrimônio cadastrado.' });
    form.reset();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>Novo patrimônio</SheetTitle>
          <SheetDescription>Cadastre o item, vincule uma unidade e prepare o QR Code.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 px-6 py-5">
                <div className="rounded-md border bg-muted/30 p-3">
                  <FormField control={form.control} name="imageUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Imagem</FormLabel>
                      <div className="mt-2 flex min-h-48 items-center justify-center overflow-hidden rounded-md border border-dashed bg-background">
                        {imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt="Prévia do patrimônio" className="h-48 w-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
                            <ImageIcon className="h-9 w-9" />
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">Arraste a foto ou cole a URL</p>
                              <p className="text-xs">Use uma imagem do equipamento para facilitar a identificação.</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <FormControl><Input placeholder="https://..." {...field} value={field.value ?? ''} /></FormControl>
                        <Button type="button" variant="outline" size="icon"><Upload className="h-4 w-4" /></Button>
                        <Button type="button" variant="outline" size="icon"><Camera className="h-4 w-4" /></Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Nome</FormLabel><FormControl><Input placeholder="Máquina de sorvete" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Categoria: sempre "Patrimônio", congelada */}
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                      Patrimônio
                    </div>
                  </FormItem>
                  <FormField control={form.control} name="currentKioskId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidade atual</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                        <SelectContent>{kiosks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="subcategory" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subcategoria</FormLabel>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none"><span className="text-muted-foreground">Sem subcategoria</span></SelectItem>
                        {categories
                          .filter((c) => c.name !== 'Patrimônio')
                          .map((c) => (
                            <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField control={form.control} name="brand" render={({ field }) => (
                    <FormItem><FormLabel>Marca</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="model" render={({ field }) => (
                    <FormItem><FormLabel>Modelo</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="serialNumber" render={({ field }) => (
                    <FormItem><FormLabel>Série</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                    <FormItem><FormLabel>Data da compra</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                    <FormItem><FormLabel>Valor</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Observações</FormLabel><FormControl><Textarea {...field} /></FormControl></FormItem>
                )} />
              </div>
            </ScrollArea>
            <SheetFooter className="border-t px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">Cadastrar</Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function AssetCategoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { categories, addCategory } = useAssets();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function handleSubmit() {
    if (!name.trim()) return;
    await addCategory(name.trim(), description.trim() || undefined);
    toast({ title: 'Categoria cadastrada.' });
    setName('');
    setDescription('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Categorias de patrimônio</DialogTitle>
          <DialogDescription>Cadastre as categorias usadas para classificar máquinas e equipamentos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3">
            <Input placeholder="Ex: Máquinas, Equipamentos, Mobiliário" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea placeholder="Descrição opcional" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button type="button" onClick={handleSubmit} disabled={!name.trim()}>Adicionar categoria</Button>
          </div>
          <div className="rounded-md border">
            {categories.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
            ) : categories.map((category) => (
              <div key={category.id} className="border-b p-3 last:border-b-0">
                <p className="text-sm font-medium">{category.name}</p>
                {category.description ? <p className="text-xs text-muted-foreground">{category.description}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetDetailDialog({ asset, onOpenChange }: { asset: Asset | null; onOpenChange: (open: boolean) => void }) {
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  const { categories, transferAsset, updateAsset, updateAssetStatus, recordLabelPrint, fetchMovements } = useAssets();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [targetKioskId, setTargetKioskId] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assetStep, setAssetStep] = useState<AssetStep>('identification');
  const form = useForm<AssetEditFormValues>({
    resolver: zodResolver(assetEditSchema),
    defaultValues: {
      name: '',
      category: '',
      subcategory: '',
      brand: '',
      model: '',
      serialNumber: '',
      assetTag: '',
      description: '',
      imageUrl: '',
      currentKioskId: '',
      department: '',
      exactLocation: '',
      responsibleName: '',
      inUse: true,
      possessionStatus: '',
      purchaseDate: '',
      purchaseValue: undefined,
      supplierName: '',
      invoiceNumber: '',
      paymentMethod: '',
      costCenter: '',
      accountingAccount: '',
      documentUrl: '',
      conservationState: '',
      operationalCondition: '',
      conditionNotes: '',
      lastInspectionDate: '',
      inspectedBy: '',
      nextInspectionDate: '',
      hasWarranty: false,
      warrantyEndsAt: '',
      serviceCompany: '',
      serviceContact: '',
      maintenanceFrequency: '',
      lastMaintenanceDate: '',
      nextMaintenanceDate: '',
      maintenanceCostTotal: undefined,
      notes: '',
      status: 'ativo',
    },
  });
  const imageUrl = form.watch('imageUrl');

  useEffect(() => {
    if (!asset) return;
    form.reset({
      name: asset.name ?? '',
      category: 'Patrimônio',
      subcategory: asset.subcategory ?? '',
      brand: asset.brand ?? '',
      model: asset.model ?? '',
      serialNumber: asset.serialNumber ?? '',
      assetTag: asset.assetTag ?? '',
      description: asset.description ?? '',
      imageUrl: asset.imageUrl ?? '',
      currentKioskId: asset.currentKioskId ?? '',
      department: asset.department ?? '',
      exactLocation: asset.exactLocation ?? '',
      responsibleName: asset.responsibleName ?? '',
      inUse: asset.inUse ?? true,
      possessionStatus: asset.possessionStatus ?? '',
      purchaseDate: asset.purchaseDate ?? '',
      purchaseValue: asset.purchaseValue,
      supplierName: asset.supplierName ?? '',
      invoiceNumber: asset.invoiceNumber ?? '',
      paymentMethod: asset.paymentMethod ?? '',
      costCenter: asset.costCenter ?? '',
      accountingAccount: asset.accountingAccount ?? '',
      documentUrl: asset.documentUrl ?? '',
      conservationState: asset.conservationState ?? '',
      operationalCondition: asset.operationalCondition ?? '',
      conditionNotes: asset.conditionNotes ?? '',
      lastInspectionDate: asset.lastInspectionDate ?? '',
      inspectedBy: asset.inspectedBy ?? '',
      nextInspectionDate: asset.nextInspectionDate ?? '',
      hasWarranty: asset.hasWarranty ?? false,
      warrantyEndsAt: asset.warrantyEndsAt ?? '',
      serviceCompany: asset.serviceCompany ?? '',
      serviceContact: asset.serviceContact ?? '',
      maintenanceFrequency: asset.maintenanceFrequency ?? '',
      lastMaintenanceDate: asset.lastMaintenanceDate ?? '',
      nextMaintenanceDate: asset.nextMaintenanceDate ?? '',
      maintenanceCostTotal: asset.maintenanceCostTotal,
      notes: asset.notes ?? '',
      status: asset.status,
    });
    QRCode.toDataURL(assetQrPayload(asset), { width: 220, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
    setMovements([]);
    setTargetKioskId('');
    setAssetStep('identification');
  }, [asset, form]);

  useEffect(() => {
    if (!asset || !permissions.assets?.viewHistory) return;
    let cancelled = false;
    setLoadingMovements(true);
    fetchMovements(asset.id)
      .then((data) => {
        if (!cancelled) setMovements(data);
      })
      .catch((error) => {
        console.error('Error fetching asset movements:', error);
      })
      .finally(() => {
        if (!cancelled) setLoadingMovements(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, fetchMovements, permissions.assets?.viewHistory]);

  async function loadQr() {
    if (!asset) return;
    setQrUrl(await QRCode.toDataURL(assetQrPayload(asset), { width: 220, margin: 1 }));
  }

  async function loadMovements() {
    if (!asset || !permissions.assets?.viewHistory) return;
    setLoadingMovements(true);
    try {
      setMovements(await fetchMovements(asset.id));
    } finally {
      setLoadingMovements(false);
    }
  }

  async function handlePrintLabel() {
    if (!asset) return;
    await loadQr();
    await recordLabelPrint(asset.id);
    toast({ title: 'Etiqueta pronta para impressão.' });
  }

  async function handleTransfer() {
    if (!asset || !targetKioskId) return;
    const kiosk = kiosks.find((k) => k.id === targetKioskId);
    await transferAsset(asset.id, targetKioskId, kiosk?.name);
    toast({ title: 'Patrimônio transferido.' });
    setTargetKioskId('');
  }

  async function handleStatus(status: AssetStatus) {
    if (!asset) return;
    await updateAssetStatus(asset.id, status);
    toast({ title: 'Status atualizado.' });
  }

  async function handleImageFile(file: File | null) {
    if (!asset || !file) return;
    setUploadingImage(true);
    try {
      const url = await uploadAssetImage(file, asset.id);
      form.setValue('imageUrl', url, { shouldDirty: true, shouldValidate: true });
      toast({ title: 'Foto adicionada.' });
    } catch (error) {
      toast({
        title: 'Falha ao enviar foto',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSave(values: AssetEditFormValues) {
    if (!asset) return;
    setSaving(true);
    try {
      const kiosk = kiosks.find((k) => k.id === asset.currentKioskId);
      await updateAsset(asset.id, {
        name: values.name,
        category: values.category || undefined,
        subcategory: values.subcategory || undefined,
        brand: values.brand || undefined,
        model: values.model || undefined,
        serialNumber: values.serialNumber || undefined,
        assetTag: values.assetTag || undefined,
        description: values.description || undefined,
        currentKioskId: asset.currentKioskId,
        currentKioskName: asset.currentKioskName || kiosk?.name,
        department: values.department || undefined,
        exactLocation: values.exactLocation || undefined,
        responsibleName: values.responsibleName || undefined,
        inUse: values.inUse,
        possessionStatus: values.possessionStatus || undefined,
        purchaseDate: values.purchaseDate || undefined,
        purchaseValue: Number.isFinite(Number(values.purchaseValue)) ? Number(values.purchaseValue) : undefined,
        supplierName: values.supplierName || undefined,
        invoiceNumber: values.invoiceNumber || undefined,
        paymentMethod: values.paymentMethod || undefined,
        costCenter: values.costCenter || undefined,
        accountingAccount: values.accountingAccount || undefined,
        documentUrl: values.documentUrl || undefined,
        conservationState: values.conservationState || undefined,
        operationalCondition: values.operationalCondition || undefined,
        conditionNotes: values.conditionNotes || undefined,
        lastInspectionDate: values.lastInspectionDate || undefined,
        inspectedBy: values.inspectedBy || undefined,
        nextInspectionDate: values.nextInspectionDate || undefined,
        hasWarranty: values.hasWarranty,
        warrantyEndsAt: values.warrantyEndsAt || undefined,
        serviceCompany: values.serviceCompany || undefined,
        serviceContact: values.serviceContact || undefined,
        maintenanceFrequency: values.maintenanceFrequency || undefined,
        lastMaintenanceDate: values.lastMaintenanceDate || undefined,
        nextMaintenanceDate: values.nextMaintenanceDate || undefined,
        maintenanceCostTotal: Number.isFinite(Number(values.maintenanceCostTotal)) ? Number(values.maintenanceCostTotal) : undefined,
        imageUrl: values.imageUrl || undefined,
        notes: values.notes || undefined,
      });
      if (values.status !== asset.status) {
        await updateAssetStatus(asset.id, values.status);
      }
      toast({ title: 'Patrimônio atualizado.' });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Falha ao salvar patrimônio',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] !max-w-[1440px] overflow-hidden p-0">
        {asset && (
          <>
            <DialogHeader className="border-b px-6 py-5">
              <DialogTitle>{asset.code} · {asset.name}</DialogTitle>
              <DialogDescription>{asset.currentKioskName || asset.currentKioskId} · {STATUS_LABEL[asset.status]}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSave)} className="grid min-h-0 gap-0 xl:grid-cols-[minmax(760px,1fr)_380px]">
                <div className="max-h-[calc(94vh-112px)] min-w-0 space-y-4 overflow-y-auto px-6 py-5">
                  <div className="flex flex-wrap gap-2 rounded-md border bg-card p-2">
                    {ASSET_STEPS.map((step) => (
                      <Button
                        key={step.id}
                        type="button"
                        variant={assetStep === step.id ? 'default' : 'ghost'}
                        size="sm"
                        className="h-8"
                        onClick={() => setAssetStep(step.id)}
                      >
                        {step.label}
                      </Button>
                    ))}
                  </div>

                  {assetStep !== 'history' ? (
                    <>
                    <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem className={cn('rounded-md border bg-muted/30 p-3', assetStep !== 'identification' && 'hidden')}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <FormLabel>Status do patrimônio</FormLabel>
                          <p className="mt-1 text-xs text-muted-foreground">Altere aqui a situação operacional exibida no QR e na listagem.</p>
                        </div>
                        <Select value={field.value} onValueChange={field.onChange} disabled={!permissions.assets?.edit}>
                          <FormControl><SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {(Object.keys(STATUS_LABEL) as AssetStatus[]).map((status) => (
                              <SelectItem key={status} value={status}>{STATUS_LABEL[status]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <FormMessage />
                    </FormItem>
                    )} />

                  <div className={cn('grid gap-4 sm:grid-cols-[220px_1fr]', assetStep !== 'identification' && 'hidden')}>
                    <div className="space-y-3">
                      <div className="flex h-44 items-center justify-center overflow-hidden rounded-md border bg-muted">
                        {imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt="Foto do patrimônio" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ImageIcon className="h-8 w-8" />
                            <span className="text-xs">Sem foto</span>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => void handleImageFile(event.target.files?.[0] ?? null)}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1"
                          disabled={!permissions.assets?.edit || uploadingImage}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          {uploadingImage ? 'Enviando...' : 'Foto'}
                        </Button>
                        {imageUrl ? (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!permissions.assets?.edit}
                            onClick={() => form.setValue('imageUrl', '', { shouldDirty: true })}
                          >
                            Remover
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} disabled={!permissions.assets?.edit} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="grid grid-cols-1 gap-3">
                        {/* Categoria: sempre "Patrimônio", congelada */}
                        <FormItem>
                          <FormLabel>Categoria</FormLabel>
                          <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                            Patrimônio
                          </div>
                        </FormItem>
                      </div>
                    </div>
                  </div>

                  <div className={cn('rounded-md border bg-card p-4', assetStep !== 'identification' && 'hidden')}>
                    <p className="mb-3 text-sm font-semibold">Identificação</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <FormField control={form.control} name="subcategory" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subcategoria</FormLabel>
                          <Select value={field.value || ''} onValueChange={field.onChange} disabled={!permissions.assets?.edit}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none"><span className="text-muted-foreground">Sem subcategoria</span></SelectItem>
                              {categories
                                .filter((c) => c.name !== 'Patrimônio')
                                .map((c) => (
                                  <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                                ))}
                              {/* Manter valor legado caso não esteja mais na lista */}
                              {field.value && field.value !== 'none' && !categories.some((c) => c.name === field.value) && (
                                <SelectItem value={field.value}>{field.value}</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="assetTag" render={({ field }) => (
                        <FormItem><FormLabel>Etiqueta física</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="possessionStatus" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Situação de posse</FormLabel>
                          <Select value={field.value || ''} onValueChange={field.onChange} disabled={!permissions.assets?.edit}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="Próprio">Próprio</SelectItem>
                              <SelectItem value="Alugado">Alugado</SelectItem>
                              <SelectItem value="Comodato">Comodato</SelectItem>
                              <SelectItem value="Emprestado">Emprestado</SelectItem>
                              <SelectItem value="Consignado">Consignado</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem className="mt-3"><FormLabel>Descrição detalhada</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                  </div>

                  <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', assetStep !== 'identification' && 'hidden')}>
                    <FormField control={form.control} name="brand" render={({ field }) => (
                      <FormItem><FormLabel>Marca</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="model" render={({ field }) => (
                      <FormItem><FormLabel>Modelo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="serialNumber" render={({ field }) => (
                      <FormItem><FormLabel>Série</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                  </div>

                  <div className={cn('rounded-md border bg-card p-4', assetStep !== 'location' && 'hidden')}>
                    <p className="mb-3 text-sm font-semibold">Localização e responsável</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField control={form.control} name="department" render={({ field }) => (
                        <FormItem><FormLabel>Setor / área</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="exactLocation" render={({ field }) => (
                        <FormItem><FormLabel>Local exato</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="responsibleName" render={({ field }) => (
                        <FormItem><FormLabel>Responsável</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="inUse" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Está em uso?</FormLabel>
                          <Select value={field.value ? 'true' : 'false'} onValueChange={(value) => field.onChange(value === 'true')} disabled={!permissions.assets?.edit}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="true">Sim</SelectItem>
                              <SelectItem value="false">Não</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                  </div>

                  <div className={cn('rounded-md border bg-card p-4', assetStep !== 'acquisition' && 'hidden')}>
                    <p className="mb-3 text-sm font-semibold">Aquisição</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <FormField control={form.control} name="supplierName" render={({ field }) => (
                        <FormItem><FormLabel>Fornecedor</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                        <FormItem><FormLabel>Nota fiscal</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                        <FormItem><FormLabel>Forma de pagamento</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="costCenter" render={({ field }) => (
                        <FormItem><FormLabel>Centro de custo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="accountingAccount" render={({ field }) => (
                        <FormItem><FormLabel>Conta contábil</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="documentUrl" render={({ field }) => (
                        <FormItem><FormLabel>Documento anexado</FormLabel><FormControl><Input placeholder="https://..." {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                    </div>
                  </div>

                  <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', assetStep !== 'acquisition' && 'hidden')}>
                    <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                      <FormItem><FormLabel>Data da compra</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                      <FormItem><FormLabel>Valor</FormLabel><FormControl><Input type="number" step="0.01" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                  </div>

                  <div className={cn('rounded-md border bg-card p-4', assetStep !== 'condition' && 'hidden')}>
                    <p className="mb-3 text-sm font-semibold">Estado, garantia e manutenção</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <FormField control={form.control} name="conservationState" render={({ field }) => (
                        <FormItem><FormLabel>Estado atual</FormLabel><FormControl><Input placeholder="Novo, bom, regular..." {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="operationalCondition" render={({ field }) => (
                        <FormItem><FormLabel>Condição operacional</FormLabel><FormControl><Input placeholder="Funcionando..." {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="nextInspectionDate" render={({ field }) => (
                        <FormItem><FormLabel>Próxima conferência</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="lastInspectionDate" render={({ field }) => (
                        <FormItem><FormLabel>Última conferência</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="inspectedBy" render={({ field }) => (
                        <FormItem><FormLabel>Conferido por</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="warrantyEndsAt" render={({ field }) => (
                        <FormItem><FormLabel>Fim da garantia</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="serviceCompany" render={({ field }) => (
                        <FormItem><FormLabel>Assistência técnica</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="serviceContact" render={({ field }) => (
                        <FormItem><FormLabel>Contato assistência</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="nextMaintenanceDate" render={({ field }) => (
                        <FormItem><FormLabel>Próxima manutenção</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="conditionNotes" render={({ field }) => (
                      <FormItem className="mt-3"><FormLabel>Observações sobre o estado</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="imageUrl" render={({ field }) => (
                    <FormItem className={cn(assetStep !== 'identification' && 'hidden')}>
                      <FormLabel>URL da foto</FormLabel>
                      <FormControl><Input placeholder="https://..." {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem className={cn(assetStep !== 'condition' && 'hidden')}><FormLabel>Observações gerais</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                  )} />
                  </>
                  ) : null}

                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button type="submit" disabled={!permissions.assets?.edit || saving || uploadingImage}>{saving ? 'Salvando...' : 'Salvar alterações'}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={handlePrintLabel} disabled={!permissions.assets?.printLabels}><QrCode className="mr-2 h-4 w-4" />Etiqueta</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void loadMovements()} disabled={!permissions.assets?.viewHistory}><History className="mr-2 h-4 w-4" />Histórico</Button>
                  </div>

                  {assetStep === 'location' ? (
                    <>
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm font-medium">Transferência de unidade</p>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Select value={targetKioskId} onValueChange={setTargetKioskId}>
                        <SelectTrigger><SelectValue placeholder="Transferir para..." /></SelectTrigger>
                        <SelectContent>{kiosks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button type="button" onClick={handleTransfer} disabled={!targetKioskId || !permissions.assets?.transfer}><Truck className="mr-2 h-4 w-4" />Transferir</Button>
                    </div>
                  </div>
                    </>
                  ) : null}

                  {assetStep === 'history' && permissions.assets?.viewHistory ? (
                    <>
                  {permissions.assets?.viewHistory ? (
                    <div className="rounded-md border">
                      <div className="flex items-center justify-between border-b px-3 py-2">
                        <p className="text-sm font-medium">Histórico completo</p>
                        <Button type="button" variant="ghost" size="sm" onClick={() => void loadMovements()} disabled={loadingMovements}>
                          <History className="mr-2 h-4 w-4" />
                          Atualizar
                        </Button>
                      </div>
                      <ScrollArea className="h-60 p-3">
                        {loadingMovements ? (
                          <p className="text-sm text-muted-foreground">Carregando histórico...</p>
                        ) : movements.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
                        ) : (
                          <div className="space-y-3 text-sm">
                            {movements.map((m) => (
                              <div key={m.id} className="border-b pb-3 last:border-b-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-medium">{MOVEMENT_LABEL[m.type] ?? m.type}</p>
                                  <span className="text-xs text-muted-foreground">{new Date(m.occurredAt).toLocaleString('pt-BR')}</span>
                                </div>
                                <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                  <p>Usuário: {m.username || '-'}</p>
                                  {m.fromStatus || m.toStatus ? (
                                    <p>Status: {m.fromStatus ? STATUS_LABEL[m.fromStatus] : '-'} → {m.toStatus ? STATUS_LABEL[m.toStatus] : '-'}</p>
                                  ) : null}
                                  {m.fromKioskName || m.toKioskName ? (
                                    <p className="sm:col-span-2">Unidade: {m.fromKioskName || m.fromKioskId || '-'} → {m.toKioskName || m.toKioskId || '-'}</p>
                                  ) : null}
                                  {m.notes ? <p className="sm:col-span-2">Observação: {m.notes}</p> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                  ) : null}
                    </>
                  ) : null}
                </div>
                <div className="max-h-[calc(94vh-112px)] overflow-y-auto border-t p-5 text-center xl:border-l xl:border-t-0">
                  {qrUrl ? <img src={qrUrl} alt={`QR ${asset.code}`} className="mx-auto" /> : <QrCode className="mx-auto h-24 w-24 text-muted-foreground" />}
                  <p className="mt-2 font-mono text-lg font-semibold">{asset.code}</p>
                  <p className="text-xs text-muted-foreground">{form.watch('name')}</p>
                  <Badge className={cn('mt-3', STATUS_STYLE[form.watch('status')])}>{STATUS_LABEL[form.watch('status')]}</Badge>
                  <div className="mt-5 space-y-2 text-left text-xs text-muted-foreground">
                    <p><span className="font-medium text-foreground">Unidade:</span> {asset.currentKioskName || asset.currentKioskId}</p>
                    <p><span className="font-medium text-foreground">Origem:</span> {asset.sourceType === 'purchase_receipt' ? 'Recebimento de compra' : 'Cadastro manual'}</p>
                    {asset.supplierName ? <p><span className="font-medium text-foreground">Fornecedor:</span> {asset.supplierName}</p> : null}
                  </div>
                </div>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatCurrency(value?: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function assetMeta(asset: Asset) {
  return [asset.brand, asset.model, asset.serialNumber].filter(Boolean).join(' · ') || asset.category || '-';
}

function AssetCard({ asset, onOpen }: { asset: Asset; onOpen: (asset: Asset) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="group overflow-hidden rounded-md border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[4/3] bg-muted">
        {asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-orange-100 text-orange-600">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-orange-500 text-2xl font-bold tracking-[0.18em]">
              {asset.code}
            </div>
            <span className="mt-3 text-sm font-semibold">{asset.category || 'Patrimônio'}</span>
          </div>
        )}
        <Badge className={cn('absolute left-2 top-2 h-5 px-2 text-[10px] uppercase', STATUS_STYLE[asset.status])}>
          {STATUS_LABEL[asset.status]}
        </Badge>
        <div className="absolute right-2 top-2 flex gap-1">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-white/90 text-foreground shadow-sm">
            <QrCode className="h-4 w-4" />
          </span>
          <span className="flex h-7 min-w-9 items-center justify-center rounded bg-white/90 px-1 font-mono text-[10px] font-semibold shadow-sm">
            {asset.code}
          </span>
        </div>
      </div>
      <div className="space-y-3 p-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-pink-600">{asset.category || 'Sem categoria'}</p>
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-tight">{asset.name}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">{assetMeta(asset)}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Unidade</p>
            <p className="truncate font-medium">{asset.currentKioskName || asset.currentKioskId}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Valor</p>
            <p className="font-medium">{formatCurrency(asset.purchaseValue)}</p>
          </div>
        </div>
      </div>
    </button>
  );
}

export function AssetManagement() {
  const { assets, loading } = useAssets();
  const { permissions } = useAuth();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [showNew, setShowNew] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [statusFilter, setStatusFilter] = useState<'todos' | AssetStatus>('todos');
  const [categoryFilter, setCategoryFilter] = useState('todas');
  const [unitFilter, setUnitFilter] = useState('todas');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table');

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
  }, [searchParams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesSearch = !q || [asset.code, asset.name, asset.category, asset.brand, asset.model, asset.serialNumber, asset.currentKioskName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
      const matchesStatus = statusFilter === 'todos' || asset.status === statusFilter;
      const matchesCategory = categoryFilter === 'todas' || (asset.subcategory || 'Sem subcategoria') === categoryFilter;
      const matchesUnit = unitFilter === 'todas' || asset.currentKioskId === unitFilter;
      return matchesSearch && matchesStatus && matchesCategory && matchesUnit;
    });
  }, [assets, search, statusFilter, categoryFilter, unitFilter]);

  const categories = useMemo(() => Array.from(new Set(assets.map((asset) => asset.subcategory || 'Sem subcategoria'))).sort(), [assets]);
  const units = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((asset) => map.set(asset.currentKioskId, asset.currentKioskName || asset.currentKioskId));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [assets]);

  const summary = useMemo(() => {
    const totalValue = assets.reduce((sum, asset) => sum + (asset.purchaseValue || 0), 0);
    return {
      total: assets.length,
      active: assets.filter((asset) => asset.status === 'ativo').length,
      maintenance: assets.filter((asset) => asset.status === 'em_manutencao').length,
      retired: assets.filter((asset) => asset.status === 'baixado').length,
      totalValue,
    };
  }, [assets]);

  if (!permissions.assets?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar patrimônio.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patrimônio</h1>
          <p className="text-sm text-muted-foreground">Máquinas e equipamentos rastreados por código interno e QR Code.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowCategories(true)} disabled={!permissions.assets?.create && !permissions.assets?.edit}><Tags className="mr-2 h-4 w-4" />Categorias</Button>
          <Button onClick={() => setShowNew(true)} disabled={!permissions.assets?.create}><Plus className="mr-2 h-4 w-4" />Novo patrimônio</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="mt-1 text-2xl font-bold">{summary.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ativos</p><p className="mt-1 text-2xl font-bold text-emerald-600">{summary.active}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Em manutenção</p><p className="mt-1 text-2xl font-bold text-amber-600">{summary.maintenance}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Baixados</p><p className="mt-1 text-2xl font-bold text-rose-600">{summary.retired}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Valor patrimonial</p><p className="mt-1 text-xl font-bold">{formatCurrency(summary.totalValue)}</p></CardContent></Card>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-64 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código, série, nome..." className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas subcategorias</SelectItem>
            {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-full lg:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas unidades</SelectItem>
            {units.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'todos' | AssetStatus)}>
          <SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos status</SelectItem>
            {(Object.keys(STATUS_LABEL) as AssetStatus[]).map((status) => (
              <SelectItem key={status} value={status}>{STATUS_LABEL[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && setViewMode(value as 'cards' | 'table')} className="justify-start rounded-md border p-1">
          <ToggleGroupItem value="cards" aria-label="Cards"><Grid2X2 className="h-4 w-4" /></ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Tabela"><List className="h-4 w-4" /></ToggleGroupItem>
        </ToggleGroup>
      </div>

      {viewMode === 'cards' ? (
        loading ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">Carregando patrimônio...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">Nenhum patrimônio encontrado.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={setSelected} />)}
          </div>
        )
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5" />Ativos</CardTitle>
          </CardHeader>
          <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Patrimônio</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5}>Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5}>Nenhum patrimônio encontrado.</TableCell></TableRow>
              ) : filtered.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell className="font-mono text-xs">{asset.code}</TableCell>
                  <TableCell>
                    <p className="font-medium">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">{[asset.brand, asset.model, asset.serialNumber].filter(Boolean).join(' · ') || asset.category || '-'}</p>
                  </TableCell>
                  <TableCell>{asset.currentKioskName || asset.currentKioskId}</TableCell>
                  <TableCell><Badge className={STATUS_STYLE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge></TableCell>
                  <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setSelected(asset)}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </CardContent>
        </Card>
      )}

      <AssetFormSheet open={showNew} onOpenChange={setShowNew} />
      <AssetCategoryDialog open={showCategories} onOpenChange={setShowCategories} />
      <AssetDetailDialog asset={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
