"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Box, Briefcase, Check, ChevronRight, ChevronsUpDown, Coins, FileText, Grid2X2, History, ImageIcon, MapPin, MoveRight, Plus, Printer, QrCode, Rows3, Search, Table2, Tags, Upload, Wrench } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { useAssets } from '@/hooks/use-assets';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { useFinancialCollection } from '@/features/financial/hooks/use-financial-collection';
import { financialCollection } from '@/features/financial/lib/repositories';
import type { Asset, AssetCategory, AssetMovement, AssetStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { BarcodeScannerModal } from '@/components/barcode-scanner-modal';
import { cn } from '@/lib/utils';

const assetSchema = z.object({
  code: z.string().optional(),
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

const MOVEMENT_LABEL: Record<AssetMovement['type'], string> = {
  CRIACAO: 'Criação',
  EDICAO: 'Edição',
  TRANSFERENCIA: 'Transferência',
  ALTERACAO_STATUS: 'Alteração de status',
  BAIXA: 'Baixa',
  ETIQUETA_REIMPRESSA: 'Etiqueta reimpressa',
  RETIRADA: 'Retirada',
  COMPONENTE: 'Componente / peça',
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

function normalizeAssetCodeInput(value: string) {
  const raw = value.trim();
  if (!raw) return '';

  let candidate = raw;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const patrimonioIndex = parts.findIndex((part) => part.toLowerCase() === 'patrimonio');
    if (patrimonioIndex >= 0 && parts[patrimonioIndex + 1]) {
      candidate = decodeURIComponent(parts[patrimonioIndex + 1]);
    }
  } catch {
    const match = raw.match(/\/patrimonio\/([^/?#]+)/i);
    if (match?.[1]) {
      candidate = decodeURIComponent(match[1]);
    }
  }

  const normalized = candidate.toUpperCase().replace(/\s+/g, '');
  const patMatch = normalized.match(/^PAT[-_]?(\d+)$/);
  if (patMatch) {
    return `PAT-${patMatch[1].padStart(6, '0')}`;
  }

  const digits = normalized.replace(/\D/g, '');
  if (digits) {
    return `PAT-${digits.padStart(6, '0')}`;
  }

  return normalized;
}

async function uploadAssetFile(file: File, assetId: string, kind: 'image' | 'fiscal') {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Usuário não autenticado.');

  const formData = new FormData();
  formData.set('file', file);
  formData.set('assetId', assetId);
  formData.set('kind', kind);

  const response = await fetch('/api/assets/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.url !== 'string') {
    throw new Error(payload.error || 'Falha ao enviar arquivo do patrimônio.');
  }
  return payload.url;
}

const FORM_PAYMENTS = ['PIX', 'Boleto', 'Cartão de crédito', 'Transferência / TED', 'Dinheiro', 'Cartão BNDES'];
const FORM_INPUT = 'h-9 w-full rounded-lg border bg-card px-3 text-[13px] outline-none transition focus:ring-2 focus:ring-indigo-500';

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}{required && <span className="text-rose-500">*</span>}
    </label>
  );
}

function FormBlock({ n, title, hint, children }: { n: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-900 text-[11px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{n}</span>
        <div>
          <h3 className="text-[13.5px] font-semibold leading-tight">{title}</h3>
          {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function CategoryChips({ value, onChange, categories }: { value?: string; onChange: (v: string) => void; categories: AssetCategory[] }) {
  const options = categories.filter((c) => c.name !== 'Patrimônio');
  if (options.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground">Nenhuma categoria cadastrada — use o botão “Categorias” para criar.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((c) => {
        const cat = categoryColor(c.name);
        const on = value === c.name;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(on ? '' : c.name)}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium ring-1 transition', on ? 'text-white' : 'bg-card text-foreground/70 ring-border hover:ring-zinc-300')}
            style={on ? { background: cat.color, borderColor: cat.color } : undefined}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? 'white' : cat.color }} />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

function StatusPicker({ value, onChange }: { value: AssetStatus; onChange: (v: AssetStatus) => void }) {
  const keys: AssetStatus[] = ['ativo', 'em_manutencao', 'fora_de_uso'];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {keys.map((k) => {
        const meta = ASSET_STATUS_META[k];
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn('flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium ring-1 transition', on ? 'bg-muted/60 text-foreground ring-foreground' : 'bg-card text-muted-foreground ring-border hover:ring-zinc-300')}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />{meta.label}
          </button>
        );
      })}
    </div>
  );
}

// Prévia da etiqueta ao vivo (QR decorativo + dados preenchidos)
function LabelPreview({ name, brand, model, unitName, category }: { name?: string; brand?: string; model?: string; unitName?: string; category?: string }) {
  const cat = category ? categoryColor(category) : null;
  return (
    <div className="flex items-stretch gap-3 rounded-xl border bg-card p-3">
      <div className="grid h-[84px] w-[84px] shrink-0 place-items-center gap-1 rounded-lg border border-dashed bg-muted/40 p-1.5 text-center text-muted-foreground">
        <QrCode className="h-7 w-7" />
        <span className="text-[8px] font-medium leading-tight">QR gerado ao salvar</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Patrimônio Coala</span>
          {cat && <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />}
        </div>
        <div className="font-mono text-[13px] font-bold tabular-nums text-muted-foreground">Código automático</div>
        <div className="mt-0.5 truncate text-[12px] font-semibold">{name || 'Nome do patrimônio'}</div>
        <div className="truncate text-[10.5px] text-muted-foreground">{[brand, model].filter(Boolean).join(' · ') || 'Marca · modelo'}</div>
        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground/70">
          <MapPin className="h-2.5 w-2.5" />{unitName || 'Sem unidade'}
        </div>
      </div>
    </div>
  );
}

function AssetFormSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { addAsset, categories } = useAssets();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [status, setStatus] = useState<AssetStatus>('ativo');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: { code: '', name: '', category: 'Patrimônio', subcategory: '', brand: '', model: '', serialNumber: '', imageUrl: '', currentKioskId: '', purchaseDate: '', supplierName: '', invoiceNumber: '', paymentMethod: '', warrantyEndsAt: '', exactLocation: '', responsibleName: '', notes: '' },
  });
  const v = form.watch();
  const imageUrl = v.imageUrl;
  const unitName = kiosks.find((k) => k.id === v.currentKioskId)?.name;
  const filledCount = (['name', 'subcategory', 'currentKioskId', 'brand', 'model', 'serialNumber', 'purchaseValue', 'supplierName'] as const)
    .filter((k) => String((v as Record<string, unknown>)[k] ?? '').trim()).length;
  const ok = Boolean(v.name?.trim()) && Boolean(v.currentKioskId);

  function resetAll() {
    form.reset();
    setStatus('ativo');
  }

  async function handleCreateImageFile(file: File | null) {
    if (!file) return;
    setUploadingImage(true);
    try {
      const url = await uploadAssetFile(file, '_pending', 'image');
      form.setValue('imageUrl', url, { shouldDirty: true });
      toast({ title: 'Foto adicionada.' });
    } catch (error) {
      toast({ title: 'Falha ao enviar foto', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onSubmit(values: AssetFormValues) {
    const kiosk = kiosks.find((k) => k.id === values.currentKioskId);
    setSubmitting(true);
    try {
      await addAsset({ ...values, status, currentKioskName: kiosk?.name, sourceType: 'manual' });
      toast({ title: 'Patrimônio cadastrado.' });
      resetAll();
      onOpenChange(false);
    } catch (error) {
      toast({ title: 'Falha ao cadastrar patrimônio', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] !max-w-[980px] overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-6 py-3.5 space-y-0">
          <div className="text-left">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Cadastro · formulário único</p>
            <DialogTitle className="text-[15px] font-bold tracking-tight">Novo patrimônio</DialogTitle>
            <DialogDescription className="sr-only">Cadastre o item, vincule uma unidade e prepare o QR Code.</DialogDescription>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_300px]">
            {/* FORM */}
            <ScrollArea className="max-h-[min(740px,80vh)]">
              <div className="space-y-6 px-6 py-5">
                <FormBlock n="1" title="Identificação" hint="Aparece na etiqueta e na busca.">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
                    <FormField control={form.control} name="imageUrl" render={({ field }) => (
                      <FormItem className="space-y-2">
                        <div className="relative aspect-square overflow-hidden rounded-xl border bg-muted/40">
                          {imageUrl ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={imageUrl} alt="Prévia" className="h-full w-full object-contain" />
                              <button type="button" onClick={() => form.setValue('imageUrl', '')} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-zinc-700 ring-1 ring-zinc-200 hover:bg-white"><span className="text-sm leading-none">×</span></button>
                            </>
                          ) : (
                            <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute inset-0 grid place-items-center p-3 text-center transition hover:bg-muted/60">
                              <div className="flex flex-col items-center text-muted-foreground">
                                {uploadingImage ? (
                                  <span className="text-[11px] font-semibold text-foreground">Enviando…</span>
                                ) : (
                                  <>
                                    <ImageIcon className="mb-1.5 h-6 w-6" />
                                    <p className="text-[11px] font-semibold text-foreground">Foto do item</p>
                                    <p className="mt-0.5 text-[10px]">Toque para enviar</p>
                                  </>
                                )}
                              </div>
                            </button>
                          )}
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleCreateImageFile(e.target.files?.[0] ?? null)} />
                        <Button type="button" variant="outline" size="sm" className="h-8 w-full text-[12px]" disabled={uploadingImage} onClick={() => fileInputRef.current?.click()}>
                          <Upload className="mr-1.5 h-3.5 w-3.5" />{uploadingImage ? 'Enviando…' : 'Enviar foto'}
                        </Button>
                        <FormControl><Input placeholder="ou cole a URL…" className="h-8 text-[12px]" {...field} value={field.value ?? ''} /></FormControl>
                      </FormItem>
                    )} />
                    <div className="space-y-3">
                      <FormField control={form.control} name="name" render={({ field }) => (
                        <FormItem>
                          <FieldLabel required>Nome do patrimônio</FieldLabel>
                          <FormControl><input className={FORM_INPUT} placeholder="Ex: Máquina de sorvete italiana" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="code" render={({ field }) => (
                        <FormItem>
                          <FieldLabel>Código da placa</FieldLabel>
                          <FormControl><input className={cn(FORM_INPUT, 'font-mono uppercase')} placeholder="Ex: PAT-000123 ou 123" {...field} value={field.value ?? ''} /></FormControl>
                          <p className="mt-1 text-[10px] leading-tight text-muted-foreground">Opcional. Se vazio, usa a próxima etiqueta livre já gerada.</p>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="subcategory" render={({ field }) => (
                        <FormItem>
                          <FieldLabel>Categoria</FieldLabel>
                          <CategoryChips value={field.value} onChange={(val) => form.setValue('subcategory', val)} categories={categories} />
                        </FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <FormField control={form.control} name="brand" render={({ field }) => (
                      <FormItem><FieldLabel>Marca</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="Ex: Tecnomac" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="model" render={({ field }) => (
                      <FormItem><FieldLabel>Modelo</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="Genyo G6" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="serialNumber" render={({ field }) => (
                      <FormItem><FieldLabel>Nº de série</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="TC-001244" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                  </div>
                </FormBlock>

                <FormBlock n="2" title="Compra | Origem" hint="Dados de aquisição para depreciação e garantia.">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                      <FormItem><FieldLabel>Data</FieldLabel><FormControl><input type="date" className={FORM_INPUT} {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                      <FormItem><FieldLabel>Valor (R$)</FieldLabel><FormControl><CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="supplierName" render={({ field }) => (
                      <FormItem><FieldLabel>Fornecedor</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="Tecnomac" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                      <FormItem><FieldLabel>Nota fiscal</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="NF 0000" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                      <FormItem>
                        <FieldLabel>Forma de pagamento</FieldLabel>
                        <Select value={field.value || ''} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger></FormControl>
                          <SelectContent>{FORM_PAYMENTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="warrantyEndsAt" render={({ field }) => (
                      <FormItem><FieldLabel>Garantia até</FieldLabel><FormControl><input type="date" className={FORM_INPUT} {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                  </div>
                </FormBlock>

                <FormBlock n="3" title="Local | Situação" hint="A unidade é obrigatória.">
                  <FormField control={form.control} name="currentKioskId" render={({ field }) => (
                    <FormItem>
                      <FieldLabel required>Unidade atual</FieldLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Selecione a unidade…" /></SelectTrigger></FormControl>
                        <SelectContent>{kiosks.map((k) => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="exactLocation" render={({ field }) => (
                      <FormItem><FieldLabel>Local específico</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="Cozinha principal" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="responsibleName" render={({ field }) => (
                      <FormItem><FieldLabel>Responsável</FieldLabel><FormControl><input className={FORM_INPUT} placeholder="Nome do responsável" {...field} value={field.value ?? ''} /></FormControl></FormItem>
                    )} />
                  </div>
                  <div>
                    <FieldLabel>Status inicial</FieldLabel>
                    <StatusPicker value={status} onChange={setStatus} />
                  </div>
                </FormBlock>
              </div>
            </ScrollArea>

            {/* RAIL */}
            <div className="flex flex-col gap-4 border-t bg-muted/30 px-4 py-5 lg:border-l lg:border-t-0">
              <div>
                <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Prévia da etiqueta</p>
                <LabelPreview name={v.name} brand={v.brand} model={v.model} unitName={unitName} category={v.subcategory} />
              </div>
              <div className="rounded-xl border bg-card p-3">
                <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Preenchimento</p>
                <div className="space-y-1.5">
                  {([['Identificação', Boolean(v.name && v.subcategory)], ['Aquisição', Boolean(v.purchaseValue || v.supplierName)], ['Localização', Boolean(v.currentKioskId)]] as const).map(([l, done]) => (
                    <div key={l} className="flex items-center gap-2 text-[12px]">
                      <span className={cn('grid h-4 w-4 place-items-center rounded-full', done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground')}>{done ? <Check className="h-2.5 w-2.5" /> : null}</span>
                      <span className={done ? 'font-medium text-foreground/80' : 'text-muted-foreground'}>{l}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${Math.round((filledCount / 8) * 100)}%` }} />
                </div>
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">{filledCount} de 8 campos preenchidos</div>
              </div>
              <div className="mt-auto space-y-1.5">
                {!ok && <p className="text-[11px] text-rose-600">Faltam nome e unidade.</p>}
                <Button type="submit" disabled={!ok || submitting} className="w-full bg-indigo-600 text-white hover:bg-indigo-700"><Check className="mr-2 h-4 w-4" />{submitting ? 'Cadastrando…' : 'Cadastrar patrimônio'}</Button>
                <Button type="button" variant="ghost" className="w-full" onClick={resetAll}>Limpar</Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
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
  const { permissions, activeUsers } = useAuth();
  const { data: financialAccounts } = useFinancialCollection<any>(financialCollection('accounts'));
  const dreAccounts = useMemo(
    () => (financialAccounts || []).filter((a: any) => a.active !== false && a.is_dre_account !== false && !a.isGroup),
    [financialAccounts]
  );
  const { categories, updateAsset, updateAssetStatus, recordLabelPrint, fetchMovements, recordRetirada } = useAssets();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fiscalDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingFiscalDocument, setUploadingFiscalDocument] = useState(false);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assetStep, setAssetStep] = useState<AssetStep>('identification');
  const [movWithdrawerType, setMovWithdrawerType] = useState<'cadastrado' | 'externo'>('cadastrado');
  const [movWithdrawerUserId, setMovWithdrawerUserId] = useState('');
  const [movWithdrawerFree, setMovWithdrawerFree] = useState('');
  const [movDestType, setMovDestType] = useState<'cadastrado' | 'externo'>('cadastrado');
  const [movDestKioskId, setMovDestKioskId] = useState('');
  const [movDestFree, setMovDestFree] = useState('');
  const [movRespType, setMovRespType] = useState<'cadastrado' | 'externo'>('cadastrado');
  const [movRespUserId, setMovRespUserId] = useState('');
  const [movRespFree, setMovRespFree] = useState('');
  const [movNotes, setMovNotes] = useState('');
  const [movSaving, setMovSaving] = useState(false);
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
  const documentUrl = form.watch('documentUrl');

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
    const qrDataUrl = await QRCode.toDataURL(assetQrPayload(asset), { width: 280, margin: 1 });
    const win = window.open('', '_blank', 'width=500,height=400');
    if (!win) { toast({ title: 'Permita popups para imprimir a etiqueta.', variant: 'destructive' }); return; }
    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Etiqueta ${asset.code}</title>
  <style>
    @page { size: 10cm 6cm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 10cm; height: 6cm; display: flex; align-items: center; padding: 0.4cm; font-family: sans-serif; background: #fff; }
    .label { display: flex; align-items: center; gap: 0.4cm; width: 100%; }
    img { width: 4.5cm; height: 4.5cm; flex-shrink: 0; }
    .info { flex: 1; overflow: hidden; }
    .code { font-family: monospace; font-size: 13pt; font-weight: 700; letter-spacing: 0.02em; }
    .name { font-size: 8.5pt; margin-top: 5px; line-height: 1.3; word-break: break-word; }
    .unit { font-size: 7.5pt; color: #555; margin-top: 5px; }
    @media screen { body { border: 1px dashed #ccc; margin: 1cm auto; } }
  </style>
</head>
<body>
  <div class="label">
    <img src="${qrDataUrl}" alt="QR Code" />
    <div class="info">
      <div class="code">${asset.code}</div>
      <div class="name">${asset.name}</div>
      ${asset.currentKioskName || asset.currentKioskId ? `<div class="unit">${asset.currentKioskName || asset.currentKioskId}</div>` : ''}
    </div>
  </div>
  <script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`);
    win.document.close();
    await recordLabelPrint(asset.id);
  }

  async function handleRetirada() {
    if (!asset) return;
    const withdrawerName = movWithdrawerType === 'cadastrado'
      ? activeUsers.find((u) => u.id === movWithdrawerUserId)?.username ?? ''
      : movWithdrawerFree;
    const destinationName = movDestType === 'cadastrado'
      ? kiosks.find((k) => k.id === movDestKioskId)?.name ?? ''
      : movDestFree;
    const newResponsibleName = movRespType === 'cadastrado'
      ? activeUsers.find((u) => u.id === movRespUserId)?.username ?? ''
      : movRespFree;
    if (!withdrawerName || !destinationName) {
      toast({ title: 'Preencha quem está retirando e o destino.', variant: 'destructive' });
      return;
    }
    setMovSaving(true);
    try {
      await recordRetirada(asset.id, {
        withdrawerName,
        withdrawerUserId: movWithdrawerType === 'cadastrado' ? movWithdrawerUserId : undefined,
        destinationName,
        destinationKioskId: movDestType === 'cadastrado' ? movDestKioskId : undefined,
        newResponsibleName: newResponsibleName || undefined,
        notes: movNotes || undefined,
      });
      toast({ title: 'Movimentação registrada.' });
      setMovWithdrawerUserId('');
      setMovWithdrawerFree('');
      setMovDestKioskId('');
      setMovDestFree('');
      setMovRespUserId('');
      setMovRespFree('');
      setMovNotes('');
      await loadMovements();
    } finally {
      setMovSaving(false);
    }
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
      const url = await uploadAssetFile(file, asset.id, 'image');
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

  async function handleFiscalDocumentFile(file: File | null) {
    if (!asset || !file) return;
    setUploadingFiscalDocument(true);
    try {
      const url = await uploadAssetFile(file, asset.id, 'fiscal');
      form.setValue('documentUrl', url, { shouldDirty: true, shouldValidate: true });
      toast({ title: 'Nota fiscal anexada.' });
    } catch (error) {
      toast({
        title: 'Falha ao anexar nota fiscal',
        description: error instanceof Error ? error.message : 'Erro inesperado.',
        variant: 'destructive',
      });
    } finally {
      setUploadingFiscalDocument(false);
      if (fiscalDocumentInputRef.current) fiscalDocumentInputRef.current.value = '';
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
        exactLocation: (values.exactLocation === 'none' ? undefined : values.exactLocation) || undefined,
        responsibleName: (values.responsibleName === 'none' ? undefined : values.responsibleName) || undefined,
        inUse: values.inUse,
        possessionStatus: values.possessionStatus || undefined,
        purchaseDate: values.purchaseDate || undefined,
        purchaseValue: Number.isFinite(Number(values.purchaseValue)) ? Number(values.purchaseValue) : undefined,
        supplierName: values.supplierName || undefined,
        invoiceNumber: values.invoiceNumber || undefined,
        paymentMethod: values.paymentMethod || undefined,
        costCenter: values.costCenter || undefined,
        accountingAccount: (values.accountingAccount === 'none' ? undefined : values.accountingAccount) || undefined,
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
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] !max-w-[1120px] flex-col overflow-hidden p-0">
        {asset && (
          <>
            <DialogHeader className="shrink-0 space-y-0">
              <DialogTitle className="sr-only">{asset.code} · {asset.name}</DialogTitle>
              <DialogDescription className="sr-only">{asset.currentKioskName || asset.currentKioskId} · {STATUS_LABEL[asset.status]}</DialogDescription>
              <div className="relative shrink-0" style={{ background: categoryColor(asset.subcategory || asset.category).soft }}>
                <div className="relative h-28 overflow-hidden sm:h-32">
                  <AssetThumb asset={asset} className="h-full w-full" />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,.62) 100%)' }} />
                </div>
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
                  <span className="rounded-md bg-white/90 px-2 py-1 font-mono text-[11px] font-bold text-zinc-900 ring-1 ring-zinc-200 backdrop-blur">{asset.code}</span>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4 text-left text-white">
                  <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider drop-shadow">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: categoryColor(asset.subcategory || asset.category).color }} />
                    {asset.subcategory || asset.category || 'Patrimônio'}
                    {(asset.brand || asset.model) && <><span className="opacity-50">·</span>{[asset.brand, asset.model].filter(Boolean).join(' · ')}</>}
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <h2 className="text-[19px] font-bold leading-tight tracking-tight drop-shadow">{asset.name}</h2>
                    <AssetStatusChip status={asset.status} variant="solid" />
                  </div>
                </div>
              </div>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSave)} className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(640px,1fr)_360px]">
                <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto px-6 py-5">
                  <div className="flex flex-wrap gap-1.5 rounded-xl border bg-card p-1.5">
                    {ASSET_STEPS.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setAssetStep(step.id)}
                        className={cn('h-8 rounded-lg px-3 text-[12.5px] font-semibold transition',
                          assetStep === step.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                      >
                        {step.label}
                      </button>
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
                          <img src={imageUrl} alt="Foto do patrimônio" className="h-full w-full object-contain" />
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
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                      <FormItem>
                        {/* Categoria: sempre "Patrimônio", congelada */}
                        <FormLabel>Categoria</FormLabel>
                        <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">Patrimônio</div>
                      </FormItem>
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

                  <div className={cn('rounded-md border bg-card p-4', assetStep !== 'location' && 'hidden')}>
                    <p className="mb-3 text-sm font-semibold">Localização e responsável</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField control={form.control} name="exactLocation" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Local / Unidade</FormLabel>
                          <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!permissions.assets?.edit}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none"><span className="text-muted-foreground">Sem local definido</span></SelectItem>
                              {kiosks.map((k) => <SelectItem key={k.id} value={k.name}>{k.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="responsibleName" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Responsável</FormLabel>
                          <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!permissions.assets?.edit}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none"><span className="text-muted-foreground">Sem responsável</span></SelectItem>
                              {activeUsers.map((u) => <SelectItem key={u.id} value={u.username}>{u.username}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </FormItem>
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
                    <div className="mb-3 flex items-center gap-2">
                      <p className="text-sm font-semibold">Aquisição</p>
                      {asset?.sourceType === 'purchase_receipt' && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Vinculado à compra · somente leitura</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField control={form.control} name="supplierName" render={({ field }) => (
                        <FormItem><FormLabel>Fornecedor</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="paymentMethod" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Forma e condição de pagamento</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Ex.: Pix à vista, Cartão 12x, boleto 30 dias"
                              {...field}
                              value={field.value ?? ''}
                              disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'}
                            />
                          </FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="costCenter" render={({ field }) => (
                        <FormItem><FormLabel>Centro de custo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'} /></FormControl></FormItem>
                      )} />
                      <FormField control={form.control} name="accountingAccount" render={({ field }) => (
                        <FormItem className="sm:col-span-2">
                          <FormLabel>Conta contábil</FormLabel>
                          <Select
                            value={field.value ?? ''}
                            onValueChange={field.onChange}
                            disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'}
                          >
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none"><span className="text-muted-foreground">Sem conta vinculada</span></SelectItem>
                              {dreAccounts.map((a: any) => (
                                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="documentUrl" render={({ field }) => (
                      <FormItem className="mt-3">
                        <FormLabel>Arquivo da nota fiscal</FormLabel>
                        <input
                          ref={fiscalDocumentInputRef}
                          type="file"
                          accept="application/pdf,image/*,.xml,text/xml,application/xml"
                          className="hidden"
                          onChange={(event) => void handleFiscalDocumentFile(event.target.files?.[0] ?? null)}
                        />
                        <input type="hidden" {...field} value={field.value ?? ''} />
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="flex h-10 flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                            {documentUrl ? (
                              <>
                                <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                                <span className="font-medium text-foreground">Nota fiscal anexada</span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">Nenhum arquivo anexado</span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!permissions.assets?.edit || uploadingFiscalDocument}
                            onClick={() => fiscalDocumentInputRef.current?.click()}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            {uploadingFiscalDocument ? 'Enviando...' : documentUrl ? 'Trocar NF' : 'Anexar NF'}
                          </Button>
                          {documentUrl ? (
                            <Button type="button" variant="outline" asChild>
                              <a href={documentUrl} target="_blank" rel="noreferrer">Abrir</a>
                            </Button>
                          ) : null}
                        </div>
                        {documentUrl && permissions.assets?.edit ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="mt-2 h-auto px-0 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => form.setValue('documentUrl', '', { shouldDirty: true })}
                          >
                            Remover anexo
                          </Button>
                        ) : null}
                      </FormItem>
                    )} />
                  </div>

                  <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2', assetStep !== 'acquisition' && 'hidden')}>
                    <FormField control={form.control} name="purchaseDate" render={({ field }) => (
                      <FormItem><FormLabel>Data da compra</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="purchaseValue" render={({ field }) => (
                      <FormItem><FormLabel>Valor</FormLabel><FormControl><CurrencyInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'} /></FormControl></FormItem>
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


                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem className={cn(assetStep !== 'condition' && 'hidden')}><FormLabel>Observações gerais</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                  )} />
                  </>
                  ) : null}

                  {assetStep !== 'history' ? (
                    <div className="flex flex-wrap gap-2 border-t pt-4">
                      <Button type="submit" className="bg-indigo-600 text-white hover:bg-indigo-700" disabled={!permissions.assets?.edit || saving || uploadingImage}>{saving ? 'Salvando...' : 'Salvar alterações'}</Button>
                    </div>
                  ) : null}

                  {assetStep === 'location' ? (
                    <div className="space-y-4">
                      <div className="space-y-5 rounded-md border p-4">
                        <p className="text-sm font-semibold">Registrar movimentação</p>

                        <div className="rounded-md border bg-muted/40 p-3">
                          <p className="text-xs font-medium uppercase text-muted-foreground">Responsável atual</p>
                          <p className="mt-1 text-sm font-semibold">{asset.responsibleName || '—'}</p>
                        </div>

                        <MovToggleField
                          label="Quem está retirando"
                          type={movWithdrawerType}
                          onTypeChange={(t) => { setMovWithdrawerType(t); setMovWithdrawerUserId(''); setMovWithdrawerFree(''); }}
                          freeValue={movWithdrawerFree}
                          onFreeChange={setMovWithdrawerFree}
                          freePlaceholder="Nome de quem está retirando"
                          registeredId={movWithdrawerUserId}
                          onRegisteredChange={setMovWithdrawerUserId}
                          options={activeUsers.map((u) => ({ id: u.id, label: u.username }))}
                          searchPlaceholder="Buscar colaborador..."
                          emptyMessage="Nenhum colaborador encontrado."
                          selectPlaceholder="Selecione um colaborador"
                        />

                        <MovToggleField
                          label="Para onde vai"
                          type={movDestType}
                          onTypeChange={(t) => { setMovDestType(t); setMovDestKioskId(''); setMovDestFree(''); }}
                          freeValue={movDestFree}
                          onFreeChange={setMovDestFree}
                          freePlaceholder="Destino"
                          registeredId={movDestKioskId}
                          onRegisteredChange={setMovDestKioskId}
                          options={kiosks.map((k) => ({ id: k.id, label: k.name }))}
                          searchPlaceholder="Buscar unidade..."
                          emptyMessage="Nenhuma unidade encontrada."
                          selectPlaceholder="Selecione uma unidade"
                        />

                        <MovToggleField
                          label="Novo responsável (opcional)"
                          type={movRespType}
                          onTypeChange={(t) => { setMovRespType(t); setMovRespUserId(''); setMovRespFree(''); }}
                          freeValue={movRespFree}
                          onFreeChange={setMovRespFree}
                          freePlaceholder="Nome do novo responsável"
                          registeredId={movRespUserId}
                          onRegisteredChange={setMovRespUserId}
                          options={activeUsers.map((u) => ({ id: u.id, label: u.username }))}
                          searchPlaceholder="Buscar colaborador..."
                          emptyMessage="Nenhum colaborador encontrado."
                          selectPlaceholder="Selecione o novo responsável"
                        />

                        <Textarea placeholder="Observações (opcional)" value={movNotes} onChange={(e) => setMovNotes(e.target.value)} rows={2} />

                        <Button type="button" onClick={() => void handleRetirada()} disabled={movSaving || !permissions.assets?.edit}>
                          <MoveRight className="mr-2 h-4 w-4" />
                          {movSaving ? 'Registrando...' : 'Registrar'}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {assetStep === 'history' && permissions.assets?.viewHistory ? (
                    <>
                  {permissions.assets?.viewHistory ? (
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Linha do tempo</p>
                        <Button type="button" variant="ghost" size="sm" onClick={() => void loadMovements()} disabled={loadingMovements}>
                          <History className="mr-2 h-4 w-4" />Atualizar
                        </Button>
                      </div>
                      {loadingMovements ? (
                        <p className="text-sm text-muted-foreground">Carregando histórico...</p>
                      ) : movements.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
                      ) : (
                        <ScrollArea className="max-h-[420px]">
                          <ol className="relative ml-1.5 space-y-3.5 border-l pl-5">
                            {movements.map((m) => (
                              <li key={m.id} className="relative">
                                <span className="absolute -left-[27px] grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-white ring-2 ring-background dark:bg-zinc-100 dark:text-zinc-900"><Check className="h-2.5 w-2.5" /></span>
                                <div className="rounded-xl border bg-card p-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-foreground/70">{MOVEMENT_LABEL[m.type] ?? m.type}</span>
                                    <span className="text-[11px] text-muted-foreground">{new Date(m.occurredAt).toLocaleString('pt-BR')}</span>
                                  </div>
                                  {m.fromStatus || m.toStatus ? (
                                    <div className="mt-1 text-[12.5px]">Status: {m.fromStatus ? STATUS_LABEL[m.fromStatus] : '—'} → <span className="font-medium">{m.toStatus ? STATUS_LABEL[m.toStatus] : '—'}</span></div>
                                  ) : null}
                                  {m.fromKioskName || m.toKioskName ? (
                                    <div className="mt-1 text-[12.5px]">Unidade: {m.fromKioskName || m.fromKioskId || '—'} → <span className="font-medium">{m.toKioskName || m.toKioskId || '—'}</span></div>
                                  ) : null}
                                  {m.notes ? <div className="mt-1 text-[12.5px] text-foreground/80">{m.notes}</div> : null}
                                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">por <span className="font-semibold text-foreground/70">{m.username || '—'}</span></div>
                                </div>
                              </li>
                            ))}
                          </ol>
                        </ScrollArea>
                      )}
                    </div>
                  ) : null}
                    </>
                  ) : null}
                </div>
                <div className="min-h-0 overflow-y-auto border-t bg-muted/30 p-5 xl:border-l xl:border-t-0">
                  <div className="rounded-xl border bg-card p-4 text-center">
                    <div className="mx-auto grid h-32 w-32 place-items-center overflow-hidden rounded-lg border bg-white p-2">
                      {qrUrl ? <img src={qrUrl} alt={`QR ${asset.code}`} className="h-full w-full object-contain" /> : <QrCode className="h-20 w-20 text-muted-foreground" />}
                    </div>
                    <p className="mt-2 font-mono text-[15px] font-bold">{asset.code}</p>
                    <p className="truncate text-xs text-muted-foreground">{form.watch('name')}</p>
                    <div className="mt-2 flex justify-center"><AssetStatusChip status={form.watch('status')} /></div>
                    <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={handlePrintLabel} disabled={!permissions.assets?.printLabels}>
                      <Printer className="mr-2 h-4 w-4" />Imprimir etiqueta
                    </Button>
                  </div>
                  <dl className="mt-4 space-y-2.5 text-[12px]">
                    <div>
                      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><MapPin className="h-3 w-3" />Unidade atual</dt>
                      <dd className="mt-0.5 font-medium">{asset.currentKioskName || asset.currentKioskId}</dd>
                      <dd className="text-[10px] text-muted-foreground">Onde o patrimônio está hoje</dd>
                    </div>
                    <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</dt><dd className="mt-0.5 font-medium">{asset.sourceType === 'purchase_receipt' ? 'Recebimento de compra' : 'Cadastro manual'}</dd></div>
                    {asset.supplierName ? <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</dt><dd className="mt-0.5 font-medium">{asset.supplierName}</dd></div> : null}
                    {asset.purchaseValue ? <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Valor de aquisição</dt><dd className="mt-0.5 font-mono font-semibold">{formatCurrency(asset.purchaseValue)}</dd></div> : null}
                  </dl>
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

function CurrencyInput({ value, onChange, onBlur, disabled }: {
  value?: number | string;
  onChange: (v: number | undefined) => void;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const numericValue = value == null || value === '' ? undefined : Number(value);
  const isValid = numericValue != null && !isNaN(numericValue);

  function handleFocus() {
    setFocused(true);
    setText(isValid ? String(numericValue).replace('.', ',') : '');
  }

  function handleBlur() {
    setFocused(false);
    onBlur?.();
    const parsed = parseFloat(text.replace(',', '.'));
    onChange(isNaN(parsed) ? undefined : parsed);
  }

  function handleChange(e: { target: { value: string } }) {
    const raw = e.target.value.replace(/[^0-9,]/g, '');
    const parts = raw.split(',');
    const normalized = parts.length > 2 ? parts[0] + ',' + parts.slice(1).join('') : raw;
    setText(normalized);
    const parsed = parseFloat(normalized.replace(',', '.'));
    onChange(isNaN(parsed) ? undefined : parsed);
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={focused ? text : isValid ? formatCurrency(numericValue) : ''}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder="R$ 0,00"
    />
  );
}

type MovToggleFieldProps = {
  label: string;
  type: 'cadastrado' | 'externo';
  onTypeChange: (t: 'cadastrado' | 'externo') => void;
  freeValue: string;
  onFreeChange: (v: string) => void;
  freePlaceholder: string;
  registeredId: string;
  onRegisteredChange: (id: string) => void;
  options: { id: string; label: string }[];
  searchPlaceholder: string;
  emptyMessage: string;
  selectPlaceholder: string;
};

function MovToggleField({
  label, type, onTypeChange, freeValue, onFreeChange, freePlaceholder,
  registeredId, onRegisteredChange, options, searchPlaceholder, emptyMessage, selectPlaceholder,
}: MovToggleFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === registeredId);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex rounded-md border overflow-hidden w-fit text-sm">
        <button type="button" onClick={() => onTypeChange('cadastrado')}
          className={cn('px-3 py-1.5 transition-colors', type === 'cadastrado' ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:bg-muted')}>
          Cadastrado
        </button>
        <button type="button" onClick={() => onTypeChange('externo')}
          className={cn('px-3 py-1.5 border-l transition-colors', type === 'externo' ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:bg-muted')}>
          Não cadastrado
        </button>
      </div>
      {type === 'cadastrado' ? (
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
              <span className={cn(!selected && 'text-muted-foreground')}>{selected ? selected.label : selectPlaceholder}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0" align="start">
            <Command>
              <CommandInput placeholder={searchPlaceholder} />
              <CommandList>
                <CommandEmpty>{emptyMessage}</CommandEmpty>
                <CommandGroup>
                  {options.map((o) => (
                    <CommandItem key={o.id} value={o.label} onSelect={() => { onRegisteredChange(o.id); setOpen(false); }}>
                      <Check className={cn('mr-2 h-4 w-4', registeredId === o.id ? 'opacity-100' : 'opacity-0')} />
                      {o.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <Input placeholder={freePlaceholder} value={freeValue} onChange={(e) => onFreeChange(e.target.value)} />
      )}
    </div>
  );
}

// ============================================================
// Redesign (Coala · Patrimônio — Fluxo) — presentational layer
// Accent = indigo-600 (#4f46e5), matching the Claude Design handoff.
// ============================================================

const CATEGORY_PALETTE = [
  { color: '#F97316', soft: '#FFF7ED' }, // Cozinha
  { color: '#0EA5E9', soft: '#F0F9FF' }, // Bar e Frente
  { color: '#6366F1', soft: '#EEF2FF' }, // TI e PDV
  { color: '#A855F7', soft: '#FAF5FF' }, // Mobiliário
  { color: '#06B6D4', soft: '#ECFEFF' }, // Climatização
  { color: '#EAB308', soft: '#FEFCE8' }, // Sinalização
  { color: '#10B981', soft: '#ECFDF5' },
  { color: '#EC4899', soft: '#FDF2F8' },
];

function categoryColor(name?: string) {
  const key = name || 'Patrimônio';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return CATEGORY_PALETTE[Math.abs(h) % CATEGORY_PALETTE.length];
}

const ASSET_STATUS_META: Record<AssetStatus, { label: string; short: string; dot: string; chip: string; solid: string }> = {
  ativo: { label: 'Ativo', short: 'Ativo', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', solid: 'bg-emerald-600 text-white' },
  em_manutencao: { label: 'Em manutenção', short: 'Manut.', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-800 ring-amber-200', solid: 'bg-amber-500 text-white' },
  fora_de_uso: { label: 'Fora de uso', short: 'Parado', dot: 'bg-zinc-400', chip: 'bg-zinc-100 text-zinc-700 ring-zinc-200', solid: 'bg-zinc-700 text-white' },
  extraviado: { label: 'Extraviado', short: 'Extrav.', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200', solid: 'bg-red-600 text-white' },
  vendido: { label: 'Vendido', short: 'Vendido', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 ring-blue-200', solid: 'bg-blue-600 text-white' },
  descartado: { label: 'Descartado', short: 'Descart.', dot: 'bg-zinc-500', chip: 'bg-zinc-100 text-zinc-700 ring-zinc-300', solid: 'bg-zinc-600 text-white' },
  baixado: { label: 'Baixado', short: 'Baixado', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200', solid: 'bg-rose-600 text-white' },
};

function ageLabel(dateStr?: string) {
  if (!dateStr) return '—';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return '—';
  const years = ms / (365.25 * 86400000);
  if (years >= 1) { const y = Math.floor(years); return `${y} ${y === 1 ? 'ano' : 'anos'}`; }
  const months = Math.floor(ms / (30 * 86400000));
  if (months >= 1) return `${months} ${months === 1 ? 'mês' : 'meses'}`;
  return `${Math.max(0, Math.floor(ms / 86400000))} dias`;
}

function fmtDateShort(d?: string) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function assetCodeTail(code?: string) {
  return (code || '').split('-').slice(-1)[0] || code || '—';
}

function AssetThumb({ asset, className, fit = 'cover' }: { asset: Asset; className?: string; fit?: 'cover' | 'contain' }) {
  const cat = categoryColor(asset.subcategory || asset.category);
  const [errored, setErrored] = useState(false);
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ background: cat.soft }}>
      {asset.imageUrl && !errored ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.imageUrl} alt="" loading="lazy" onError={() => setErrored(true)} className={cn('h-full w-full', fit === 'contain' ? 'object-contain' : 'object-cover')} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center" style={{ color: cat.color }}>
          <span className="font-mono text-base font-bold">{assetCodeTail(asset.code)}</span>
          <span className="text-[10px] font-semibold leading-tight">{asset.subcategory || asset.category || 'Patrimônio'}</span>
        </div>
      )}
    </div>
  );
}

function AssetStatusChip({ status, variant = 'chip' }: { status: AssetStatus; variant?: 'chip' | 'solid' | 'dot' }) {
  const meta = ASSET_STATUS_META[status];
  if (variant === 'dot') {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground"><span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />{meta.label}</span>;
  }
  if (variant === 'solid') {
    return <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', meta.solid)}>{meta.short}</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', meta.chip)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />{meta.label}
    </span>
  );
}

function AssetCardHero({ asset, onOpen }: { asset: Asset; onOpen: (asset: Asset) => void }) {
  const cat = categoryColor(asset.subcategory || asset.category);
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-card text-left ring-1 ring-border transition-all hover:-translate-y-0.5 hover:shadow-lg hover:ring-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: cat.soft }}>
        <AssetThumb asset={asset} className="h-full w-full" fit="contain" />
        <div className="absolute left-2.5 top-2.5"><AssetStatusChip status={asset.status} variant="solid" /></div>
        <div className="absolute right-2.5 top-2.5">
          <span className="rounded-md bg-white/90 px-1.5 py-1 font-mono text-[10px] font-bold text-zinc-900 ring-1 ring-zinc-200 backdrop-blur">{assetCodeTail(asset.code)}</span>
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5 opacity-0 transition group-hover:opacity-100">
          <span className="block rounded-md bg-zinc-900/85 py-1.5 text-center text-[11px] font-semibold text-white backdrop-blur">Ver detalhes</span>
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: cat.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />{asset.subcategory || asset.category || 'Patrimônio'}
        </div>
        <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug">{asset.name}</h3>
        <div className="mt-2 text-[11.5px] text-muted-foreground">{asset.brand}{asset.model ? <> · <span className="text-foreground/80">{asset.model}</span></> : null}</div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
          <div><div className="text-muted-foreground/70">Nº série</div><div className="truncate font-mono text-[10.5px] font-medium text-foreground/80">{asset.serialNumber || '—'}</div></div>
          <div><div className="text-muted-foreground/70">Idade</div><div className="font-medium text-foreground/80">{ageLabel(asset.purchaseDate)}</div></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"><MapPin className="h-3 w-3" /><span className="truncate font-medium text-foreground/80">{asset.currentKioskName || asset.currentKioskId}</span></span>
          <span className="font-mono text-[10.5px] font-semibold text-muted-foreground">{asset.code}</span>
        </div>
      </div>
    </button>
  );
}

function AssetListRow({ asset, onOpen }: { asset: Asset; onOpen: (asset: Asset) => void }) {
  const cat = categoryColor(asset.subcategory || asset.category);
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="group grid w-full grid-cols-[56px_minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_120px_140px_44px] items-center gap-4 border-b px-4 py-2.5 text-left transition last:border-b-0 hover:bg-muted/40"
    >
      <AssetThumb asset={asset} className="h-14 w-14 rounded-lg" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-bold text-muted-foreground">{asset.code}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: cat.color }}>{asset.subcategory || asset.category || 'Patrimônio'}</span>
        </div>
        <div className="truncate text-[13.5px] font-semibold">{asset.name}</div>
        <div className="truncate text-[11.5px] text-muted-foreground">{[asset.brand, asset.model].filter(Boolean).join(' · ')}{asset.serialNumber ? <> · <span className="font-mono">{asset.serialNumber}</span></> : null}</div>
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">Unidade</div>
        <div className="truncate text-[12.5px] font-medium">{asset.currentKioskName || asset.currentKioskId}</div>
      </div>
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">Compra</div>
        <div className="text-[12.5px] font-medium">{fmtDateShort(asset.purchaseDate)}</div>
        <div className="text-[10.5px] text-muted-foreground/70">{ageLabel(asset.purchaseDate)}</div>
      </div>
      <AssetStatusChip status={asset.status} />
      <span className="text-muted-foreground"><QrCode className="h-5 w-5" /></span>
      <span className="text-muted-foreground transition group-hover:text-foreground"><ChevronRight className="h-4 w-4" /></span>
    </button>
  );
}

function AssetTableView({ assets, onOpen }: { assets: Asset[]; onOpen: (asset: Asset) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="w-10 px-4 py-2.5" />
            <th className="px-4 py-2.5">Código</th>
            <th className="px-4 py-2.5">Patrimônio</th>
            <th className="px-4 py-2.5">Categoria</th>
            <th className="px-4 py-2.5">Marca / Modelo</th>
            <th className="px-4 py-2.5">Nº série</th>
            <th className="px-4 py-2.5">Unidade</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5 text-right">Valor</th>
            <th className="px-4 py-2.5">Compra</th>
            <th className="w-12 px-4 py-2.5 text-right">QR</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const cat = categoryColor(a.subcategory || a.category);
            return (
              <tr key={a.id} onClick={() => onOpen(a)} className="group cursor-pointer border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-2"><AssetThumb asset={a} className="h-10 w-10 rounded-md" /></td>
                <td className="px-4 py-2 font-mono text-[11.5px] font-semibold text-foreground/80">{a.code}</td>
                <td className="px-4 py-2"><div className="font-semibold">{a.name}</div></td>
                <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: cat.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />{a.subcategory || a.category || 'Patrimônio'}</span></td>
                <td className="px-4 py-2 text-foreground/80">{a.brand}{a.model ? <> · <span className="text-muted-foreground">{a.model}</span></> : null}</td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{a.serialNumber || '—'}</td>
                <td className="px-4 py-2 text-foreground/80">{a.currentKioskName || a.currentKioskId}</td>
                <td className="px-4 py-2"><AssetStatusChip status={a.status} /></td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-foreground/80">{formatCurrency(a.purchaseValue)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDateShort(a.purchaseDate)}</td>
                <td className="px-4 py-2 text-right text-muted-foreground"><QrCode className="ml-auto h-4 w-4" /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AssetKpi({ label, value, sub, tone, icon: Icon, active, onClick }: {
  label: string; value: React.ReactNode; sub?: string; tone: 'zinc' | 'emerald' | 'amber' | 'red' | 'indigo';
  icon?: React.ComponentType<{ className?: string }>; active?: boolean; onClick?: () => void;
}) {
  const bar = { zinc: 'bg-zinc-400', emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', indigo: 'bg-indigo-500' }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn('group relative flex items-center gap-3 rounded-xl px-3.5 py-3 text-left ring-1 transition disabled:cursor-default',
        active ? 'bg-muted/60 ring-foreground' : 'bg-card ring-border enabled:hover:ring-zinc-300')}
    >
      <span className={cn('h-10 w-1.5 rounded', bar)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">{Icon && <Icon className="h-3 w-3 text-muted-foreground" />}<span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span></div>
        <div className="mt-0.5 flex items-baseline gap-2"><span className="font-mono text-lg font-bold tabular-nums">{value}</span>{sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}</div>
      </div>
    </button>
  );
}

function FilterPill({ label, active, onClick, count, tone }: { label: string; active: boolean; onClick: () => void; count?: number; tone?: AssetStatus }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition',
        active ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-card text-foreground/70 ring-1 ring-border hover:ring-zinc-300')}
    >
      {tone && <span className={cn('h-1.5 w-1.5 rounded-full', ASSET_STATUS_META[tone]?.dot)} />}
      {label}
      {count != null && <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', active ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>{count}</span>}
    </button>
  );
}

function AssetCodeReaderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [rawCode, setRawCode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const normalizedCode = normalizeAssetCodeInput(rawCode);

  const openAsset = (value = rawCode) => {
    const code = normalizeAssetCodeInput(value);
    if (!/^PAT-\d+$/.test(code)) {
      toast({
        variant: 'destructive',
        title: 'Código inválido',
        description: 'Informe um código no formato PAT-000123 ou apenas o número do patrimônio.',
      });
      return;
    }

    onOpenChange(false);
    setScannerOpen(false);
    setRawCode('');
    window.location.href = `/patrimonio/${encodeURIComponent(code)}`;
  };

  const handleScanSuccess = (decodedText: string) => {
    const code = normalizeAssetCodeInput(decodedText);
    setRawCode(code);
    openAsset(code);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ler patrimônio por código</DialogTitle>
            <DialogDescription>
              Teste a abertura da consulta pelo número patrimonial. Você pode informar PAT-000123, apenas 123, ou escanear o QR/barcode atual.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Código do patrimônio</label>
              <Input
                autoFocus
                value={rawCode}
                onChange={(event) => setRawCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openAsset();
                }}
                placeholder="Ex: PAT-000123 ou 123"
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Normalizado: <span className="font-mono font-semibold text-foreground">{normalizedCode || '—'}</span>
              </p>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              Esta versão de teste não faz OCR de texto impresso pela câmera. A câmera lê QR/barcode; para texto PAT impresso, use o campo acima ou um leitor físico que envie o código como teclado.
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
                <QrCode className="mr-2 h-4 w-4" />
                Escanear QR/barcode
              </Button>
              <Button type="button" onClick={() => openAsset()} disabled={!normalizedCode}>
                Abrir consulta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BarcodeScannerModal
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScanSuccess={handleScanSuccess}
      />
    </>
  );
}

export function AssetManagement() {
  const { assets, loading } = useAssets();
  const { permissions } = useAuth();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [showNew, setShowNew] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showCodeReader, setShowCodeReader] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [statusFilter, setStatusFilter] = useState<'todos' | AssetStatus>('todos');
  const [categoryFilter, setCategoryFilter] = useState('todas');
  const [unitFilter, setUnitFilter] = useState('todas');
  const [brandFilter, setBrandFilter] = useState('todas');
  const [periodFilter, setPeriodFilter] = useState<'todos' | 'this_year' | 'last_year' | 'older'>('todos');
  const [view, setView] = useState<'grid' | 'list' | 'table'>('grid');

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
  }, [searchParams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const thisYear = new Date().getFullYear();
    return assets.filter((asset) => {
      const matchesSearch = !q || [asset.code, asset.name, asset.category, asset.subcategory, asset.brand, asset.model, asset.serialNumber, asset.currentKioskName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
      const matchesStatus = statusFilter === 'todos' || asset.status === statusFilter;
      const matchesCategory = categoryFilter === 'todas' || (asset.subcategory || 'Sem subcategoria') === categoryFilter;
      const matchesUnit = unitFilter === 'todas' || asset.currentKioskId === unitFilter;
      const matchesBrand = brandFilter === 'todas' || asset.brand === brandFilter;
      let matchesPeriod = true;
      if (periodFilter !== 'todos') {
        const yr = asset.purchaseDate ? new Date(asset.purchaseDate).getFullYear() : NaN;
        if (periodFilter === 'this_year') matchesPeriod = yr === thisYear;
        else if (periodFilter === 'last_year') matchesPeriod = yr === thisYear - 1;
        else matchesPeriod = !Number.isNaN(yr) && yr < thisYear - 1;
      }
      return matchesSearch && matchesStatus && matchesCategory && matchesUnit && matchesBrand && matchesPeriod;
    });
  }, [assets, search, statusFilter, categoryFilter, unitFilter, brandFilter, periodFilter]);

  const categories = useMemo(() => Array.from(new Set(assets.map((asset) => asset.subcategory || 'Sem subcategoria'))).sort(), [assets]);
  const brands = useMemo(() => Array.from(new Set(assets.map((asset) => asset.brand).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'pt-BR')), [assets]);
  const units = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((asset) => map.set(asset.currentKioskId, asset.currentKioskName || asset.currentKioskId));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [assets]);

  const summary = useMemo(() => {
    const totalValue = assets.filter((asset) => asset.status !== 'baixado').reduce((sum, asset) => sum + (asset.purchaseValue || 0), 0);
    return {
      total: assets.length,
      active: assets.filter((asset) => asset.status === 'ativo').length,
      maintenance: assets.filter((asset) => asset.status === 'em_manutencao').length,
      foraDeUso: assets.filter((asset) => asset.status === 'fora_de_uso').length,
      retired: assets.filter((asset) => asset.status === 'baixado').length,
      totalValue,
    };
  }, [assets]);

  if (!permissions.assets?.view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem permissão para acessar patrimônio.</p>;
  }

  const viewOptions: { id: 'grid' | 'list' | 'table'; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: 'grid', icon: Grid2X2, label: 'Grade' },
    { id: 'list', icon: Rows3, label: 'Lista' },
    { id: 'table', icon: Table2, label: 'Tabela' },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" /> Coala <span className="text-muted-foreground/40">/</span>
            <span className="text-foreground/80">Patrimônio</span>
          </div>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">Patrimônio</h1>
          <p className="text-sm text-muted-foreground">Máquinas, equipamentos e mobiliário rastreados por código interno e QR Code.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShowCodeReader(true)}>
            <QrCode className="mr-2 h-4 w-4" />
            Ler código
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCategories(true)} disabled={!permissions.assets?.create && !permissions.assets?.edit}><Tags className="mr-2 h-4 w-4" />Categorias</Button>
          <Button size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => setShowNew(true)} disabled={!permissions.assets?.create}><Plus className="mr-2 h-4 w-4" />Novo patrimônio</Button>
        </div>
      </div>

      {/* KPIs — clicáveis (filtram por status) */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <AssetKpi label="Total" value={summary.total} sub="no parque" tone="indigo" icon={Box} active={statusFilter === 'todos'} onClick={() => setStatusFilter('todos')} />
        <AssetKpi label="Ativos" value={summary.active} sub="em operação" tone="emerald" icon={Box} active={statusFilter === 'ativo'} onClick={() => setStatusFilter('ativo')} />
        <AssetKpi label="Em manutenção" value={summary.maintenance} sub="aguardando OS" tone="amber" icon={Wrench} active={statusFilter === 'em_manutencao'} onClick={() => setStatusFilter('em_manutencao')} />
        <AssetKpi label="Baixados" value={summary.retired} sub="último ano" tone="red" icon={History} active={statusFilter === 'baixado'} onClick={() => setStatusFilter('baixado')} />
        <AssetKpi label="Valor patrimonial" value={formatCurrency(summary.totalValue)} sub="aquisição" tone="zinc" icon={Coins} />
      </div>

      {/* Filtros + view toggle */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1 md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por código, série, nome…"
              className="h-9 w-full rounded-lg border bg-muted/40 pl-9 pr-3 text-[13px] outline-none transition focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-full md:w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-9 w-full md:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas unidades</SelectItem>
              {units.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="h-9 w-full md:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas marcas</SelectItem>
              {brands.map((brand) => <SelectItem key={brand} value={brand}>{brand}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={periodFilter} onValueChange={(value) => setPeriodFilter(value as typeof periodFilter)}>
            <SelectTrigger className="h-9 w-full md:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Qualquer período</SelectItem>
              <SelectItem value="this_year">Comprado este ano</SelectItem>
              <SelectItem value="last_year">Comprado ano passado</SelectItem>
              <SelectItem value="older">Anteriores</SelectItem>
            </SelectContent>
          </Select>

          <span className="ml-auto inline-flex rounded-lg border bg-muted/40 p-0.5">
            {viewOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setView(o.id)}
                className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-semibold transition',
                  view === o.id ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}
              >
                <o.icon className="h-3 w-3" />{o.label}
              </button>
            ))}
          </span>
        </div>

        {/* Status pill row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill label="Todos" active={statusFilter === 'todos'} onClick={() => setStatusFilter('todos')} count={summary.total} />
          <FilterPill label="Ativos" active={statusFilter === 'ativo'} onClick={() => setStatusFilter('ativo')} count={summary.active} tone="ativo" />
          <FilterPill label="Em manutenção" active={statusFilter === 'em_manutencao'} onClick={() => setStatusFilter('em_manutencao')} count={summary.maintenance} tone="em_manutencao" />
          <FilterPill label="Fora de uso" active={statusFilter === 'fora_de_uso'} onClick={() => setStatusFilter('fora_de_uso')} count={summary.foraDeUso} tone="fora_de_uso" />
          <FilterPill label="Baixados" active={statusFilter === 'baixado'} onClick={() => setStatusFilter('baixado')} count={summary.retired} tone="baixado" />
          <span className="mx-1 h-5 w-px bg-border" />
          <span className="self-center text-[11.5px] text-muted-foreground">
            <span className="font-semibold text-foreground/80">{filtered.length}</span> de {summary.total} patrimônios
          </span>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-xl border p-6 text-sm text-muted-foreground">Carregando patrimônio...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-16 text-center text-sm text-muted-foreground">Nenhum patrimônio encontrado.</div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((asset) => <AssetCardHero key={asset.id} asset={asset} onOpen={setSelected} />)}
        </div>
      ) : view === 'list' ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          {filtered.map((asset) => <AssetListRow key={asset.id} asset={asset} onOpen={setSelected} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <AssetTableView assets={filtered} onOpen={setSelected} />
        </div>
      )}

      <AssetFormSheet open={showNew} onOpenChange={setShowNew} />
      <AssetCategoryDialog open={showCategories} onOpenChange={setShowCategories} />
      <AssetCodeReaderDialog open={showCodeReader} onOpenChange={setShowCodeReader} />
      <AssetDetailDialog asset={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
