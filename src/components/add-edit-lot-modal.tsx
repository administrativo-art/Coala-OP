"use client"

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { differenceInCalendarDays, format } from 'date-fns';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type LotEntry, type Kiosk } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { useLocations } from '@/hooks/use-locations';
import { useAuth } from '@/hooks/use-auth';
import { formatQuantity } from '@/lib/conversion';
import { StorageLocationManagementModal } from './storage-location-management-modal';
import {
  CancelButton,
  LotModalShell,
  MODAL_ERROR_TEXT,
  MODAL_INPUT,
  PrimaryButton,
  ShellEyebrow,
  pickClass,
} from './stock/lot-modal-shell';
import { productInitials, productSpecLine } from './stock/lot-presentation';

const BarcodeScannerModal = dynamic(
  () => import('@/components/barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

const lotFormSchema = z.object({
  lotNumber: z.string().min(1, 'O número do lote é obrigatório.'),
  expiryDate: z.date().optional().nullable(),
  kioskId: z.string().min(1, 'O quiosque é obrigatório.'),
  locationId: z.string().optional(),
  quantity: z.coerce.number().min(0.01, 'A quantidade deve ser maior que zero.'),
  imageUrl: z.string().optional(),
});

type LotFormValues = z.infer<typeof lotFormSchema>;

type AddEditLotModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lotToEdit: LotEntry | null;
  kiosks: Kiosk[];
  addLot: (lot: Omit<LotEntry, 'id'>, user: any) => void;
  updateLot: (lot: LotEntry) => void;
  lots: LotEntry[];
};

export function AddEditLotModal({ open, onOpenChange, lotToEdit, kiosks, addLot, updateLot, lots }: AddEditLotModalProps) {
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const { products, getProductFullName, updateProduct } = useProducts();
  const { locations } = useLocations();
  const { user } = useAuth();
  const isEditing = !!lotToEdit;

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [productError, setProductError] = useState(false);
  const [showHow, setShowHow] = useState(false);

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotFormSchema),
    defaultValues: { lotNumber: '', expiryDate: undefined, kioskId: '', locationId: '', quantity: 1, imageUrl: '' },
  });

  const selectedProduct = useMemo(() => products.find(p => p.id === selectedProductId) || null, [products, selectedProductId]);

  const selectedKioskId = form.watch('kioskId');
  const lotNumber = form.watch('lotNumber');
  const expiryDate = form.watch('expiryDate');
  const quantity = Number(form.watch('quantity')) || 0;
  const locationId = form.watch('locationId');
  const errors = form.formState.errors;

  const availableLocations = useMemo(() => {
    if (!selectedKioskId) return [];
    return locations.filter(loc => loc.kioskId === selectedKioskId);
  }, [locations, selectedKioskId]);

  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter(p => !p.isArchived && p.operationalDestination !== 'uniform' && p.category !== 'Vestimenta')
      .filter(p => !term || [p.baseName, p.brand, p.barcode].filter(Boolean).join(' ').toLowerCase().includes(term))
      .sort((a, b) => getProductFullName(a).localeCompare(getProductFullName(b), 'pt-BR'))
      .slice(0, 8);
  }, [products, search, getProductFullName]);

  const activeLots = useMemo(() => {
    if (!selectedProduct) return [];
    return lots
      .filter(l => l.productId === selectedProduct.id && l.quantity > 0 && l.id !== lotToEdit?.id && (!selectedKioskId || l.kioskId === selectedKioskId))
      .sort((a, b) => (a.expiryDate || '9999') < (b.expiryDate || '9999') ? -1 : 1);
  }, [lots, selectedProduct, selectedKioskId, lotToEdit]);

  const kioskName = kiosks.find(k => k.id === selectedKioskId)?.name;

  // Lote já existente com a mesma chave: o cadastro soma na quantidade dele.
  const mergeTarget = useMemo(() => {
    if (isEditing || !selectedProduct || !selectedKioskId || !lotNumber.trim()) return null;
    const dayKey = expiryDate ? format(expiryDate, 'yyyy-MM-dd') : null;
    return lots.find(l =>
      l.productId === selectedProduct.id && l.kioskId === selectedKioskId && l.lotNumber === lotNumber.trim() &&
      (l.expiryDate ? l.expiryDate.slice(0, 10) : null) === dayKey,
    ) ?? null;
  }, [isEditing, lots, selectedProduct, selectedKioskId, lotNumber, expiryDate]);

  const handleProductChange = (productId: string) => {
    setSelectedProductId(productId);
    setProductError(false);
    const product = products.find(p => p.id === productId);
    if (product) form.setValue('imageUrl', product.imageUrl || '');
  };

  useEffect(() => {
    if (open) {
      setSearch('');
      setProductError(false);
      setShowHow(false);
      if (lotToEdit) {
        const product = products.find(p => p.id === lotToEdit.productId);
        setSelectedProductId(lotToEdit.productId);
        form.reset({
          ...lotToEdit,
          expiryDate: lotToEdit.expiryDate ? new Date(lotToEdit.expiryDate) : null,
          locationId: lotToEdit.locationId || '',
          imageUrl: lotToEdit.imageUrl || product?.imageUrl || '',
        });
      } else {
        form.reset({ lotNumber: '', expiryDate: undefined, kioskId: '', locationId: '', quantity: 1, imageUrl: '' });
        setSelectedProductId(null);
      }
    }
  }, [lotToEdit, open, form, products]);

  const onSubmit = async (values: LotFormValues) => {
    if (!selectedProduct || !user) {
        setProductError(true);
        return;
    }

    try {
        const location = locations.find(l => l.id === values.locationId);

        if (values.imageUrl && values.imageUrl !== selectedProduct.imageUrl) {
            await updateProduct({ ...selectedProduct, imageUrl: values.imageUrl });
        }

        if (lotToEdit) {
            const updatedLotData: LotEntry = {
                ...lotToEdit,
                ...values,
                productId: selectedProduct.id,
                productName: getProductFullName(selectedProduct),
                expiryDate: values.expiryDate ? values.expiryDate.toISOString() : null,
                locationId: values.locationId || null,
                locationName: location?.name || null,
                locationCode: location?.code || null,
                imageUrl: values.imageUrl || selectedProduct.imageUrl || '',
            };
            await updateLot(updatedLotData);
        } else {
            const newLotData: Omit<LotEntry, 'id'> = {
                productId: selectedProduct.id,
                productName: getProductFullName(selectedProduct),
                lotNumber: values.lotNumber,
                expiryDate: values.expiryDate ? values.expiryDate.toISOString() : null,
                kioskId: values.kioskId,
                quantity: values.quantity,
                imageUrl: values.imageUrl || selectedProduct.imageUrl || '',
                locationId: values.locationId || null,
                locationName: location?.name || null,
                locationCode: location?.code || null,
            };
            await addLot(newLotData, user);
        }

        onOpenChange(false);
    } catch (error) {
        console.error("Failed to save lot:", error);
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    setIsScannerOpen(false);
    const product = products.find(p => p.barcode === decodedText && !p.isArchived);
    if (product) {
        handleProductChange(product.id);
    } else {
        setSearch(decodedText);
    }
  };

  const setQuantity = (value: number) => form.setValue('quantity', Math.max(0, Math.round(value * 1000) / 1000), { shouldValidate: true });
  const expiryHint = expiryDate
    ? (() => {
        const days = differenceInCalendarDays(expiryDate, new Date());
        return days < 0 ? `Vencido há ${Math.abs(days)} dia(s)` : days === 0 ? 'Vence hoje' : `Vence em ${days} dia(s)`;
      })()
    : 'Sem data de validade: o lote não gera alerta de vencimento.';
  const packageLabel = selectedProduct ? (selectedProduct.packageType || 'unidade').toLowerCase() : '';
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const submitting = form.formState.isSubmitting;

  const sidebar = (
    <>
      <ShellEyebrow>{isEditing ? 'Editar lote' : 'Novo lote'}</ShellEyebrow>
      {selectedProduct ? (
        <>
          <div className="flex flex-col gap-3">
            <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[18px] bg-white font-mono text-xl font-bold text-[#9a9ba1]">
              {selectedProduct.imageUrl ? (
                <Image src={selectedProduct.imageUrl} alt={selectedProduct.baseName} fill sizes="300px" className="object-contain" />
              ) : (
                productInitials(selectedProduct)
              )}
            </div>
            <h2 className="m-0 text-[21px] font-extrabold leading-[1.15] tracking-[-.03em]">{getProductFullName(selectedProduct)}</h2>
            <span className="text-[12.5px] leading-normal text-[#a3a2ad]">{productSpecLine(selectedProduct, { withBarcode: true })}</span>
          </div>
          <div className="flex flex-col rounded-2xl border border-white/10 bg-white/5 text-[12.5px]">
            <span className="px-3.5 pb-2 pt-[11px] text-[10.5px] font-extrabold uppercase tracking-[.16em] text-[#8e8d99]">
              Lotes ativos{kioskName ? ` · ${kioskName}` : ''}
            </span>
            {activeLots.slice(0, 5).map(l => (
              <div key={l.id} className="flex justify-between gap-2.5 border-t border-white/[.06] px-3.5 py-[11px]">
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono font-bold">{l.lotNumber}</span>
                  <span className="text-[#8e8d99]">{l.expiryDate ? format(new Date(l.expiryDate), 'dd/MM/yyyy') : 'Sem validade'}</span>
                </span>
                <span className="whitespace-nowrap font-bold">{l.quantity.toLocaleString('pt-BR')} {packageLabel}(s)</span>
              </div>
            ))}
            {activeLots.length === 0 && <span className="border-t border-white/[.06] px-3.5 py-[11px] text-[#8e8d99]">Nenhum lote ativo.</span>}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/20 p-4 text-[12.5px] leading-[1.55] text-[#a3a2ad]">
          Escolha o insumo ao lado ou escaneie o código de barras. Aqui aparecem a embalagem e os lotes que já existem.
        </div>
      )}
    </>
  );

  return (
    <>
      <LotModalShell
        open={open}
        onOpenChange={onOpenChange}
        title={isEditing ? 'Editar lote' : 'Adicionar lote'}
        description={isEditing ? 'Atualize as informações do lote em estoque.' : 'Selecione o insumo e adicione os detalhes do lote.'}
        width={960}
        height={720}
        sidebar={sidebar}
        footer={
          <>
            <CancelButton onClick={() => onOpenChange(false)} />
            <PrimaryButton type="submit" form="lot-form" disabled={submitting}>
              {submitting ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Adicionar lote'}
            </PrimaryButton>
          </>
        }
      >
        <form id="lot-form" onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-[22px]">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-[#4a4f57]">Insumo</span>
            {selectedProduct ? (
              <div className="flex items-center gap-3 rounded-[14px] border-2 border-[#5b5bd6] bg-[#eeeefc] px-3.5 py-3">
                <span className="flex-1 text-sm font-bold text-[#3f3fb0]">{getProductFullName(selectedProduct)}</span>
                <button type="button" onClick={() => setSelectedProductId(null)} className="text-xs font-bold text-[#5b5bd6]">Trocar</button>
              </div>
            ) : (
              <>
                {isEditing && (
                  <div role="alert" className="rounded-[14px] border border-[#f5d9a3] bg-[#fff7e6] px-3.5 py-3 text-[12.5px] leading-[1.45] text-[#6b4500]">
                    <b>Insumo não encontrado.</b> O insumo original deste lote foi removido ou arquivado. Escolha um insumo ativo para vincular a este lote.
                  </div>
                )}
                <div className="flex gap-2">
                  <div className={cn('flex h-[42px] min-w-0 flex-1 items-center gap-2 rounded-[11px] border bg-white px-3', productError ? 'border-[#e11d48]' : 'border-[#dcd9d1] focus-within:border-[#5b5bd6]')}>
                    <span className="text-[#9a9ba1]">⌕</span>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Nome, marca ou código de barras"
                      className="min-w-0 flex-1 border-none bg-transparent text-[13.5px] outline-none"
                    />
                  </div>
                  <button type="button" onClick={() => setIsScannerOpen(true)} className="flex h-[42px] items-center gap-1.5 whitespace-nowrap rounded-[11px] border border-[#dcd9d1] bg-white px-3.5 text-[13px] font-bold hover:bg-[#f6f4ef]">
                    <Camera className="h-4 w-4" /> Escanear
                  </button>
                </div>
                {productError && <span className={MODAL_ERROR_TEXT}>Escolha o insumo do lote.</span>}
                <div className="flex flex-col overflow-hidden rounded-[14px] border border-[#e3dfd6] bg-white">
                  {searchResults.map(product => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => handleProductChange(product.id)}
                      className="flex flex-col items-start gap-0.5 border-b border-[#f1eee8] px-3.5 py-2.5 text-left last:border-b-0 hover:bg-[#f6f4ef]"
                    >
                      <span className="text-[13.5px] font-bold">{getProductFullName(product)}</span>
                      <span className="text-xs text-[#70757d]">{productSpecLine(product, { withBarcode: true })}</span>
                    </button>
                  ))}
                  {searchResults.length === 0 && <span className="p-3.5 text-[12.5px] text-[#70757d]">Nenhum insumo ativo encontrado.</span>}
                </div>
              </>
            )}
          </div>

          {selectedProduct && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-bold text-[#4a4f57]">
                  Número do lote
                  <input {...form.register('lotNumber')} placeholder="Ex.: 270226" className={cn(MODAL_INPUT, errors.lotNumber && 'border-[#e11d48]')} />
                  {errors.lotNumber && <span className={MODAL_ERROR_TEXT}>{errors.lotNumber.message}</span>}
                </label>
                <div className="flex flex-col gap-1.5 text-xs font-bold text-[#4a4f57]">
                  <span className="flex justify-between">
                    Validade
                    <button type="button" onClick={() => form.setValue('expiryDate', expiryDate ? null : new Date(), { shouldValidate: true })} className="text-xs font-bold text-[#5b5bd6]">
                      {expiryDate ? 'Sem validade' : 'Definir validade'}
                    </button>
                  </span>
                  {expiryDate ? (
                    <input
                      type="date"
                      min={todayKey}
                      value={format(expiryDate, 'yyyy-MM-dd')}
                      onChange={(event) => {
                        const [y, m, d] = event.target.value.split('-').map(Number);
                        if (y && m && d) form.setValue('expiryDate', new Date(y, m - 1, d), { shouldValidate: true });
                      }}
                      className={MODAL_INPUT}
                    />
                  ) : (
                    <span className="flex h-[42px] items-center rounded-[11px] bg-[#eceae5] px-3 text-[13.5px] font-semibold text-[#70757d]">Validade indefinida</span>
                  )}
                  <span className="text-[11.5px] font-medium text-[#70757d]">{expiryHint}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="flex justify-between gap-2 text-xs font-bold text-[#4a4f57]">
                  <span>Quantidade em {packageLabel}s</span>
                  {(selectedProduct.countingInstruction || selectedProduct.countingInstructionImageUrl) && (
                    <button type="button" onClick={() => setShowHow(v => !v)} className="text-xs font-bold text-[#5b5bd6]">{showHow ? 'Ocultar instrução' : 'Como contar?'}</button>
                  )}
                </span>
                {showHow && (
                  <div className="flex flex-col gap-1 rounded-xl border border-[#e3dfd6] bg-white px-3.5 py-3 text-[12.5px] leading-normal text-[#4a4f57]">
                    <b className="text-[#1a1b1f]">Instrução de contagem</b>
                    {selectedProduct.countingInstruction && <span>{selectedProduct.countingInstruction}</span>}
                    {selectedProduct.countingInstructionImageUrl && (
                      <Image src={selectedProduct.countingInstructionImageUrl} alt="Instrução visual" width={200} height={200} className="mt-1 rounded-md object-contain" />
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3.5">
                  <div className={cn('flex h-[52px] items-stretch overflow-hidden rounded-[14px] border bg-white', errors.quantity ? 'border-[#e11d48]' : 'border-[#dcd9d1]')}>
                    <button type="button" aria-label="Diminuir" onClick={() => setQuantity(quantity - 1)} className="w-12 text-xl text-[#4a4f57] hover:bg-[#f6f4ef]">−</button>
                    <input
                      inputMode="decimal"
                      value={form.watch('quantity') as any}
                      onChange={(event) => form.setValue('quantity', event.target.value as any, { shouldValidate: true })}
                      className="w-[84px] border-x border-[#ebe7df] text-center text-xl font-extrabold outline-none"
                    />
                    <button type="button" aria-label="Aumentar" onClick={() => setQuantity(quantity + 1)} className="w-12 text-xl text-[#4a4f57] hover:bg-[#f6f4ef]">+</button>
                  </div>
                  <span className="text-[13px] text-[#4a4f57]">
                    = <b className="text-[#1a1b1f]">{formatQuantity(quantity * selectedProduct.packageSize, selectedProduct.unit)} {selectedProduct.unit}</b>
                  </span>
                </div>
                {errors.quantity && <span className={MODAL_ERROR_TEXT}>{errors.quantity.message}</span>}
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-[#4a4f57]">Quiosque</span>
                <div className="flex flex-wrap gap-2">
                  {kiosks.map(kiosk => (
                    <button
                      key={kiosk.id}
                      type="button"
                      onClick={() => { form.setValue('kioskId', kiosk.id, { shouldValidate: true }); form.setValue('locationId', ''); }}
                      className={pickClass(selectedKioskId === kiosk.id)}
                    >
                      {kiosk.name}
                    </button>
                  ))}
                </div>
                {errors.kioskId && <span className={MODAL_ERROR_TEXT}>{errors.kioskId.message}</span>}
              </div>

              <div className="flex flex-col gap-2">
                <span className="flex justify-between text-xs font-bold text-[#4a4f57]">
                  Localização (opcional)
                  <button type="button" onClick={() => setIsLocationModalOpen(true)} className="text-xs font-bold text-[#5b5bd6]">Gerenciar locais</button>
                </span>
                {selectedKioskId ? (
                  availableLocations.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {availableLocations.map(loc => (
                        <button
                          key={loc.id}
                          type="button"
                          onClick={() => form.setValue('locationId', locationId === loc.id ? '' : loc.id)}
                          className={pickClass(locationId === loc.id)}
                        >
                          {loc.name}{loc.code ? ` (${loc.code})` : ''}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[12.5px] text-[#9a9ba1]">Nenhum local cadastrado em {kioskName}.</span>
                  )
                ) : (
                  <span className="text-[12.5px] text-[#9a9ba1]">Escolha o quiosque para ver os locais.</span>
                )}
              </div>

              {mergeTarget && (
                <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#d7e2fb] bg-[#eef3fe] px-3.5 py-3 text-[12.5px] leading-[1.45] text-[#1e3a8a]">
                  <b className="text-[13px]">Este lote já existe</b>
                  <span>O lote {mergeTarget.lotNumber} já tem {mergeTarget.quantity.toLocaleString('pt-BR')} {packageLabel}(s) em {kioskName}. A quantidade informada será somada a ele.</span>
                </div>
              )}
              {isEditing && (
                <div className="flex flex-col gap-0.5 rounded-[14px] border border-[#f5d9a3] bg-[#fff7e6] px-3.5 py-3 text-[12.5px] leading-[1.45] text-[#6b4500]">
                  <b className="text-[13px]">Atenção</b>
                  <span>Alterar a quantidade aqui corrige o cadastro e não gera movimentação. Para consumo ou perda, use Registrar baixa.</span>
                </div>
              )}
            </>
          )}
        </form>
      </LotModalShell>
      {isScannerOpen && <BarcodeScannerModal
        open={isScannerOpen}
        onOpenChange={setIsScannerOpen}
        onScanSuccess={handleScanSuccess}
      />}
       <StorageLocationManagementModal
        open={isLocationModalOpen}
        onOpenChange={setIsLocationModalOpen}
        kiosks={kiosks}
      />
    </>
  );
}
