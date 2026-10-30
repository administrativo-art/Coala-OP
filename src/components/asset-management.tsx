"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@/lib/zod-resolver';
import { Camera, Check, ChevronRight, ChevronsUpDown, FileText, Grid2X2, History, ImageIcon, MapPin, Paperclip, Plus, X, Printer, QrCode, Rows3, Table2, Tags, TriangleAlert, Upload } from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { BarcodeScannerModal } from '@/components/barcode-scanner-modal';
import { fieldInputClass } from '@/components/patterns/field';
import { HeroChip } from '@/components/patterns/hero-chip';
import { LiftRow } from '@/components/patterns/lift-row';
import { PageHero } from '@/components/patterns/page-hero';
import { ControlSearch } from '@/components/patterns/control-panel';
import { Segmented } from '@/components/patterns/segmented';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { WizardModal, type WizardStep } from '@/components/patterns/wizard-modal';
import { cn } from '@/lib/utils';

const assetSchema = z.object({
  code: z.string()
    .trim()
    .min(1, 'Informe ou escaneie o código da placa.')
    .refine((value) => /^PAT-\d+$/.test(normalizeAssetCodeInput(value)), 'Use PAT-000123 ou apenas o número da placa.'),
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
  responsibleUserId: z.string().optional(),
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
  code: z.string()
    .optional()
    .refine((value) => {
      const normalized = normalizeAssetCodeInput(value ?? '');
      return !normalized || normalized.startsWith('PEND-') || /^PAT-\d+$/.test(normalized);
    }, 'Use PAT-000123, apenas o número da placa ou mantenha o código provisório.'),
  status: z.enum(['ativo', 'em_manutencao', 'fora_de_uso', 'extraviado', 'vendido', 'descartado', 'baixado']),
});

type AssetEditFormValues = z.infer<typeof assetEditSchema>;
type AssetStep = 'identification' | 'audit' | 'location' | 'acquisition' | 'history';

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
  MOVIMENTACAO: 'Movimentação',
  TRANSFERENCIA_POSSE: 'Transferência de posse',
  MIGRACAO_BASE: 'Normalização do cadastro',
  MANUTENCAO_ORDEM: 'Ordem de manutenção',
  MANUTENCAO_DESATIVADA: 'Manutenção desativada',
};

const HISTORY_SOURCE_LABEL: Record<string, string> = {
  movement: 'Movimentação',
  custody: 'Posse',
  audit: 'Auditoria',
  maintenance: 'Manutenção',
  document: 'Documento',
};

function historyEventLabel(value: string) {
  const movement = MOVEMENT_LABEL[value as AssetMovement['type']];
  if (movement) return movement;
  return value.replaceAll('_', ' ').toLocaleLowerCase('pt-BR').replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

const ASSET_STEPS: { id: AssetStep; label: string; description: string }[] = [
  { id: 'identification', label: 'Identificação', description: 'Nome, placa, status e dados do equipamento.' },
  { id: 'audit', label: 'Auditoria e manutenção', description: 'Auditorias, planos preventivos, ocorrências e ordens.' },
  { id: 'location', label: 'Local e posse', description: 'Onde o bem está, com quem está e o histórico de local e posse.' },
  { id: 'acquisition', label: 'Aquisição', description: 'Compra, recebimento, nota fiscal, garantia e classificação contábil.' },
  { id: 'history', label: 'Histórico geral', description: 'Linha cronológica consolidada do ciclo patrimonial.' },
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
  if (normalized.startsWith('PEND-')) return normalized;
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

class AssetApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function assetApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Usuário não autenticado.');
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AssetApiError(payload.error || 'Não foi possível concluir a operação.', response.status);
  return payload as T;
}

async function uploadAuditPhoto(file: File, assetId: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Usuário não autenticado.');
  const formData = new FormData();
  formData.set('file', file);
  const response = await fetch(`/api/assets/${assetId}/audits/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.storagePath !== 'string' || typeof payload.contentHash !== 'string') throw new Error(payload.error || 'Falha ao enviar a foto da auditoria.');
  return payload as { storagePath: string; contentHash: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; size: number };
}

const SUMMARY_LABEL = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground';
const ASSET_CONDITION_LABEL: Record<string, string> = { new: 'Novo', good: 'Bom', regular: 'Regular', poor: 'Ruim', critical: 'Crítico' };
const ASSET_OPERATIONAL_LABEL: Record<string, string> = { operational: 'Operacional', restricted: 'Operação restrita', stopped: 'Parado' };

/** Modal secundário centrado na área clara do detalhe (sidebar de 360px à esquerda); cabeçalho e rodapé fixos, só o corpo rola. */
function AssetSheetDialog({ open, onOpenChange, title, description, footer, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; footer: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent flush className="flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-2xl sm:left-[calc(50%+180px)]">
        <DialogHeader className="shrink-0 px-6 pb-2 pt-6">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">{children}</div>
        <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4 sm:justify-end">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Foto na hora (câmera do celular/tablet) ou anexo de arquivo; várias imagens por registro. */
function AssetPhotoPicker({ files, onChange, label }: { files: File[]; onChange: (files: File[]) => void; label: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const add = (list: FileList | null) => { if (list?.length) onChange([...files, ...Array.from(list)]); };
  return (
    <div className="space-y-2">
      <FieldLabel required>{label}</FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" onClick={() => cameraRef.current?.click()}><Camera className="mr-2 h-4 w-4" />Tirar foto agora</Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><Paperclip className="mr-2 h-4 w-4" />Anexar arquivo</Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {previews.map((url, index) => (
            <div key={url} className="relative h-16 w-16 overflow-hidden rounded-xl border">
              <img src={url} alt={`Foto ${index + 1}`} className="h-full w-full object-cover" />
              <button type="button" aria-label="Remover foto" onClick={() => onChange(files.filter((_, i) => i !== index))} className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[11.5px] text-muted-foreground">No celular e no tablet abre a câmera direto. Pelo menos uma foto é obrigatória.</p>
    </div>
  );
}

const OWNERSHIP_LABEL = { owned: 'Próprio', leased: 'Alugado', loaned: 'Comodato', third_party: 'De terceiro', unknown: 'Não informado' } as const;

type AssetPage<T> = { items: T[]; nextCursor: string | null };
type AssetAuditRow = { id: string; auditedAt?: string; createdAt?: string; condition?: string; operationalStatus?: string; description?: string; auditor?: { nameSnapshot?: string } };
type AssetPlanRow = { id: string; name?: string; active?: boolean; nextDueDate?: string; cadence?: { unit?: string; interval?: number }; assignee?: { nameSnapshot?: string } };
type AssetOccurrenceRow = { id: string; type?: string; status?: string; dueDate?: string; description?: string; taskStatus?: string; orderStatus?: string; orderProtocol?: string };
type AssetHistoryRow = { id: string; at: string; type: string; source: string; description: string };
type AssetCustodyTransferRow = {
  id: string;
  createdAt?: string;
  effectiveAt?: string;
  fromHolder?: { holderType?: string; holderNameSnapshot?: string } | null;
  toHolder?: { holderType?: string; holderNameSnapshot?: string } | null;
  actor?: { nameSnapshot?: string } | null;
  status?: string;
  generateTerm?: boolean;
  generatedDocumentId?: string | null;
  employeeDocumentId?: string | null;
  termGenerationCompletedAt?: string | null;
  signatureUpdatedAt?: string | null;
  signedAt?: string | null;
  notes?: string | null;
};
type AssetAcquisitionReadModel = { readOnly: boolean; sourceType: string | null; order: Record<string, unknown> | null; receipt: Record<string, unknown> | null; item: Record<string, unknown> | null };

async function downloadAssetFile(path: string, filename: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Usuário não autenticado.');
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Não foi possível baixar o arquivo.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

const FORM_PAYMENTS = ['PIX', 'Boleto', 'Cartão de crédito', 'Transferência / TED', 'Dinheiro', 'Cartão BNDES'];
const FORM_INPUT = fieldInputClass;

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 flex items-center gap-1 text-xs font-bold text-ds-ink-2">
      {children}{required && <span className="text-ds-danger">*</span>}
    </label>
  );
}

function FormBlock({ children }: { n?: string; title?: string; hint?: string; children: React.ReactNode }) {
  return <section className="space-y-4">{children}</section>;
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
function LabelPreview({ code, name, brand, model, unitName, category }: { code?: string; name?: string; brand?: string; model?: string; unitName?: string; category?: string }) {
  const cat = category ? categoryColor(category) : null;
  const normalizedCode = normalizeAssetCodeInput(code ?? '');
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
        <div className="font-mono text-[13px] font-bold tabular-nums text-muted-foreground">{normalizedCode || 'Informe a placa'}</div>
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
  const { activeUsers } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<AssetStatus>('ativo');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: { code: '', name: '', category: 'Patrimônio', subcategory: '', brand: '', model: '', serialNumber: '', imageUrl: '', currentKioskId: '', purchaseDate: '', supplierName: '', invoiceNumber: '', paymentMethod: '', warrantyEndsAt: '', exactLocation: '', responsibleUserId: '', responsibleName: '', notes: '' },
  });
  const v = form.watch();
  const imageUrl = v.imageUrl;
  const unitName = kiosks.find((k) => k.id === v.currentKioskId)?.name;
  const filledCount = (['code', 'name', 'subcategory', 'currentKioskId', 'brand', 'model', 'serialNumber', 'purchaseValue', 'supplierName'] as const)
    .filter((k) => String((v as Record<string, unknown>)[k] ?? '').trim()).length;
  const ok = Boolean(v.code?.trim()) && Boolean(v.name?.trim()) && Boolean(v.currentKioskId);
  const [step, setStep] = useState(0);
  const [highestStep, setHighestStep] = useState(0);
  const formSteps: WizardStep[] = [
    { id: 'identification', label: 'Identificação', description: 'Aparece na etiqueta e na busca.', summary: v.name?.trim() || undefined },
    { id: 'acquisition', label: 'Compra e origem', description: 'Dados de aquisição para depreciação e garantia.', summary: v.supplierName?.trim() || undefined },
    { id: 'location', label: 'Local e situação', description: 'A unidade é obrigatória.', summary: unitName || undefined },
  ];

  function validateStep(index: number) {
    if (index === 0) {
      const missing = !v.name?.trim() || !v.code?.trim();
      if (missing) void form.trigger(['name', 'code']);
      return !missing;
    }
    if (index === 2) {
      const missing = !v.currentKioskId;
      if (missing) void form.trigger(['currentKioskId']);
      return !missing;
    }
    return true;
  }

  function closeModal(next: boolean) {
    if (next) return onOpenChange(true);
    resetAll();
    onOpenChange(false);
  }

  function resetAll() {
    form.reset();
    setStatus('ativo');
    setStep(0);
    setHighestStep(0);
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
    const responsible = activeUsers.find((user) => user.id === values.responsibleUserId);
    const normalizedCode = normalizeAssetCodeInput(values.code);
    setSubmitting(true);
    try {
      await addAsset({
        ...values,
        code: normalizedCode,
        status,
        currentKioskName: kiosk?.name,
        responsibleUserId: responsible?.id,
        responsibleName: responsible?.username,
        sourceType: 'manual',
      });
      toast({ title: 'Patrimônio cadastrado.' });
      resetAll();
      onOpenChange(false);
    } catch (error) {
      toast({ title: 'Falha ao cadastrar patrimônio', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }

  function handlePlateScan(decodedText: string) {
    const code = normalizeAssetCodeInput(decodedText);
    form.setValue('code', code, { shouldDirty: true, shouldValidate: true });
    setScannerOpen(false);
    toast({ title: 'Placa identificada', description: code });
  }

  return (
    <>
      <Form {...form}>
        <WizardModal
          open={open}
          onOpenChange={closeModal}
          mode="new"
          stepper="sidebar"
          saveMode="final"
          sidebarWidth={360}
          height={800}
          steps={formSteps}
          stepIndex={step}
          highestStep={highestStep}
          onStepChange={setStep}
          onValidateStep={(index) => {
            const valid = validateStep(index);
            if (valid) setHighestStep((current) => Math.max(current, index + 1));
            return valid;
          }}
          submitLabel="Cadastrar patrimônio"
          onSubmit={() => void form.handleSubmit(onSubmit)()}
          submitting={submitting}
          dirty={form.formState.isDirty}
          title="Novo patrimônio"
          description="Cadastre o item, vincule uma unidade e prepare o QR Code."
          sidebar={
            <div className="space-y-5">
              <div>
                <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">Cadastro · Patrimônio</p>
                <h2 className="mt-2 wrap-break-word text-[26px] font-extrabold leading-tight tracking-[-0.03em]">{v.name?.trim() || 'Novo patrimônio'}</h2>
                <p className="mt-1 font-mono text-[13px] text-ds-on-dark-sub">{normalizeAssetCodeInput(v.code ?? '') || 'Informe a placa'}</p>
              </div>
              <div className="rounded-ds-btn-lg bg-white/6 p-4">
                <p className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Prévia da etiqueta</p>
                <LabelPreview code={v.code} name={v.name} brand={v.brand} model={v.model} unitName={unitName} category={v.subcategory} />
              </div>
              <div>
                <div className="flex items-center justify-between text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">
                  <span>Preenchimento</span>
                  <span>{filledCount} de 9</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-ds-accent transition-all" style={{ width: `${Math.round((filledCount / 9) * 100)}%` }} />
                </div>
                {!ok && <p className="mt-2 text-[12px] text-ds-on-dark-2">Faltam código da placa, nome e unidade.</p>}
              </div>
              <Button type="button" variant="on-dark-secondary" size="xs" onClick={resetAll}>Limpar formulário</Button>
            </div>
          }
        >
          <form onSubmit={(event) => { event.preventDefault(); }} className="space-y-6">
                {step === 0 && (
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
                          <FieldLabel required>Código da placa</FieldLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <input
                                className={cn(FORM_INPUT, 'font-mono uppercase')}
                                placeholder="Ex: PAT-000123 ou 123"
                                {...field}
                                value={field.value ?? ''}
                                onBlur={(event) => {
                                  const normalized = normalizeAssetCodeInput(event.target.value);
                                  field.onBlur();
                                  if (normalized) form.setValue('code', normalized, { shouldDirty: true, shouldValidate: true });
                                }}
                              />
                            </FormControl>
                            <Button type="button" variant="outline" className="h-10 shrink-0" onClick={() => setScannerOpen(true)}>
                              <QrCode className="mr-1.5 h-4 w-4" />
                              Escanear
                            </Button>
                          </div>
                          <p className="mt-1 text-[10px] leading-tight text-muted-foreground">Escaneie o código de barras da placa ou digite a numeração impressa.</p>
                          <FormMessage />
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
                )}
                {step === 1 && (
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
                )}
                {step === 2 && (
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
                    <FormField control={form.control} name="responsibleUserId" render={({ field }) => (
                      <FormItem>
                        <FieldLabel>Responsável</FieldLabel>
                        <Select value={field.value || 'none'} onValueChange={(value) => field.onChange(value === 'none' ? '' : value)}>
                          <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="none">Sem responsável</SelectItem>
                            {activeUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )} />
                  </div>
                  <div>
                    <FieldLabel>Status inicial</FieldLabel>
                    <StatusPicker value={status} onChange={setStatus} />
                  </div>
                </FormBlock>
                )}
          </form>
        </WizardModal>
      </Form>
      <BarcodeScannerModal
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScanSuccess={handlePlateScan}
      />
    </>
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
            <input aria-label="Nome da categoria" className={fieldInputClass} placeholder="Ex: Máquinas, Equipamentos, Mobiliário" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea className="rounded-ds-md border-ds-border-input bg-ds-input text-[13px]" placeholder="Descrição opcional" value={description} onChange={(e) => setDescription(e.target.value)} />
            <Button type="button" variant="primary-modal" size="md" onClick={handleSubmit} disabled={!name.trim()}>
              <Plus aria-hidden="true" className="mr-2 h-4 w-4" />Adicionar categoria
            </Button>
          </div>
          <div className="rounded-ds-btn-lg border border-ds-border">
            {categories.length === 0 ? (
              <p className="p-4 text-sm text-ds-ink-muted">Nenhuma categoria cadastrada.</p>
            ) : categories.map((category) => (
              <div key={category.id} className="flex items-start gap-2.5 border-b border-ds-divider p-3 last:border-b-0">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: categoryColor(category.name).color }} />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-ds-ink">{category.name}</p>
                  {category.description ? <p className="text-xs text-ds-ink-muted">{category.description}</p> : null}
                </div>
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
  const { permissions, activeUsers, user } = useAuth();
  const { data: financialAccounts } = useFinancialCollection<any>(financialCollection('accounts'));
  const accountingAccounts = useMemo(
    () => (financialAccounts || []).filter((a: any) => a.active !== false && !a.isGroup),
    [financialAccounts]
  );
  const { categories, refreshAssets, updateAsset, updateAssetStatus, recordLabelPrint, fetchMovements, recordRetirada } = useAssets();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fiscalDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingFiscalDocument, setUploadingFiscalDocument] = useState(false);
  const [plateScannerOpen, setPlateScannerOpen] = useState(false);
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
  const [locationPanelOpen, setLocationPanelOpen] = useState(false);
  const [locationKind, setLocationKind] = useState<'unit' | 'external' | 'in_transit'>('unit');
  const [custodyDialogOpen, setCustodyDialogOpen] = useState(false);
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
  const [maintenanceMode, setMaintenanceMode] = useState<'corrective' | 'preventive'>('corrective');
  const [maintenanceDescription, setMaintenanceDescription] = useState('');
  const [maintenancePriority, setMaintenancePriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [maintenanceDueDate, setMaintenanceDueDate] = useState('');
  const [maintenanceAssignee, setMaintenanceAssignee] = useState('');
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [generateTerm, setGenerateTerm] = useState(true);
  const [lifecycleVersion, setLifecycleVersion] = useState(asset?.lifecycleVersion ?? 1);
  const [auditPhotos, setAuditPhotos] = useState<File[]>([]);
  const [auditCondition, setAuditCondition] = useState<'new' | 'good' | 'regular' | 'poor' | 'critical'>('good');
  const [auditOperational, setAuditOperational] = useState<'operational' | 'restricted' | 'stopped'>('operational');
  const [auditDescription, setAuditDescription] = useState('');
  const [auditCorrective, setAuditCorrective] = useState(false);
  const [auditSaving, setAuditSaving] = useState(false);
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);
  const [planName, setPlanName] = useState('Manutenção preventiva');
  const [planInterval, setPlanInterval] = useState('6');
  const [planNextDate, setPlanNextDate] = useState('');
  const [planChecklist, setPlanChecklist] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'lifecycle' | 'maintenance' | 'custody' | 'movement'>('all');
  const [auditsPage, setAuditsPage] = useState<AssetPage<AssetAuditRow>>({ items: [], nextCursor: null });
  const [plansPage, setPlansPage] = useState<AssetPage<AssetPlanRow>>({ items: [], nextCursor: null });
  const [occurrencesPage, setOccurrencesPage] = useState<AssetPage<AssetOccurrenceRow>>({ items: [], nextCursor: null });
  const [historyPage, setHistoryPage] = useState<AssetPage<AssetHistoryRow>>({ items: [], nextCursor: null });
  const [custodyTransfersPage, setCustodyTransfersPage] = useState<AssetPage<AssetCustodyTransferRow>>({ items: [], nextCursor: null });
  const [acquisitionModel, setAcquisitionModel] = useState<AssetAcquisitionReadModel | null>(null);
  const [acquisitionStatus, setAcquisitionStatus] = useState<'idle' | 'loading' | 'loaded' | 'forbidden' | 'error'>('idle');
  const [readModelsLoading, setReadModelsLoading] = useState(false);
  const [readModelsError, setReadModelsError] = useState<string | null>(null);
  const form = useForm<AssetEditFormValues>({
    resolver: zodResolver(assetEditSchema),
    defaultValues: {
      code: '',
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
      responsibleUserId: '',
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
      code: asset.code ?? '',
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
      responsibleUserId: asset.responsibleUserId
        ?? activeUsers.find((user) => user.username === asset.responsibleName)?.id
        ?? '',
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
    setLifecycleVersion(asset.lifecycleVersion ?? 1);
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

  const historyKind = historyFilter === 'all' ? '' : historyFilter;

  async function loadReadModels(options: { append?: boolean; target?: 'audits' | 'plans' | 'occurrences' | 'history' | 'custody' } = {}) {
    if (!asset || !permissions.assets?.viewHistory) return;
    const { append = false, target } = options;
    setReadModelsLoading(true); setReadModelsError(null);
    try {
      const requests: Array<Promise<void>> = [];
      if (!target || target === 'audits') requests.push(assetApi<AssetPage<AssetAuditRow>>(`/api/assets/${asset.id}/audits/list?limit=20${append && auditsPage.nextCursor ? `&cursor=${encodeURIComponent(auditsPage.nextCursor)}` : ''}`).then((page) => setAuditsPage((current) => ({ items: append ? [...current.items, ...page.items] : page.items, nextCursor: page.nextCursor }))));
      if (!target || target === 'plans') requests.push(assetApi<AssetPage<AssetPlanRow>>(`/api/assets/${asset.id}/maintenance-plans/list?limit=20${append && plansPage.nextCursor ? `&cursor=${encodeURIComponent(plansPage.nextCursor)}` : ''}`).then((page) => setPlansPage((current) => ({ items: append ? [...current.items, ...page.items] : page.items, nextCursor: page.nextCursor }))));
      if (!target || target === 'occurrences') requests.push(assetApi<AssetPage<AssetOccurrenceRow>>(`/api/assets/${asset.id}/maintenance-occurrences/list?limit=20${append && occurrencesPage.nextCursor ? `&cursor=${encodeURIComponent(occurrencesPage.nextCursor)}` : ''}`).then((page) => setOccurrencesPage((current) => ({ items: append ? [...current.items, ...page.items] : page.items, nextCursor: page.nextCursor }))));
      if (!target || target === 'history') requests.push(assetApi<AssetPage<AssetHistoryRow>>(`/api/assets/${asset.id}/history?limit=30${historyKind ? `&kind=${historyKind}` : ''}${append && historyPage.nextCursor ? `&cursor=${encodeURIComponent(historyPage.nextCursor)}` : ''}`).then((page) => setHistoryPage((current) => ({ items: append ? [...current.items, ...page.items] : page.items, nextCursor: page.nextCursor }))));
      if (!target || target === 'custody') requests.push(assetApi<AssetPage<AssetCustodyTransferRow>>(`/api/assets/${asset.id}/custody-transfers/list?limit=20${append && custodyTransfersPage.nextCursor ? `&cursor=${encodeURIComponent(custodyTransfersPage.nextCursor)}` : ''}`).then((page) => setCustodyTransfersPage((current) => ({ items: append ? [...current.items, ...page.items] : page.items, nextCursor: page.nextCursor }))));
      await Promise.all(requests);
    } catch (error) { setReadModelsError(error instanceof Error ? error.message : 'Falha ao carregar o ciclo patrimonial.'); }
    finally { setReadModelsLoading(false); }
  }

  useEffect(() => {
    if (!asset) return;
    setAuditsPage({ items: [], nextCursor: null }); setPlansPage({ items: [], nextCursor: null }); setOccurrencesPage({ items: [], nextCursor: null }); setHistoryPage({ items: [], nextCursor: null }); setCustodyTransfersPage({ items: [], nextCursor: null });
    if (permissions.assets?.viewHistory) void loadReadModels();
    setAcquisitionModel(null); setAcquisitionStatus('loading');
    assetApi<AssetAcquisitionReadModel>(`/api/assets/${asset.id}/acquisition`)
      .then((model) => { setAcquisitionModel(model); setAcquisitionStatus('loaded'); })
      .catch((error) => { setAcquisitionModel(null); setAcquisitionStatus(error instanceof AssetApiError && error.status === 403 ? 'forbidden' : 'error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, permissions.assets?.viewHistory]);

  useEffect(() => {
    if (assetStep === 'location') setHistoryFilter((current) => (current === 'custody' || current === 'movement' ? current : 'lifecycle'));
    if (assetStep === 'history') setHistoryFilter((current) => (current === 'custody' || current === 'movement' ? 'all' : current));
  }, [assetStep]);

  useEffect(() => {
    if (asset && permissions.assets?.viewHistory) void loadReadModels({ target: 'history' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFilter]);

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
        newResponsibleUserId: movRespType === 'cadastrado' ? movRespUserId : undefined,
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

  async function handleCustodyTransfer() {
    if (!asset || !user) return;
    const performedBy = movWithdrawerType === 'cadastrado'
      ? { type: 'employee' as const, id: movWithdrawerUserId, nameSnapshot: activeUsers.find((candidate) => candidate.id === movWithdrawerUserId)?.username ?? '' }
      : { type: 'third_party' as const, nameSnapshot: movWithdrawerFree.trim() };
    if (!performedBy.nameSnapshot || (performedBy.type !== 'third_party' && !performedBy.id)) {
      toast({ title: 'Informe quem executou a entrega.', variant: 'destructive' });
      return;
    }
    setMovSaving(true);
    try {
      const holderName = movRespType === 'cadastrado'
        ? activeUsers.find((candidate) => candidate.id === movRespUserId)?.username ?? ''
        : movRespFree.trim();
      if (!holderName || (movRespType === 'cadastrado' && !movRespUserId)) throw new Error('Selecione quem receberá a posse.');
      const result = await assetApi<{ transferId: string; status: string; lifecycleVersion: number }>(`/api/assets/${asset.id}/custody-transfers`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: lifecycleVersion,
          toHolder: { holderType: movRespType === 'cadastrado' ? 'employee' : 'third_party', ...(movRespType === 'cadastrado' ? { holderId: movRespUserId } : {}), holderNameSnapshot: holderName },
          performedBy,
          notes: movNotes.trim() || undefined,
          generateTerm: movRespType === 'cadastrado' && generateTerm,
        }),
      });
      setLifecycleVersion(result.lifecycleVersion);
      if (result.status === 'term_generation_pending') {
        await assetApi(`/api/assets/${asset.id}/custody-transfers/${result.transferId}/term`, { method: 'POST', body: JSON.stringify({ action: 'send' }) });
        toast({ title: 'Posse transferida e termo enviado para assinatura.' });
      } else toast({ title: 'Transferência de posse registrada.' });
      setMovNotes(''); setMovWithdrawerUserId(''); setMovWithdrawerFree(''); setMovRespUserId(''); setMovRespFree('');
      setCustodyDialogOpen(false);
      await Promise.all([refreshAssets(), loadMovements(), loadReadModels({ target: 'history' }), loadReadModels({ target: 'custody' })]);
    } catch (error) {
      toast({ title: 'Não foi possível registrar', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setMovSaving(false);
    }
  }

  async function handleChangeLocation() {
    if (!asset || !user) return;
    let location: { type: 'unit' | 'external' | 'in_transit'; refId?: string; nameSnapshot: string; details?: string };
    if (locationKind === 'unit') {
      const kiosk = kiosks.find((candidate) => candidate.id === movDestKioskId);
      if (!kiosk) { toast({ title: 'Selecione a unidade.', variant: 'destructive' }); return; }
      location = { type: 'unit', refId: kiosk.id, nameSnapshot: kiosk.name };
    } else if (locationKind === 'external') {
      if (!movDestFree.trim()) { toast({ title: 'Descreva o local.', variant: 'destructive' }); return; }
      location = { type: 'external', nameSnapshot: movDestFree.trim() };
    } else {
      location = { type: 'in_transit', nameSnapshot: 'Em movimento', ...(asset.custody?.holderNameSnapshot ? { details: `Com ${asset.custody.holderNameSnapshot}` } : {}) };
    }
    setMovSaving(true);
    try {
      const result = await assetApi<{ lifecycleVersion: number }>(`/api/assets/${asset.id}/movements`, {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: lifecycleVersion,
          location,
          performedBy: { type: 'employee', id: user.id, nameSnapshot: user.username },
          notes: movNotes.trim() || undefined,
        }),
      });
      setLifecycleVersion(result.lifecycleVersion);
      toast({ title: 'Local atualizado.' });
      setMovNotes(''); setMovDestKioskId(''); setMovDestFree(''); setLocationPanelOpen(false);
      await Promise.all([refreshAssets(), loadMovements(), loadReadModels({ target: 'history' }), loadReadModels({ target: 'custody' })]);
    } catch (error) {
      toast({ title: 'Não foi possível atualizar o local', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally {
      setMovSaving(false);
    }
  }

  async function handleCreateAudit() {
    if (!asset || auditPhotos.length === 0 || !auditDescription.trim()) {
      toast({ title: 'Inclua uma foto e descreva o estado do patrimônio.', variant: 'destructive' });
      return;
    }
    setAuditSaving(true);
    try {
      const photos = await Promise.all(auditPhotos.map((file) => uploadAuditPhoto(file, asset.id)));
      await assetApi(`/api/assets/${asset.id}/audits`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(), auditedAt: new Date().toISOString(), condition: auditCondition,
          operationalStatus: auditOperational, description: auditDescription.trim(), photos,
          correctiveMaintenance: { required: auditCorrective, priority: 'high', description: auditCorrective ? auditDescription.trim() : undefined, components: [] },
        }),
      });
      toast({ title: auditCorrective ? 'Auditoria salva e corretiva aberta.' : 'Auditoria registrada.' });
      setAuditDescription(''); setAuditPhotos([]); setAuditCorrective(false);
      setAuditDialogOpen(false);
      await loadMovements();
      await Promise.all([loadReadModels({ target: 'audits' }), loadReadModels({ target: 'occurrences' }), loadReadModels({ target: 'history' })]);
    } catch (error) {
      toast({ title: 'Falha ao registrar auditoria', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally { setAuditSaving(false); }
  }

  async function handleSavePlan() {
    if (!asset || !user || !planNextDate || !planName.trim()) {
      toast({ title: 'Informe o plano e a primeira data prevista.', variant: 'destructive' }); return;
    }
    setPlanSaving(true);
    try {
      await assetApi(`/api/assets/${asset.id}/maintenance-plans`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `ui-${asset.id}-${planName.trim().toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}`,
          name: planName.trim(), active: true, cadence: { unit: 'months', interval: Number(planInterval) }, nextDueDate: planNextDate,
          leadDays: 7, assignee: { type: 'user', id: user.id, nameSnapshot: user.username },
          checklistSnapshot: planChecklist.split('\n').map((item) => item.trim()).filter(Boolean),
        }),
      });
      toast({ title: 'Plano preventivo salvo.' });
      setMaintenanceDialogOpen(false);
      await Promise.all([loadReadModels({ target: 'plans' }), loadReadModels({ target: 'occurrences' })]);
    } catch (error) {
      toast({ title: 'Falha ao salvar plano', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally { setPlanSaving(false); }
  }

  async function handleCreateCorrective() {
    if (!asset || !user || !maintenanceDescription.trim() || !maintenanceDueDate) {
      toast({ title: 'Descreva o problema e informe o prazo.', variant: 'destructive' }); return;
    }
    setMaintenanceSaving(true);
    try {
      await assetApi(`/api/assets/${asset.id}/maintenance-occurrences`, {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(), dueDate: maintenanceDueDate, priority: maintenancePriority,
          assignee: maintenanceAssignee.trim() ? { type: 'third_party', nameSnapshot: maintenanceAssignee.trim() } : { type: 'user', id: user.id, nameSnapshot: user.username },
          description: maintenanceDescription.trim(), checklistSnapshot: [], components: [],
        }),
      });
      toast({ title: 'Manutenção corretiva aberta.' });
      setMaintenanceDescription(''); setMaintenanceDueDate(''); setMaintenanceAssignee(''); setMaintenanceDialogOpen(false);
      await loadReadModels({ target: 'occurrences' });
    } catch (error) {
      toast({ title: 'Falha ao abrir manutenção', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' });
    } finally { setMaintenanceSaving(false); }
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
      const responsible = activeUsers.find((user) => user.id === values.responsibleUserId);
      const normalizedCode = normalizeAssetCodeInput(values.code ?? asset.code);
      await updateAsset(asset.id, {
        code: normalizedCode,
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
        responsibleUserId: responsible?.id,
        responsibleName: responsible?.username,
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

  function handleEditPlateScan(decodedText: string) {
    const code = normalizeAssetCodeInput(decodedText);
    form.setValue('code', code, { shouldDirty: true, shouldValidate: true });
    setPlateScannerOpen(false);
    toast({ title: 'Placa identificada', description: code });
  }

  const detailSteps: WizardStep[] = ASSET_STEPS.map((step) => ({
    ...step,
    hidden: step.id === 'history' && !permissions.assets?.viewHistory,
  }));
  function exportHistory(format: 'csv' | 'pdf') {
    if (!asset) return;
    const kind = historyKind ? `&kind=${historyKind}` : '';
    void downloadAssetFile(`/api/assets/${asset.id}/history?format=${format}${kind}`, `${asset.code}-historico.${format}`).catch((error) => toast({ title: 'Falha ao exportar histórico', description: error instanceof Error ? error.message : 'Erro inesperado.', variant: 'destructive' }));
  }

  return (
    <>
      {asset && (
        <Form {...form}>
          <WizardModal
            open
            onOpenChange={(next) => { if (!next) onOpenChange(false); }}
            mode="edit"
            stepper="top"
            topStepperVariant="connected"
            saveMode="final"
            sidebarWidth={360}
            height={820}
            steps={detailSteps}
            stepIndex={Math.max(detailSteps.findIndex((step) => step.id === assetStep), 0)}
            onStepChange={(index) => setAssetStep(detailSteps[index].id as AssetStep)}
            onSubmit={() => void form.handleSubmit(handleSave)()}
            submitLabel="Salvar alterações"
            submitting={saving}
            dirty={form.formState.isDirty}
            title={`${asset.code} · ${asset.name}`}
            description={`${asset.currentKioskName || asset.currentKioskId} · ${STATUS_LABEL[asset.status]}`}
            showTopSummary={false}
            showCloseButton={false}
            footerActions={
              <Button type="button" variant="ds-secondary" size="lg" loading={saving} loadingLabel="Salvando…" disabled={!permissions.assets?.edit || uploadingImage} onClick={() => void form.handleSubmit(handleSave)()}>
                Salvar alterações
              </Button>
            }
            sidebar={
              <div className="space-y-5">
                <div className="overflow-hidden rounded-ds-btn-lg">
                  <AssetThumb asset={asset} className="aspect-4/3 w-full" fit="contain" />
                </div>
                <div>
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-kicker">
                    {asset.subcategory || asset.category || 'Patrimônio'}
                  </p>
                  <h2 className="mt-2 wrap-break-word text-[24px] font-extrabold leading-tight tracking-[-0.03em]">{form.watch('name') || asset.name}</h2>
                  <p className="mt-1 text-[13px] text-ds-on-dark-sub">{[asset.brand, asset.model].filter(Boolean).join(' · ') || '—'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <AssetStatusChip status={form.watch('status')} />
                    <AssetPlateBadge asset={asset} />
                  </div>
                </div>
                <div className="rounded-ds-btn-lg bg-white/6 p-4 text-center">
                  <div className="mx-auto grid h-32 w-32 place-items-center overflow-hidden rounded-lg bg-white p-2">
                    {qrUrl ? <img src={qrUrl} alt={`QR ${asset.code}`} className="h-full w-full object-contain" /> : <QrCode className="h-20 w-20 text-zinc-400" />}
                  </div>
                  <p className="mt-2 font-mono text-[15px] font-bold">{asset.code}</p>
                  <Button type="button" variant="on-dark-secondary" size="xs" className="mt-3 w-full" onClick={handlePrintLabel} disabled={!permissions.assets?.printLabels}>
                    <Printer className="mr-2 h-4 w-4" />Imprimir etiqueta
                  </Button>
                </div>
                <dl className="space-y-3 text-[12.5px]">
                  <div>
                    <dt className="flex items-center gap-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted"><MapPin className="h-3 w-3" />Local atual</dt>
                    <dd className="mt-0.5 font-semibold">{asset.currentKioskName || asset.currentKioskId}</dd>
                  </div>
                  <div><dt className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Posse atual</dt><dd className="mt-0.5 font-semibold">{asset.custody?.holderNameSnapshot || asset.responsibleName || 'Empresa'}</dd></div>
                  <div><dt className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Origem</dt><dd className="mt-0.5 font-semibold">{asset.sourceType === 'purchase_receipt' ? 'Recebimento de compra' : 'Cadastro manual'}</dd></div>
                  {asset.supplierName ? <div><dt className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Fornecedor</dt><dd className="mt-0.5 font-semibold">{asset.supplierName}</dd></div> : null}
                  {asset.purchaseValue ? <div><dt className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted">Valor de aquisição</dt><dd className="mt-0.5 font-mono font-semibold">{formatCurrency(asset.purchaseValue)}</dd></div> : null}
                </dl>
              </div>
            }
          >
            <form
              id="asset-edit-form"
              onSubmit={form.handleSubmit(handleSave)}
              onKeyDown={(event) => {
                // Enter num campo de texto não pode salvar e fechar o modal no meio das etapas.
                if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
              }}
              className="space-y-4"
            >

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
                      <FormField control={form.control} name="code" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Placa patrimonial</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                className="font-mono uppercase"
                                placeholder="Ex: PAT-000123 ou 123"
                                {...field}
                                value={field.value ?? ''}
                                disabled={!permissions.assets?.edit}
                                onBlur={(event) => {
                                  const normalized = normalizeAssetCodeInput(event.target.value);
                                  field.onBlur();
                                  if (normalized && !normalized.startsWith('PEND-')) {
                                    form.setValue('code', normalized, { shouldDirty: true, shouldValidate: true });
                                  }
                                }}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={!permissions.assets?.edit}
                              onClick={() => setPlateScannerOpen(true)}
                            >
                              <QrCode className="mr-1.5 h-4 w-4" />
                              Escanear
                            </Button>
                          </div>
                          {asset.plateStatus === 'pendente' || String(asset.code ?? '').startsWith('PEND-') ? (
                            <p className="mt-1 text-xs text-amber-700">Placa pendente: escaneie ou digite a placa física para sanear este patrimônio.</p>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">Altere somente para corrigir ou vincular a placa física.</p>
                          )}
                          <FormMessage />
                        </FormItem>
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
                      <div><FormLabel>Proprietário</FormLabel><p className="mt-2 text-sm font-semibold">{asset.owner?.nameSnapshot || 'Empresa'}</p></div>
                      <div><FormLabel>Regime / posse</FormLabel><p className="mt-2 text-sm font-semibold">{OWNERSHIP_LABEL[asset.ownershipRegime ?? 'unknown']} · {asset.custody?.holderNameSnapshot || asset.responsibleName || 'Empresa'}</p></div>
                    </div>
                    <FormField control={form.control} name="description" render={({ field }) => (
                      <FormItem className="mt-3"><FormLabel>Descrição detalhada</FormLabel><FormControl><Textarea {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit} /></FormControl></FormItem>
                    )} />
                  </div>

                  <div className={cn('rounded-md border bg-card p-4', assetStep !== 'acquisition' && 'hidden')}>
                    <div className="mb-3 flex items-center gap-2">
                      <p className="text-sm font-semibold">Aquisição</p>
                      {asset?.sourceType === 'purchase_receipt' && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Vinculado à compra · somente leitura</span>
                      )}
                    </div>
                    {asset.sourceType === 'purchase_receipt' ? (
                      acquisitionStatus === 'forbidden' ? <p className="mb-4 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Os detalhes comerciais da aquisição exigem permissão de Compras.</p> : acquisitionStatus === 'error' ? <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Não foi possível carregar os detalhes da aquisição.</p> : acquisitionModel ? (
                        <div className="mb-4 grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
                          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Pedido</p><p className="mt-1 text-sm font-medium">{String(acquisitionModel.order?.number ?? acquisitionModel.order?.id ?? '—')}</p><p className="text-xs text-muted-foreground">{String(acquisitionModel.order?.status ?? '')}</p></div>
                          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Recebimento</p><p className="mt-1 text-sm font-medium">{String(acquisitionModel.receipt?.number ?? acquisitionModel.receipt?.id ?? '—')}</p><p className="text-xs text-muted-foreground">{String(acquisitionModel.receipt?.receivedAt ?? '')}</p></div>
                          <div><p className="text-xs font-semibold uppercase text-muted-foreground">Item recebido</p><p className="mt-1 text-sm font-medium">{String(acquisitionModel.item?.description ?? '—')}</p><p className="text-xs text-muted-foreground">Qtd. {String(acquisitionModel.item?.quantity ?? '—')} · {formatCurrency(Number(acquisitionModel.item?.unitPrice ?? 0))}</p></div>
                        </div>
                      ) : acquisitionStatus === 'loading' ? <Skeleton className="mb-4 h-24 w-full" /> : null
                    ) : null}
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
                          <FormLabel>Plano de contas</FormLabel>
                          <Select
                            value={field.value ?? ''}
                            onValueChange={field.onChange}
                            disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'}
                          >
                            <FormControl><SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none"><span className="text-muted-foreground">Sem conta vinculada</span></SelectItem>
                              {accountingAccounts.map((a: any) => (
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
                    <FormField control={form.control} name="warrantyEndsAt" render={({ field }) => (
                      <FormItem><FormLabel>Fim da garantia</FormLabel><FormControl><Input type="date" {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="serviceCompany" render={({ field }) => (
                      <FormItem><FormLabel>Assistência / garantia</FormLabel><FormControl><Input {...field} value={field.value ?? ''} disabled={!permissions.assets?.edit || asset?.sourceType === 'purchase_receipt'} /></FormControl></FormItem>
                    )} />
                  </div>

                  {assetStep === 'audit' ? (
                    <div className="space-y-4">
                      {readModelsError ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{readModelsError}</div> : null}
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border bg-card p-4"><p className={SUMMARY_LABEL}>Estado</p><p className="mt-1.5 text-base font-bold">{ASSET_CONDITION_LABEL[form.watch('conservationState') ?? ''] || '—'}</p><p className="mt-1 text-xs text-muted-foreground">{ASSET_OPERATIONAL_LABEL[form.watch('operationalCondition') ?? ''] || 'Sem condição operacional'}</p></div>
                        <div className="rounded-2xl border bg-card p-4"><p className={SUMMARY_LABEL}>Última auditoria</p><p className="mt-1.5 text-base font-bold">{auditsPage.items[0]?.auditedAt ? new Date(auditsPage.items[0].auditedAt as string).toLocaleDateString('pt-BR') : '—'}</p><p className="mt-1 text-xs text-muted-foreground">{auditsPage.items[0] ? `por ${auditsPage.items[0].auditor?.nameSnapshot || '—'}` : 'Nenhuma registrada'}</p></div>
                        <div className="rounded-2xl border bg-card p-4"><p className={SUMMARY_LABEL}>Próxima conferência</p><p className="mt-1.5 text-base font-bold">{form.watch('nextInspectionDate') ? new Date(`${form.watch('nextInspectionDate')}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</p><p className="mt-1 text-xs text-muted-foreground">Definida na auditoria</p></div>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <section className="rounded-2xl border bg-card p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className={SUMMARY_LABEL}>Auditorias · {auditsPage.items.length}</p>
                            <Button type="button" size="sm" onClick={() => setAuditDialogOpen(true)} disabled={!permissions.assets?.edit}><Plus className="mr-1.5 h-4 w-4" />Nova auditoria</Button>
                          </div>
                          {readModelsLoading && auditsPage.items.length === 0 ? <Skeleton className="mt-3 h-20 w-full" /> : auditsPage.items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma auditoria registrada.</p> : (
                            <div className="mt-2 divide-y">{auditsPage.items.slice(0, 3).map((audit) => (
                              <div key={audit.id} className="py-2.5"><div className="flex justify-between gap-3"><strong className="text-sm">{ASSET_CONDITION_LABEL[audit.condition ?? ''] || audit.condition || 'Condição não informada'} · {ASSET_OPERATIONAL_LABEL[audit.operationalStatus ?? ''] || audit.operationalStatus || '—'}</strong><span className="shrink-0 text-xs text-muted-foreground">{audit.auditedAt ? new Date(audit.auditedAt).toLocaleDateString('pt-BR') : '—'}</span></div><p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{audit.description} · {audit.auditor?.nameSnapshot || '—'}</p></div>
                            ))}</div>
                          )}
                          {auditsPage.nextCursor ? <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void loadReadModels({ target: 'audits', append: true })}>Carregar mais auditorias</Button> : null}
                        </section>
                        <section className="rounded-2xl border bg-card p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className={SUMMARY_LABEL}>Manutenção · {occurrencesPage.items.length + plansPage.items.length}</p>
                            <Button type="button" size="sm" onClick={() => setMaintenanceDialogOpen(true)} disabled={!permissions.assets?.edit}><Plus className="mr-1.5 h-4 w-4" />Nova manutenção</Button>
                          </div>
                          {readModelsLoading && occurrencesPage.items.length === 0 && plansPage.items.length === 0 ? <Skeleton className="mt-3 h-20 w-full" /> : occurrencesPage.items.length === 0 && plansPage.items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma manutenção agendada ou aberta.</p> : (
                            <div className="mt-2 divide-y">
                              {occurrencesPage.items.map((occurrence) => (
                                <div key={occurrence.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><strong className="text-sm">{occurrence.type === 'preventive' ? 'Preventiva' : occurrence.type === 'corrective' ? 'Corretiva' : 'Manutenção'}</strong><p className="truncate text-xs text-muted-foreground">{occurrence.description || 'Sem descrição'} · vence {occurrence.dueDate || '—'}</p></div>
                                  {occurrence.orderStatus === 'generated' ? <Button type="button" variant="outline" size="sm" onClick={() => void downloadAssetFile(`/api/assets/${asset.id}/maintenance-occurrences/${occurrence.id}/order`, `ordem-${occurrence.orderProtocol || occurrence.id}.pdf`).catch((error) => toast({ title: 'Falha no download', description: error.message, variant: 'destructive' }))}>Ordem MNT</Button> : null}</div>
                              ))}
                              {plansPage.items.map((plan) => (
                                <div key={plan.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><strong className="text-sm">{plan.name || 'Plano preventivo'}</strong><p className="truncate text-xs text-muted-foreground">Preventiva · próxima {plan.nextDueDate || '—'}</p></div><StatusPill variant={plan.active === false ? 'neutral' : 'ok'}>{plan.active === false ? 'Inativo' : 'Ativo'}</StatusPill></div>
                              ))}
                            </div>
                          )}
                        </section>
                      </div>
                    </div>
                  ) : null}

                  </>
                  ) : null}


                  {assetStep === 'location' ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border bg-card p-4">
                          <p className={SUMMARY_LABEL}>Local atual</p>
                          <p className="mt-1.5 text-base font-bold">{asset.currentKioskName || asset.currentKioskId || '—'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{asset.sourceType === 'purchase_receipt' ? 'Entrada por recebimento de compra' : 'Local registrado no cadastro'}</p>
                          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setLocationPanelOpen((open) => !open)} disabled={!permissions.assets?.transfer}><MapPin className="mr-1.5 h-4 w-4" />Alterar local</Button>
                        </div>
                        <div className="rounded-2xl border bg-card p-4">
                          <p className={SUMMARY_LABEL}>Posse atual</p>
                          <p className="mt-1.5 text-base font-bold">{asset.custody?.holderNameSnapshot || asset.responsibleName || 'Empresa'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Proprietário: {asset.owner?.nameSnapshot || 'Empresa'} · {OWNERSHIP_LABEL[asset.ownershipRegime ?? 'unknown']}</p>
                          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setCustodyDialogOpen(true)} disabled={!permissions.assets?.transfer}>Transferir posse</Button>
                        </div>
                      </div>

                      {locationPanelOpen ? (
                        <div className="space-y-3 rounded-2xl border border-primary/40 bg-card p-4">
                          <p className={SUMMARY_LABEL}>Alterar local</p>
                          <Segmented value={locationKind} onChange={setLocationKind} options={[{ value: 'unit', label: 'Unidade' }, { value: 'external', label: 'Texto livre' }, { value: 'in_transit', label: 'Em movimento' }]} aria-label="Tipo de local" />
                          {locationKind === 'unit' ? (
                            <Select value={movDestKioskId || undefined} onValueChange={setMovDestKioskId}>
                              <SelectTrigger><SelectValue placeholder="Selecione a unidade" /></SelectTrigger>
                              <SelectContent>{kiosks.map((kiosk) => <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : locationKind === 'external' ? (
                            <Input value={movDestFree} onChange={(event) => setMovDestFree(event.target.value)} placeholder="Ex.: Assistência técnica Samsung" />
                          ) : (
                            <p className="text-xs text-muted-foreground">Sem local fixo: o bem circula com {asset.custody?.holderNameSnapshot || 'o responsável'} entre as unidades.</p>
                          )}
                          <Textarea placeholder="Observação (opcional)" value={movNotes} onChange={(event) => setMovNotes(event.target.value)} rows={2} />
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => setLocationPanelOpen(false)}>Cancelar</Button>
                            <Button type="button" size="sm" onClick={() => void handleChangeLocation()} disabled={movSaving || !permissions.assets?.transfer}>{movSaving ? 'Salvando...' : 'Salvar local'}</Button>
                          </div>
                        </div>
                      ) : null}

                      {permissions.assets?.viewHistory ? (
                        <section className="rounded-md border bg-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div><h4 className="font-semibold">Termos de posse e assinatura</h4><p className="mt-1 text-xs text-muted-foreground">Trilha do registro, geração, envio ao Autentique, assinatura e arquivamento no perfil do colaborador.</p></div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void loadReadModels({ target: 'custody' })} disabled={readModelsLoading}><History className="mr-2 h-4 w-4" />Atualizar</Button>
                          </div>
                          {readModelsLoading && custodyTransfersPage.items.length === 0 ? <Skeleton className="mt-3 h-20 w-full" /> : custodyTransfersPage.items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma transferência de posse registrada.</p> : (
                            <div className="mt-3 space-y-2">
                              {custodyTransfersPage.items.map((transfer) => {
                                const statusLabel: Record<string, string> = { recorded: 'Registrado sem termo', term_generation_pending: 'Geração pendente', term_generation_in_progress: 'Gerando termo', term_generation_failed: 'Falha na geração', awaiting_signature: 'Aguardando assinatura', signed: 'Assinado e arquivado', refused: 'Assinatura recusada', expired: 'Assinatura expirada', archive_failed: 'Assinado; falha ao arquivar' };
                                return (
                                  <div key={transfer.id} className="rounded-md border p-3">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                      <div><strong className="text-sm">{transfer.fromHolder?.holderNameSnapshot || 'Empresa'} → {transfer.toHolder?.holderNameSnapshot || 'Não informado'}</strong><p className="mt-1 text-xs text-muted-foreground">Registrado por {transfer.actor?.nameSnapshot || '—'} em {transfer.createdAt ? new Date(transfer.createdAt).toLocaleString('pt-BR') : '—'}</p></div>
                                      <StatusPill variant={transfer.status === 'signed' ? 'ok' : transfer.status?.includes('failed') ? 'danger' : transfer.generateTerm ? 'warn' : 'neutral'}>{statusLabel[transfer.status || 'recorded'] || transfer.status || 'Registrado'}</StatusPill>
                                    </div>
                                    {transfer.generateTerm ? <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3"><span>PDF: {transfer.generatedDocumentId ? 'gerado' : 'pendente'}</span><span>Assinatura: {transfer.signedAt ? new Date(transfer.signedAt).toLocaleString('pt-BR') : transfer.signatureUpdatedAt ? 'atualizada' : 'pendente'}</span><span>Perfil: {transfer.employeeDocumentId ? 'arquivado' : 'pendente'}</span></div> : null}
                                    {transfer.generatedDocumentId ? <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void downloadAssetFile(`/api/assets/${asset.id}/custody-transfers/${transfer.id}/term/file`, `termo-posse-${asset.code}.pdf`).catch((error) => toast({ title: 'Falha no download', description: error.message, variant: 'destructive' }))}><FileText className="mr-2 h-4 w-4" />Baixar termo PDF</Button> : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {custodyTransfersPage.nextCursor ? <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => void loadReadModels({ target: 'custody', append: true })}>Carregar mais termos</Button> : null}
                        </section>
                      ) : null}

                      <section className="rounded-2xl border bg-card p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <p className={SUMMARY_LABEL}>Histórico · local e posse</p>
                          <Segmented value={historyFilter === 'custody' || historyFilter === 'movement' ? historyFilter : 'lifecycle'} onChange={setHistoryFilter} options={[{ value: 'lifecycle', label: 'Tudo' }, { value: 'movement', label: 'Local' }, { value: 'custody', label: 'Posse' }]} aria-label="Filtrar histórico de local e posse" />
                        </div>
                        {readModelsLoading && historyPage.items.length === 0 ? <Skeleton className="h-20 w-full" /> : historyPage.items.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Nenhum evento de local ou posse.</p> : (
                          <div className="divide-y">{historyPage.items.map((item) => (
                            <div key={`${item.source}-${item.id}`} className="flex items-start justify-between gap-3 py-2.5">
                              <div className="min-w-0"><p className="text-sm font-semibold">{item.description || historyEventLabel(item.type)}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.at ? new Date(item.at).toLocaleString('pt-BR') : '—'}</p></div>
                              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">{HISTORY_SOURCE_LABEL[item.source] || historyEventLabel(item.source)}</span>
                            </div>
                          ))}</div>
                        )}
                        {historyPage.nextCursor ? <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void loadReadModels({ target: 'history', append: true })}>Carregar mais eventos</Button> : null}
                      </section>
                    </div>
                  ) : null}

                  {assetStep === 'history' && permissions.assets?.viewHistory ? (
                    <>
                  {permissions.assets?.viewHistory ? (
                    <div>
                      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div><p className="text-sm font-semibold">Linha cronológica consolidada</p><p className="mt-1 text-xs text-muted-foreground">Alterações, posse, localização, manutenção e documentos do patrimônio.</p></div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => exportHistory('csv')} disabled={historyPage.items.length === 0}>Exportar CSV</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => exportHistory('pdf')} disabled={historyPage.items.length === 0}>Exportar PDF</Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => void loadReadModels({ target: 'history' })} disabled={readModelsLoading}><History className="mr-2 h-4 w-4" />Atualizar</Button>
                        </div>
                      </div>
                      <Segmented value={historyFilter} onChange={setHistoryFilter} options={[{ value: 'all', label: 'Todos' }, { value: 'lifecycle', label: 'Posse e local' }, { value: 'maintenance', label: 'Manutenção' }]} aria-label="Filtrar histórico" className="mb-4" />
                      {readModelsLoading && historyPage.items.length === 0 ? (
                        <Skeleton className="h-28 w-full" />
                      ) : historyPage.items.length === 0 ? (
                        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum evento encontrado neste filtro.</p>
                      ) : (
                        <>
                        <ScrollArea className="max-h-[520px]">
                          <ol className="relative ml-1.5 space-y-3.5 border-l pl-5">
                            {historyPage.items.map((item) => (
                              <li key={`${item.source}-${item.id}`} className="relative">
                                <span className="absolute left-[-27px] grid h-5 w-5 place-items-center rounded-full bg-zinc-900 text-white ring-2 ring-background dark:bg-zinc-100 dark:text-zinc-900"><Check className="h-2.5 w-2.5" /></span>
                                <div className="rounded-xl border bg-card p-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10.5px] font-bold uppercase tracking-wider text-foreground/70">{historyEventLabel(item.type)}</span>
                                    <span className="text-[11px] text-muted-foreground">{item.at ? new Date(item.at).toLocaleString('pt-BR') : '—'}</span>
                                  </div>
                                  {item.description ? <div className="mt-1 text-[12.5px] text-foreground/80">{item.description}</div> : null}
                                  <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{HISTORY_SOURCE_LABEL[item.source] || historyEventLabel(item.source)}</div>
                                </div>
                              </li>
                            ))}
                          </ol>
                        </ScrollArea>
                        {historyPage.nextCursor ? <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => void loadReadModels({ target: 'history', append: true })}>Carregar mais eventos</Button> : null}
                        </>
                      )}
                    </div>
                  ) : null}
                    </>
                  ) : null}
            </form>
          </WizardModal>
          <AssetSheetDialog
            open={custodyDialogOpen}
            onOpenChange={setCustodyDialogOpen}
            title="Transferir posse"
            description={`O registro é feito por ${user?.username || 'usuário autenticado'}; informe quem executou fisicamente a entrega.`}
            footer={<>
              <Button type="button" variant="outline" onClick={() => setCustodyDialogOpen(false)}>Cancelar</Button>
              <Button type="button" onClick={() => void handleCustodyTransfer()} disabled={movSaving || !permissions.assets?.transfer}>{movSaving ? 'Registrando...' : generateTerm && movRespType === 'cadastrado' ? 'Iniciar trilha' : 'Transferir posse'}</Button>
            </>}
          >
            <div className="rounded-xl border bg-muted/40 p-3"><p className={SUMMARY_LABEL}>Responsável atual</p><p className="mt-1 text-sm font-semibold">{asset.custody?.holderNameSnapshot || asset.responsibleName || 'Empresa'}</p></div>
            <MovToggleField label="Quem está retirando" type={movWithdrawerType} onTypeChange={(t) => { setMovWithdrawerType(t); setMovWithdrawerUserId(''); setMovWithdrawerFree(''); }} freeValue={movWithdrawerFree} onFreeChange={setMovWithdrawerFree} freePlaceholder="Nome de quem está retirando" registeredId={movWithdrawerUserId} onRegisteredChange={setMovWithdrawerUserId} options={activeUsers.map((u) => ({ id: u.id, label: u.username }))} searchPlaceholder="Buscar colaborador..." emptyMessage="Nenhum colaborador encontrado." selectPlaceholder="Selecione um colaborador" />
            <MovToggleField label="Quem recebe a posse" type={movRespType} onTypeChange={(t) => { setMovRespType(t); setMovRespUserId(''); setMovRespFree(''); setGenerateTerm(t === 'cadastrado'); }} freeValue={movRespFree} onFreeChange={setMovRespFree} freePlaceholder="Nome do terceiro" registeredId={movRespUserId} onRegisteredChange={setMovRespUserId} options={activeUsers.map((u) => ({ id: u.id, label: u.username }))} searchPlaceholder="Buscar colaborador..." emptyMessage="Nenhum colaborador encontrado." selectPlaceholder="Selecione o colaborador" />
            <Textarea placeholder="Observações (opcional)" value={movNotes} onChange={(e) => setMovNotes(e.target.value)} rows={2} />
            <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border px-3 py-2.5 text-[12px] font-bold">
              {['Posse', 'Termo', 'Autentique', 'Assinatura'].map((label, index) => (
                <span key={label} className="flex shrink-0 items-center gap-1.5">
                  <span className={cn('grid h-6 w-6 place-items-center rounded-full text-[11px] text-white', index === 0 || (generateTerm && movRespType === 'cadastrado') ? 'bg-primary' : 'bg-muted-foreground/40')}>{index + 1}</span>{label}
                  {index < 3 ? <span className="h-px w-4 bg-border" /> : null}
                </span>
              ))}
            </div>
            <label className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={generateTerm} disabled={movRespType !== 'cadastrado'} onChange={(event) => setGenerateTerm(event.target.checked)} />
              <span><strong>Gerar termo e iniciar a trilha</strong><span className="mt-0.5 block text-xs text-muted-foreground">Envia o documento timbrado ao Autentique e acompanha a assinatura. Disponível para colaborador cadastrado.</span></span>
            </label>
          </AssetSheetDialog>
          <AssetSheetDialog
            open={auditDialogOpen}
            onOpenChange={setAuditDialogOpen}
            title="Nova auditoria"
            description={`O auditor é identificado pelo usuário autenticado (${user?.username || '—'}).`}
            footer={<>
              <Button type="button" variant="outline" onClick={() => setAuditDialogOpen(false)}>Cancelar</Button>
              <Button type="button" onClick={() => void handleCreateAudit()} loading={auditSaving} disabled={!permissions.assets?.edit}>Registrar auditoria</Button>
            </>}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div><FieldLabel required>Condição</FieldLabel><Select value={auditCondition} onValueChange={(value) => setAuditCondition(value as typeof auditCondition)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ASSET_CONDITION_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div><FieldLabel required>Operação</FieldLabel><Select value={auditOperational} onValueChange={(value) => setAuditOperational(value as typeof auditOperational)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ASSET_OPERATIONAL_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><FieldLabel required>Descrição do estado</FieldLabel><Textarea value={auditDescription} onChange={(event) => setAuditDescription(event.target.value)} rows={3} placeholder="Descreva avarias, desgaste e funcionamento." /></div>
            <AssetPhotoPicker files={auditPhotos} onChange={setAuditPhotos} label="Fotos e anexos da auditoria" />
            <label className="flex items-start gap-3 rounded-xl border bg-muted/30 p-3 text-sm"><input type="checkbox" className="mt-1" checked={auditCorrective} onChange={(event) => setAuditCorrective(event.target.checked)} /><span><strong>Abrir manutenção corretiva</strong><span className="mt-0.5 block text-xs text-muted-foreground">Cria a ocorrência e a ordem MNT já vinculadas a esta auditoria.</span></span></label>
          </AssetSheetDialog>
          <AssetSheetDialog
            open={maintenanceDialogOpen}
            onOpenChange={setMaintenanceDialogOpen}
            title="Nova manutenção"
            description="Gera ocorrência, tarefa e ordem MNT no prazo configurado."
            footer={<>
              <Button type="button" variant="outline" onClick={() => setMaintenanceDialogOpen(false)}>Cancelar</Button>
              {maintenanceMode === 'corrective'
                ? <Button type="button" onClick={() => void handleCreateCorrective()} loading={maintenanceSaving} disabled={!permissions.assets?.edit}>Abrir manutenção</Button>
                : <Button type="button" onClick={() => void handleSavePlan()} loading={planSaving} disabled={!permissions.assets?.edit}>Salvar plano preventivo</Button>}
            </>}
          >
            <Segmented value={maintenanceMode} onChange={setMaintenanceMode} options={[{ value: 'corrective', label: 'Corretiva' }, { value: 'preventive', label: 'Plano preventivo' }]} aria-label="Tipo de manutenção" />
            {maintenanceMode === 'corrective' ? (
              <>
                <div><FieldLabel required>Problema / descrição</FieldLabel><Textarea value={maintenanceDescription} onChange={(event) => setMaintenanceDescription(event.target.value)} rows={3} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><FieldLabel>Prioridade</FieldLabel><Select value={maintenancePriority} onValueChange={(value) => setMaintenancePriority(value as typeof maintenancePriority)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baixa</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="urgent">Urgente</SelectItem></SelectContent></Select></div>
                  <div><FieldLabel required>Prazo</FieldLabel><Input type="date" value={maintenanceDueDate} onChange={(event) => setMaintenanceDueDate(event.target.value)} /></div>
                </div>
                <div><FieldLabel>Assistência / responsável</FieldLabel><Input value={maintenanceAssignee} onChange={(event) => setMaintenanceAssignee(event.target.value)} placeholder="Em branco = você" /></div>
              </>
            ) : (
              <>
                <div><FieldLabel required>Plano</FieldLabel><Input value={planName} onChange={(event) => setPlanName(event.target.value)} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><FieldLabel required>Periodicidade (meses)</FieldLabel><Input type="number" min={1} max={120} value={planInterval} onChange={(event) => setPlanInterval(event.target.value)} /></div>
                  <div><FieldLabel required>Próxima execução</FieldLabel><Input type="date" value={planNextDate} onChange={(event) => setPlanNextDate(event.target.value)} /></div>
                </div>
                <div><FieldLabel>Checklist (um item por linha)</FieldLabel><Textarea value={planChecklist} onChange={(event) => setPlanChecklist(event.target.value)} rows={3} /></div>
              </>
            )}
          </AssetSheetDialog>
        </Form>
      )}
      {asset && (
        <BarcodeScannerModal
          open={plateScannerOpen}
          onOpenChange={setPlateScannerOpen}
          onScanSuccess={handleEditPlateScan}
        />
      )}
    </>
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

function isAssetPlatePending(asset: Asset) {
  return asset.plateStatus === 'pendente' || String(asset.code ?? '').toUpperCase().startsWith('PEND-');
}

function AssetPlateBadge({ asset }: { asset: Asset }) {
  if (isAssetPlatePending(asset)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
        <QrCode className="h-3 w-3" />
        Placa pendente
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
      <QrCode className="h-3 w-3" />
      Placa vinculada
    </span>
  );
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

const ASSET_STATUS_PILL: Record<AssetStatus, StatusPillVariant> = {
  ativo: 'ok',
  em_manutencao: 'warn',
  fora_de_uso: 'neutral',
  extraviado: 'danger',
  vendido: 'info',
  descartado: 'neutral',
  baixado: 'danger',
};

function AssetStatusChip({ status, variant = 'chip' }: { status: AssetStatus; variant?: 'chip' | 'solid' | 'dot' }) {
  const meta = ASSET_STATUS_META[status];
  if (variant === 'dot') {
    return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground"><span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />{meta.label}</span>;
  }
  if (variant === 'solid') {
    return <span className={cn('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', meta.solid)}>{meta.short}</span>;
  }
  return <StatusPill variant={ASSET_STATUS_PILL[status]}>{meta.label}</StatusPill>;
}

function AssetCardHero({ asset, onOpen }: { asset: Asset; onOpen: (asset: Asset) => void }) {
  const cat = categoryColor(asset.subcategory || asset.category);
  return (
    <button
      type="button"
      onClick={() => onOpen(asset)}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-card text-left ring-1 ring-border transition-all hover:-translate-y-0.5 hover:shadow-lg hover:ring-zinc-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="relative aspect-4/3 overflow-hidden" style={{ background: cat.soft }}>
        <AssetThumb asset={asset} className="h-full w-full" fit="contain" />
        <div className="absolute left-2.5 top-2.5"><AssetStatusChip status={asset.status} variant="solid" /></div>
        <div className="absolute right-2.5 top-2.5">
          <span className="rounded-md bg-white/90 px-1.5 py-1 font-mono text-[10px] font-bold text-zinc-900 ring-1 ring-zinc-200 backdrop-blur-sm">{assetCodeTail(asset.code)}</span>
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5 opacity-0 transition group-hover:opacity-100">
          <span className="block rounded-md bg-zinc-900/85 py-1.5 text-center text-[11px] font-semibold text-white backdrop-blur-sm">Ver detalhes</span>
        </div>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: cat.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />{asset.subcategory || asset.category || 'Patrimônio'}
          <AssetPlateBadge asset={asset} />
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

function AssetListRow({ asset, onOpen, selected }: { asset: Asset; onOpen: (asset: Asset) => void; selected?: boolean }) {
  const cat = categoryColor(asset.subcategory || asset.category);
  return (
    <LiftRow
      selected={selected}
      onClick={() => onOpen(asset)}
      aria-label={`Abrir patrimônio ${asset.code} ${asset.name}`}
      className="group grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[56px_minmax(0,2.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_132px_24px_20px]"
    >
      <AssetThumb asset={asset} className="h-14 w-14 rounded-ds-md" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] font-extrabold text-ds-ink-muted">{asset.code}</span>
          <AssetPlateBadge asset={asset} />
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.12em]" style={{ color: cat.color }}>{asset.subcategory || asset.category || 'Patrimônio'}</span>
        </div>
        <div className="truncate text-[13.5px] font-bold text-ds-ink">{asset.name}</div>
        <div className="truncate text-xs text-ds-ink-faint">{[asset.brand, asset.model].filter(Boolean).join(' · ')}{asset.serialNumber ? <> · <span className="font-mono">{asset.serialNumber}</span></> : null}</div>
      </div>
      <div className="md:hidden"><AssetStatusChip status={asset.status} /></div>
      <div className="col-span-3 min-w-0 md:col-span-1">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Unidade</div>
        <div className="flex items-center gap-1 truncate text-[12.5px] font-semibold text-ds-ink"><MapPin aria-hidden="true" className="h-3 w-3 shrink-0 text-ds-ink-faint" />{asset.currentKioskName || asset.currentKioskId}</div>
      </div>
      <div className="col-span-3 md:col-span-1">
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Compra</div>
        <div className="text-[12.5px] font-semibold text-ds-ink">{fmtDateShort(asset.purchaseDate)}</div>
        <div className="text-xs text-ds-ink-faint">{ageLabel(asset.purchaseDate)}</div>
      </div>
      <div className="hidden md:block"><AssetStatusChip status={asset.status} /></div>
      <QrCode aria-hidden="true" className="hidden h-5 w-5 text-ds-ink-faint md:block" />
      <ChevronRight aria-hidden="true" className="hidden h-4 w-4 text-ds-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ds-accent-ink motion-reduce:transition-none md:block" />
    </LiftRow>
  );
}

const ASSET_TABLE_COLUMNS = 'grid-cols-[40px_110px_minmax(160px,1.4fr)_minmax(110px,.9fr)_minmax(130px,1fr)_100px_minmax(100px,.9fr)_130px_100px_92px_20px]';

function AssetTableView({ assets, onOpen, selectedId }: { assets: Asset[]; onOpen: (asset: Asset) => void; selectedId?: string }) {
  const kicker = 'text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint';
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1180px]">
        <div className={cn('grid items-center gap-x-3 border-b border-ds-divider px-[18px] py-3', ASSET_TABLE_COLUMNS)}>
          <span /><span className={kicker}>Código</span><span className={kicker}>Patrimônio</span><span className={kicker}>Categoria</span>
          <span className={kicker}>Marca / Modelo</span><span className={kicker}>Nº série</span><span className={kicker}>Unidade</span>
          <span className={kicker}>Status</span><span className={cn(kicker, 'text-right')}>Valor</span><span className={kicker}>Compra</span><span />
        </div>
        {assets.map((a) => {
          const cat = categoryColor(a.subcategory || a.category);
          return (
            <LiftRow
              key={a.id}
              table
              selected={selectedId === a.id}
              onClick={() => onOpen(a)}
              aria-label={`Abrir patrimônio ${a.code} ${a.name}`}
              className={cn('group grid items-center gap-x-3 text-[12.5px]', ASSET_TABLE_COLUMNS)}
            >
              <AssetThumb asset={a} className="h-10 w-10 rounded-ds-sm" />
              <div className="min-w-0">
                <div className="font-mono text-[11.5px] font-extrabold text-ds-ink-muted">{a.code}</div>
                <div className="mt-1"><AssetPlateBadge asset={a} /></div>
              </div>
              <div className="min-w-0 truncate font-bold text-ds-ink">{a.name}</div>
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[11.5px] font-bold" style={{ color: cat.color }}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cat.color }} />{a.subcategory || a.category || 'Patrimônio'}</span>
              <div className="min-w-0 truncate text-ds-ink">{a.brand}{a.model ? <> · <span className="text-ds-ink-faint">{a.model}</span></> : null}</div>
              <div className="truncate font-mono text-[11px] text-ds-ink-faint">{a.serialNumber || '—'}</div>
              <div className="min-w-0 truncate text-ds-ink">{a.currentKioskName || a.currentKioskId}</div>
              <div><AssetStatusChip status={a.status} /></div>
              <div className="text-right font-mono font-bold text-ds-ink">{formatCurrency(a.purchaseValue)}</div>
              <div className="text-ds-ink-faint">{fmtDateShort(a.purchaseDate)}</div>
              <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ds-accent-ink motion-reduce:transition-none" />
            </LiftRow>
          );
        })}
      </div>
    </div>
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
              <label htmlFor="asset-code-reader" className="block text-xs font-bold text-ds-ink-2">Código do patrimônio</label>
              <input
                id="asset-code-reader"
                autoFocus
                value={rawCode}
                onChange={(event) => setRawCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openAsset();
                }}
                placeholder="Ex: PAT-000123 ou 123"
                className={cn(fieldInputClass, 'font-mono uppercase')}
              />
              <p className="text-xs text-ds-ink-muted">
                Normalizado: <span className="font-mono font-semibold text-foreground">{normalizedCode || '—'}</span>
              </p>
            </div>

            <div className="rounded-ds-btn border border-ds-border bg-ds-muted p-3 text-xs text-ds-ink-muted">
              Esta versão de teste não faz OCR de texto impresso pela câmera. A câmera lê QR/barcode; para texto PAT impresso, use o campo acima ou um leitor físico que envie o código como teclado.
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ds-secondary" size="md" onClick={() => setScannerOpen(true)}>
                <QrCode className="mr-2 h-4 w-4" />
                Escanear QR/barcode
              </Button>
              <Button type="button" variant="primary-modal" size="md" onClick={() => openAsset()} disabled={!normalizedCode}>
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
  const [plateFilter, setPlateFilter] = useState<'todos' | 'pendentes'>('todos');
  const [categoryFilter, setCategoryFilter] = useState('todas');
  const [unitFilter, setUnitFilter] = useState('todas');
  const [brandFilter, setBrandFilter] = useState('todas');
  const [periodFilter, setPeriodFilter] = useState<'todos' | 'this_year' | 'last_year' | 'older'>('todos');
  const [view, setView] = useState<'grid' | 'list' | 'table'>('grid');

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
  }, [searchParams]);

  const selectedAsset = selected ? assets.find((candidate) => candidate.id === selected.id) ?? selected : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const thisYear = new Date().getFullYear();
    return assets.filter((asset) => {
      const matchesSearch = !q || [asset.code, asset.name, asset.category, asset.subcategory, asset.brand, asset.model, asset.serialNumber, asset.currentKioskName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
      const matchesStatus = statusFilter === 'todos' || asset.status === statusFilter;
      const matchesPlate = plateFilter === 'todos' || isAssetPlatePending(asset);
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
      return matchesSearch && matchesStatus && matchesPlate && matchesCategory && matchesUnit && matchesBrand && matchesPeriod;
    });
  }, [assets, search, statusFilter, plateFilter, categoryFilter, unitFilter, brandFilter, periodFilter]);

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
      pendingPlates: assets.filter(isAssetPlatePending).length,
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

  const darkSelect = 'h-10 rounded-ds-btn border-white/10 bg-white/[0.07] px-3 text-[13px] font-semibold text-white shadow-none hover:bg-white/10 hover:text-white focus:ring-ds-accent-kicker';
  const allStatusActive = statusFilter === 'todos' && plateFilter === 'todos';

  return (
    <div className="flex flex-col gap-5">
      <PageHero
        kicker="Financeiro"
        title="Patrimônio"
        subtitle="Máquinas, equipamentos e mobiliário rastreados por código interno e QR Code."
        actions={(
          <>
            <Button variant="on-dark-secondary" size="md" onClick={() => setShowCodeReader(true)}>
              <QrCode aria-hidden="true" className="mr-2 h-4 w-4" />
              Ler código
            </Button>
            <Button variant="on-dark-secondary" size="md" onClick={() => setShowCategories(true)} disabled={!permissions.assets?.create && !permissions.assets?.edit}>
              <Tags aria-hidden="true" className="mr-2 h-4 w-4" />Categorias
            </Button>
            <Button variant="primary-page" size="md" onClick={() => setShowNew(true)} disabled={!permissions.assets?.create}>
              <Plus aria-hidden="true" className="mr-2 h-4 w-4" />Novo patrimônio
            </Button>
          </>
        )}
        chips={(
          <>
            <HeroChip value={summary.total} label="Total" active={allStatusActive} onClick={() => { setStatusFilter('todos'); setPlateFilter('todos'); }} />
            <HeroChip value={summary.active} label="Ativos" active={statusFilter === 'ativo'} onClick={() => setStatusFilter('ativo')} />
            <HeroChip value={summary.maintenance} label="Em manutenção" tone="warning" active={statusFilter === 'em_manutencao'} onClick={() => setStatusFilter('em_manutencao')} />
            <HeroChip value={summary.foraDeUso} label="Fora de uso" active={statusFilter === 'fora_de_uso'} onClick={() => setStatusFilter('fora_de_uso')} />
            <HeroChip value={summary.retired} label="Baixados" tone="danger" active={statusFilter === 'baixado'} onClick={() => setStatusFilter('baixado')} />
            <HeroChip value={summary.pendingPlates} label="Placas pendentes" tone="warning" active={plateFilter === 'pendentes'} onClick={() => setPlateFilter(plateFilter === 'pendentes' ? 'todos' : 'pendentes')} />
            <HeroChip value={formatCurrency(summary.totalValue)} label="Valor patrimonial" tone="info" />
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ControlSearch value={search} onChange={setSearch} placeholder="Buscar por código, série, nome…" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger aria-label="Categoria" className={cn(darkSelect, 'w-[170px]')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger aria-label="Unidade" className={cn(darkSelect, 'w-[160px]')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas unidades</SelectItem>
              {units.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger aria-label="Marca" className={cn(darkSelect, 'w-[150px]')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas marcas</SelectItem>
              {brands.map((brand) => <SelectItem key={brand} value={brand}>{brand}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={periodFilter} onValueChange={(value) => setPeriodFilter(value as typeof periodFilter)}>
            <SelectTrigger aria-label="Período de compra" className={cn(darkSelect, 'w-[170px]')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Qualquer período</SelectItem>
              <SelectItem value="this_year">Comprado este ano</SelectItem>
              <SelectItem value="last_year">Comprado ano passado</SelectItem>
              <SelectItem value="older">Anteriores</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageHero>

      {summary.pendingPlates > 0 ? (
        <div className="flex flex-col gap-2 rounded-ds-btn border border-ds-border bg-ds-warn-bg px-4 py-3 text-ds-warn sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Existem {summary.pendingPlates} patrimônio(s) com placa pendente.</p>
              <p className="text-xs">Eles podem ter sido criados no recebimento de compra e precisam ser saneados com a placa física.</p>
            </div>
          </div>
          <Button type="button" variant="ds-secondary" size="xs" onClick={() => setPlateFilter('pendentes')}>
            Ver pendências
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-ds-ink-muted" aria-live="polite">
          <span className="font-extrabold text-ds-ink">{filtered.length}</span> de {summary.total} patrimônios
        </span>
        <Segmented
          aria-label="Visualização"
          value={view}
          onChange={setView}
          options={viewOptions.map((o) => ({ value: o.id, label: <span className="inline-flex items-center gap-1.5"><o.icon className="h-3.5 w-3.5" />{o.label}</span> }))}
        />
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-3 rounded-[18px] border border-ds-border bg-ds-surface p-4">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-ds-border px-6 py-16 text-center text-sm text-ds-ink-muted">Nenhum patrimônio encontrado.</div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((asset) => <AssetCardHero key={asset.id} asset={asset} onOpen={setSelected} />)}
        </div>
      ) : view === 'list' ? (
        <div className="rounded-[18px] border border-ds-border bg-ds-surface">
          {filtered.map((asset) => <AssetListRow key={asset.id} asset={asset} onOpen={setSelected} selected={selectedAsset?.id === asset.id} />)}
        </div>
      ) : (
        <div className="rounded-[18px] border border-ds-border bg-ds-surface">
          <AssetTableView assets={filtered} onOpen={setSelected} selectedId={selectedAsset?.id} />
        </div>
      )}

      <AssetFormSheet open={showNew} onOpenChange={setShowNew} />
      <AssetCategoryDialog open={showCategories} onOpenChange={setShowCategories} />
      <AssetCodeReaderDialog open={showCodeReader} onOpenChange={setShowCodeReader} />
      <AssetDetailDialog asset={selectedAsset} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
